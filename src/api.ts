import * as core from '@actions/core'
import {DEFAULT_DIRECTOR_URL} from './inputs'
import {sleep} from './sleep'

export type CancelResult =
  | {outcome: 'cancelled'; runId?: string}
  | {outcome: 'already-cancelled'}
  | {outcome: 'not-found'; message: string}

const RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 8000
const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRY_AFTER_MAX_MS = 60_000
/** Per attempt, for the response headers and the body together. */
const REQUEST_TIMEOUT_MS = 30_000

type ResponseBody = Record<string, unknown> | null

export type HttpResponse = {
  status: number
  body: ResponseBody
  text: string
}

class RetriableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

/** Thrown inside the retry loop for something retrying cannot change. */
class FatalError extends Error {}

// The three HTTP-date formats of RFC 9110 section 5.6.7. Date.parse alone
// would also accept values like "-1" or "1.5" as dates.
const IMF_FIXDATE =
  /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/
const RFC850_DATE =
  /^[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/
const ASCTIME_DATE =
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/

/**
 * Reads both forms of Retry-After from RFC 9110 section 10.2.3: a number of
 * seconds, or an HTTP date. A date in the past means no wait.
 */
export function parseRetryAfter(
  header: string | null,
  now = Date.now()
): number | undefined {
  const value = header?.trim()
  if (!value) return undefined

  if (/^\d+$/.test(value)) return Number(value) * 1000

  let date = NaN
  if (IMF_FIXDATE.test(value) || RFC850_DATE.test(value)) {
    date = Date.parse(value)
  } else if (ASCTIME_DATE.test(value)) {
    // asctime has no zone, and Date.parse would read it as local time.
    date = Date.parse(`${value} GMT`)
  }

  return Number.isNaN(date) ? undefined : Math.max(date - now, 0)
}

function parseBody(text: string): ResponseBody {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function redact(text: string, values: readonly string[]): string {
  for (const value of values) {
    if (value) text = text.replaceAll(value, '***')
  }
  return text
}

function describe(
  response: HttpResponse,
  redactValues: readonly string[] = []
): string {
  const body = response.body ?? {}
  const message =
    typeof body.error === 'string'
      ? body.error
      : typeof body.message === 'string'
        ? body.message
        : truncate(redact(response.text, redactValues)) || 'no response body'

  return `${redact(message, redactValues)} (HTTP ${response.status})`
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Every request here carries a credential, so the destination is checked before
 * it is sent. The host itself is not pinned: `director-url` and `api-url` exist
 * for self-hosted Currents, and the smoke test in `test.yml` points them at
 * localhost.
 */
function checkDestination(url: string, name: string): void {
  let destination: URL

  try {
    destination = new URL(url)
  } catch {
    throw new Error(`${name} is not a valid URL`)
  }

  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
    throw new Error(`${name} is not an http or https URL`)
  }

  if (
    destination.protocol === 'http:' &&
    !LOOPBACK_HOSTS.has(destination.hostname)
  ) {
    core.warning(
      `Sending the credential to ${destination.host} over plain http. Use https unless this host is on a trusted network.`
    )
  }
}

/**
 * `label` names the request in messages instead of the URL and the Location of
 * a redirect, for a URL that holds a credential.
 */
export async function request(
  url: string,
  init: {method: string; headers: Record<string, string>; body?: string},
  {
    retries = RETRIES,
    label,
    timeoutMs = REQUEST_TIMEOUT_MS,
    retryStatuses = RETRIABLE_STATUS,
    redactValues = []
  }: {
    retries?: number
    label?: string
    timeoutMs?: number
    retryStatuses?: ReadonlySet<number>
    redactValues?: readonly string[]
  } = {}
): Promise<HttpResponse> {
  checkDestination(url, label ?? `"${url}"`)
  // Replace a complete URL before a shorter value contained in it.
  const secrets = [...redactValues].sort((a, b) => b.length - a.length)

  for (let attempt = 1; ; attempt++) {
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `${label ?? url} did not respond within ${timeoutMs / 1000} seconds`
        )
      )
    }, timeoutMs)

    try {
      // redirect: 'manual' - fetch follows redirects by default, and a 307/308
      // repeats the request, body included, against whatever host the Location
      // names. That would hand the record key to a destination checkDestination
      // never saw.
      const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: deadline.signal
      })
      const responseText = await response.text()
      const text =
        response.status === 200 ? responseText : redact(responseText, secrets)
      const result = {status: response.status, body: parseBody(text), text}

      if (response.status >= 300 && response.status < 400) {
        const location = label
          ? 'another location'
          : (response.headers.get('location') ?? 'an unnamed location')
        throw new FatalError(
          `${label ?? url} redirected to ${location} (HTTP ${
            response.status
          }). Redirects are not followed, because the request carries a credential.`
        )
      }

      if (retryStatuses.has(response.status)) {
        const retryAfterMs =
          response.status === 429
            ? parseRetryAfter(response.headers.get('retry-after'))
            : undefined
        if (retryAfterMs !== undefined && retryAfterMs > RETRY_AFTER_MAX_MS) {
          throw new FatalError(
            `${describe(result, secrets)}. The server asked to wait ${Math.ceil(
              retryAfterMs / 1000
            )} seconds before retrying, more than the ${
              RETRY_AFTER_MAX_MS / 1000
            } seconds this action waits.`
          )
        }
        throw new RetriableError(describe(result, secrets), retryAfterMs)
      }

      return result
    } catch (error) {
      if (error instanceof FatalError) {
        throw new Error(redact(error.message, secrets))
      }

      // Anything fetch itself throws is a transport failure - the URL was
      // already validated above.
      const message = redact(
        error instanceof Error ? error.message : String(error),
        secrets
      )

      if (attempt > retries) {
        throw new Error(message)
      }

      const defaultDelay = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        RETRY_MAX_DELAY_MS
      )
      const delay = Math.max(
        error instanceof RetriableError ? (error.retryAfterMs ?? 0) : 0,
        defaultDelay
      )
      core.info(
        `Attempt ${attempt} of ${
          retries + 1
        } failed: ${message}. Retrying in ${delay}ms.`
      )
      clearTimeout(timer)
      await sleep(delay)
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Cancels via the director, the same service the reporter uploads results to,
 * which accepts the record key the job already holds.
 */
export async function cancelWithRecordKey(params: {
  directorUrl: string
  recordKey: string
  projectId: string
  ciBuildId?: string
  runId?: string
}): Promise<CancelResult> {
  const {directorUrl, ...rest} = params
  const url = `${directorUrl}/v1/runs/cancel`
  const body = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  )
  const response = await request(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  })

  if (response.status === 200) {
    const data = response.body?.data as {runId?: string | null} | undefined

    // The endpoint answers "there is nothing to cancel" with a null runId
    // rather than an error status, because a workflow cancelled before it
    // recorded anything never created a run.
    return data?.runId
      ? {outcome: 'cancelled', runId: data.runId}
      : {
          outcome: 'not-found',
          message:
            'No run to cancel. A run only exists once results have been recorded.'
        }
  }

  // Not a missing run - that is the 200 above. A 404 here is a director
  // without this route: a wrong director-url, or a self-hosted Currents older
  // than the release that added it.
  if (response.status === 404) {
    throw new Error(
      `${url} returned 404. Check director-url, which defaults to ${DEFAULT_DIRECTOR_URL}.`
    )
  }

  throw new Error(describe(response))
}

/**
 * Cancels via the REST API, which authenticates with an API key.
 */
export async function cancelWithApiToken(params: {
  apiUrl: string
  apiToken: string
  githubRunId: string
  githubRunAttempt: string
  projectId?: string
  ciBuildId?: string
}): Promise<CancelResult> {
  const {apiUrl, apiToken, ...body} = params
  const response = await request(`${apiUrl}/runs/cancel-ci/github`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`
    },
    // githubRunAttempt is decoded as an int from a string, so it must stay a
    // JSON string here.
    body: JSON.stringify(body)
  })

  if (response.status === 200) {
    return {outcome: 'cancelled'}
  }

  if (response.status === 404) {
    return {
      outcome: 'not-found',
      message:
        'No run matched the identifiers above. A run only exists once results have been recorded.'
    }
  }

  // Every job of a parallel run cancels the same run, so all but the first get
  // this back.
  if (response.status === 422 && response.body?.error === 'Run is cancelled') {
    return {outcome: 'already-cancelled'}
  }

  throw new Error(describe(response))
}
