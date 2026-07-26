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

type ResponseBody = Record<string, unknown> | null

type HttpResponse = {
  status: number
  body: ResponseBody
  text: string
}

class RetriableError extends Error {}

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

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describe(response: HttpResponse): string {
  const body = response.body ?? {}
  const message =
    typeof body.error === 'string'
      ? body.error
      : typeof body.message === 'string'
        ? body.message
        : truncate(response.text) || 'no response body'

  return `${message} (HTTP ${response.status})`
}

async function request(
  url: string,
  init: {method: string; headers: Record<string, string>; body: string}
): Promise<HttpResponse> {
  try {
    new URL(url)
  } catch {
    throw new Error(`"${url}" is not a valid URL`)
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, init)
      const text = await response.text()
      const result = {status: response.status, body: parseBody(text), text}

      if (RETRIABLE_STATUS.has(response.status)) {
        throw new RetriableError(describe(result))
      }

      return result
    } catch (error) {
      // Anything fetch itself throws is a transport failure - the URL was
      // already validated above.
      const message = error instanceof Error ? error.message : String(error)

      if (attempt > RETRIES) {
        throw new Error(message)
      }

      const delay = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        RETRY_MAX_DELAY_MS
      )
      core.info(
        `Attempt ${attempt} of ${
          RETRIES + 1
        } failed: ${message}. Retrying in ${delay}ms.`
      )
      await sleep(delay)
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
