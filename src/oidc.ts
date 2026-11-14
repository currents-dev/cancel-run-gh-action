import * as core from '@actions/core'
import {HttpResponse, request, truncate} from './api'

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
const TOKEN_NAME = 'GitHub Actions OIDC token'

const FORM_HEADERS = {'Content-Type': 'application/x-www-form-urlencoded'}

/**
 * The origin of the director URL: a token minted for one Currents deployment is
 * refused by another. The Currents reporters derive it the same way.
 */
export function getOidcAudience(directorUrl: string): string {
  try {
    return new URL(directorUrl).origin
  } catch {
    throw new Error(`"${directorUrl}" is not a valid URL`)
  }
}

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
 * Exchanges the job's GitHub Actions OIDC token (RFC 8693) for a short-lived
 * record key of the project. The server refuses an exchange without
 * `project_id`.
 */
export async function getRecordKeyFromOidc(
  directorUrl: string,
  projectId: string
): Promise<string> {
  const audience = getOidcAudience(directorUrl)
  let oidcToken: string

  try {
    // getIDToken masks the token in the log.
    oidcToken = await core.getIDToken(audience)
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
      {retries: 0}
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
