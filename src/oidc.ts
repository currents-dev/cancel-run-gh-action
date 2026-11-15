import * as core from '@actions/core'
import {HttpResponse, request, truncate} from './api'

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
const TOKEN_NAME = 'GitHub Actions OIDC token'

const FORM_HEADERS = {'Content-Type': 'application/x-www-form-urlencoded'}
/** Revoke runs after the cancel and only saves the key's remaining minutes. */
const REVOKE_TIMEOUT_MS = 5_000

/** `error_description` of the OAuth error, then `error`, then the response. */
function describeOAuthError(response: HttpResponse): string {
  const body = response.body ?? {}

  for (const field of [body.error_description, body.error]) {
    if (typeof field === 'string' && field) {
      return field
    }
  }

  return truncate(response.text) || `HTTP ${response.status}`
}

/**
 * Not core.getIDToken: its HTTP client follows redirects and sends the request
 * token to the redirect host, and it logs the request URL before anything
 * masks it.
 */
async function getGitHubOidcToken(audience: string): Promise<string> {
  // readCredentials checked that both are set.
  const requestUrl = (process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '').trim()
  const requestToken = (process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '').trim()
  core.setSecret(requestUrl)
  core.setSecret(requestToken)

  let url: URL

  try {
    url = new URL(requestUrl)
  } catch {
    throw new Error('ACTIONS_ID_TOKEN_REQUEST_URL is not a valid URL')
  }

  url.searchParams.set('audience', audience)

  const response = await request(
    url.href,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${requestToken}`
      }
    },
    {label: 'The GitHub OIDC token request'}
  )

  if (response.status !== 200) {
    throw new Error(`GitHub did not issue a token (HTTP ${response.status})`)
  }

  const token = response.body?.value

  if (typeof token !== 'string' || !token) {
    throw new Error('the response from GitHub has no token')
  }

  core.setSecret(token)
  return token
}

/**
 * Exchanges the job's GitHub Actions OIDC token (RFC 8693) for a short-lived
 * record key. The server uses `project_id` to find the organization whose
 * trust policies it checks the token against, and refuses an exchange without
 * it.
 */
export async function getRecordKeyFromOidc({
  directorUrl,
  projectId,
  audience
}: {
  directorUrl: string
  projectId: string
  audience: string
}): Promise<string> {
  let oidcToken: string

  try {
    oidcToken = await getGitHubOidcToken(audience)
  } catch (error) {
    throw new Error(
      `Could not get the ${TOKEN_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const exchangeError = (message: string): Error =>
    new Error(
      `Could not exchange the ${TOKEN_NAME} for a record key: ${message}`
    )

  let response: HttpResponse

  try {
    response = await request(`${directorUrl}/oidc/token`, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        subject_token: oidcToken,
        subject_token_type: SUBJECT_TOKEN_TYPE,
        project_id: projectId
      }).toString()
    })
  } catch (error) {
    throw exchangeError(error instanceof Error ? error.message : String(error))
  }

  if (response.status !== 200) {
    throw exchangeError(describeOAuthError(response))
  }

  const {access_token: recordKey, expires_in: expiresIn} = response.body ?? {}

  if (typeof recordKey !== 'string' || !recordKey) {
    throw exchangeError('the response has no access token')
  }

  core.setSecret(recordKey)
  core.info(
    typeof expiresIn === 'number'
      ? `Using a record key from the ${TOKEN_NAME}, valid until ${new Date(
          Date.now() + expiresIn * 1000
        ).toISOString()}`
      : `Using a record key from the ${TOKEN_NAME}`
  )

  return recordKey
}

/**
 * The key is only needed for the cancel request. One attempt: on failure the
 * key still expires on its own, so it only gets a debug line.
 */
export async function revokeRecordKey(
  directorUrl: string,
  recordKey: string
): Promise<void> {
  try {
    const response = await request(
      `${directorUrl}/oidc/revoke`,
      {
        method: 'POST',
        headers: FORM_HEADERS,
        body: new URLSearchParams({
          token: recordKey,
          token_type_hint: 'access_token'
        }).toString()
      },
      {retries: 0, timeoutMs: REVOKE_TIMEOUT_MS}
    )

    core.debug(
      response.status === 200
        ? 'Revoked the record key from OIDC'
        : `Could not revoke the record key from OIDC: ${describeOAuthError(response)}`
    )
  } catch (error) {
    core.debug(
      `Could not revoke the record key from OIDC: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
