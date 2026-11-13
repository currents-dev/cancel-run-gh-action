import * as core from '@actions/core'
import {run} from '../main'

jest.mock('../sleep', () => ({sleep: jest.fn().mockResolvedValue(undefined)}))

const DIRECTOR_URL = 'http://localhost:1234'
const API_URL = 'http://localhost:1234/v1'
const RECORD_KEY = 'record-key'
const API_TOKEN = 'api-token'
const PROJECT_ID = 'project-id'
const CI_BUILD_ID = 'ci-build-id'
const RUN_ID = 'run-id'

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

function reply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return {
    status,
    headers: {get: (name: string) => headers[name.toLowerCase()] ?? null},
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response
}

function lastRequest(): {url: string; init: RequestInit; body: unknown} {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return {url, init, body: JSON.parse(init.body)}
}

const CURRENTS_ENV = [
  'CURRENTS_RECORD_KEY',
  'CURRENTS_PROJECT_ID',
  'CURRENTS_CI_BUILD_ID',
  'CURRENTS_RUN_ID',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
]

beforeEach(() => {
  fetchMock.mockReset()
  // The real setFailed sets process.exitCode, which would fail the jest run
  // even with every test passing.
  jest.spyOn(core, 'setFailed').mockImplementation(() => undefined)
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('INPUT_') || CURRENTS_ENV.includes(name)) {
      delete process.env[name]
    }
  }
  process.env['GITHUB_RUN_ID'] = '45166321'
  process.env['GITHUB_RUN_ATTEMPT'] = '1'
})

describe('credentials', () => {
  test('fails when neither record-key nor api-token is provided', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'Provide record-key, or api-token to cancel with a Currents API key.'
      )
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fails when record-key is provided without project-id', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('record-key requires project-id')
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fails when record-key is provided without an identifier for the run', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('record-key requires ci-build-id or run-id')
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('reads the record key and the run identifiers from the environment', async () => {
    process.env['CURRENTS_RECORD_KEY'] = RECORD_KEY
    process.env['CURRENTS_PROJECT_ID'] = PROJECT_ID
    process.env['CURRENTS_CI_BUILD_ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    await run()

    expect(lastRequest().body).toEqual({
      recordKey: RECORD_KEY,
      projectId: PROJECT_ID,
      ciBuildId: CI_BUILD_ID
    })
  })

  test('reads the run id from the environment', async () => {
    process.env['CURRENTS_RECORD_KEY'] = RECORD_KEY
    process.env['CURRENTS_PROJECT_ID'] = PROJECT_ID
    process.env['CURRENTS_RUN_ID'] = RUN_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: RUN_ID}})
    )

    await run()

    expect(lastRequest().body).toEqual({
      recordKey: RECORD_KEY,
      projectId: PROJECT_ID,
      runId: RUN_ID
    })
  })

  test('keeps using api-token when the record key is only in the environment', async () => {
    process.env['CURRENTS_RECORD_KEY'] = RECORD_KEY
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_API-URL'] = API_URL
    fetchMock.mockResolvedValue(reply(200, {status: 'OK', data: {}}))

    await run()

    expect(lastRequest().url).toBe(`${API_URL}/runs/cancel-ci/github`)
  })

  test('prefers record-key when both inputs are provided', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    await run()

    expect(lastRequest().url).toBe(`${DIRECTOR_URL}/v1/runs/cancel`)
  })
})

describe('cancelling with a record key', () => {
  beforeEach(() => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
  })

  test('reports the cancelled run', async () => {
    const info = jest.spyOn(core, 'info')
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    await run()

    const {url, init} = lastRequest()
    expect(url).toBe(`${DIRECTOR_URL}/v1/runs/cancel`)
    expect(init.method).toBe('POST')
    expect(info).toHaveBeenCalledWith('Run run-1 was cancelled')
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('sends the run id and reports the cancelled run', async () => {
    process.env['INPUT_RUN-ID'] = RUN_ID
    const info = jest.spyOn(core, 'info')
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: RUN_ID}})
    )

    await run()

    expect(lastRequest().body).toEqual({
      recordKey: RECORD_KEY,
      projectId: PROJECT_ID,
      ciBuildId: CI_BUILD_ID,
      runId: RUN_ID
    })
    expect(info).toHaveBeenCalledWith(
      'Both run-id and ci-build-id were provided, using run-id'
    )
  })

  // The endpoint reports a build with no run as a 200 with a null runId.
  test('warns instead of failing when there is no run to cancel', async () => {
    const warning = jest.spyOn(core, 'warning')
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: null, cancellation: null}})
    )

    await run()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('No run to cancel')
    )
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('fails when the director has no cancel route', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(reply(404, 'Cannot POST /v1/runs/cancel'))

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        `${DIRECTOR_URL}/v1/runs/cancel returned 404. Check director-url`
      )
    )
  })

  test('fails on an invalid record key', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(422, {
        message: 'Record key is invalid.',
        errors: [],
        code: 'UNEXPECTED'
      })
    )

    await run()

    expect(setFailed).toHaveBeenCalledWith('Record key is invalid. (HTTP 422)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('cancelling with an API token', () => {
  beforeEach(() => {
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_API-URL'] = API_URL
  })

  test('identifies the run by the GitHub run id and attempt', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(reply(200, {status: 'OK', data: {}}))

    await run()

    const {url, init, body} = lastRequest()
    expect(url).toBe(`${API_URL}/runs/cancel-ci/github`)
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_TOKEN}`
    )
    // The API decodes the attempt from a string.
    expect(body).toEqual({githubRunId: '45166321', githubRunAttempt: '1'})
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('sends the project and CI build id when both are provided', async () => {
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    fetchMock.mockResolvedValue(reply(200, {status: 'OK', data: {}}))

    await run()

    expect(lastRequest().body).toEqual({
      githubRunId: '45166321',
      githubRunAttempt: '1',
      projectId: PROJECT_ID,
      ciBuildId: CI_BUILD_ID
    })
  })

  test('warns when ci-build-id is provided without project-id', async () => {
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    const warning = jest.spyOn(core, 'warning')
    fetchMock.mockResolvedValue(reply(200, {status: 'OK', data: {}}))

    await run()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'ci-build-id is only used together with project-id'
      )
    )
  })

  test('warns instead of failing when no run was recorded', async () => {
    const warning = jest.spyOn(core, 'warning')
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(404, {status: 'FAILED', error: 'Not found'})
    )

    await run()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('No run matched the identifiers above')
    )
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('treats an already cancelled run as a success', async () => {
    const info = jest.spyOn(core, 'info')
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(422, {status: 'FAILED', error: 'Run is cancelled'})
    )

    await run()

    expect(info).toHaveBeenCalledWith('The run was already cancelled')
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('fails on an invalid API token', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(401, {status: 'FAILED', error: 'Unauthorized'})
    )

    await run()

    expect(setFailed).toHaveBeenCalledWith('Unauthorized (HTTP 401)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('retries', () => {
  beforeEach(() => {
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_API-URL'] = API_URL
  })

  test('retries a server error and succeeds', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock
      .mockResolvedValueOnce(reply(500, ''))
      .mockResolvedValueOnce(reply(200, {status: 'OK', data: {}}))

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('retries a network error and fails after the last attempt', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(setFailed).toHaveBeenCalledWith('fetch failed')
  })

  test('does not retry a client error', async () => {
    fetchMock.mockResolvedValue(
      reply(400, {status: 'FAILED', error: 'Invalid params'})
    )

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fails without a request when the URL is invalid', async () => {
    process.env['INPUT_API-URL'] = 'not a url'
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      '"not a url/runs/cancel-ci/github" is not a valid URL'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the destination of a credential', () => {
  test('fails without a request when the URL is not http', async () => {
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_API-URL'] = 'file:///etc'
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      '"file:///etc/runs/cancel-ci/github" is not an http or https URL'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('warns when a credential goes over plain http to another host', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = 'http://currents.example.com'
    const warning = jest.spyOn(core, 'warning')
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    await run()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('over plain http')
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not follow a redirect away from the checked destination', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(307, '', {location: 'http://elsewhere.example.com/v1/runs/cancel'})
    )

    await run()

    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'redirected to http://elsewhere.example.com/v1/runs/cancel (HTTP 307)'
      )
    )
    // Not retried: another attempt lands on the same redirect.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not warn for https, or for a loopback host', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    const warning = jest.spyOn(core, 'warning')
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    // The default director-url, https.
    await run()
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    await run()

    expect(warning).not.toHaveBeenCalled()
  })
})

describe('cancelling with a record key from GitHub Actions OIDC', () => {
  const OIDC_TOKEN = 'header.oidc-token-payload.signature'
  const OIDC_RECORD_KEY = 'crnts_ci_exchanged-key'

  let getIDToken: jest.SpyInstance

  function exchanged(): Response {
    return reply(200, {
      access_token: OIDC_RECORD_KEY,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: 21600
    })
  }

  function formRequest(index: number): {
    url: string
    init: RequestInit
    form: URLSearchParams
  } {
    const [url, init] = fetchMock.mock.calls[index]
    return {url, init, form: new URLSearchParams(init.body)}
  }

  beforeEach(() => {
    process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] =
      'https://token.actions.example.com/token?api-version=2.0'
    process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'request-token'
    process.env['INPUT_PROJECT-ID'] = PROJECT_ID
    process.env['INPUT_CI-BUILD-ID'] = CI_BUILD_ID
    process.env['INPUT_DIRECTOR-URL'] = DIRECTOR_URL
    getIDToken = jest.spyOn(core, 'getIDToken').mockResolvedValue(OIDC_TOKEN)
  })

  test('exchanges the OIDC token and cancels with the record key it gets', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    const setSecret = jest.spyOn(core, 'setSecret')
    const info = jest.spyOn(core, 'info')
    fetchMock
      .mockResolvedValueOnce(exchanged())
      .mockResolvedValueOnce(reply(200, {status: 'OK', data: {runId: 'run-1'}}))
      .mockResolvedValueOnce(reply(200, ''))

    await run()

    expect(getIDToken).toHaveBeenCalledWith(DIRECTOR_URL)

    const exchange = formRequest(0)
    expect(exchange.url).toBe(`${DIRECTOR_URL}/oidc/token`)
    expect(exchange.init.method).toBe('POST')
    expect(exchange.init.redirect).toBe('manual')
    expect(Object.fromEntries(exchange.form)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: OIDC_TOKEN,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt'
    })

    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1]
    expect(cancelUrl).toBe(`${DIRECTOR_URL}/v1/runs/cancel`)
    expect(JSON.parse(cancelInit.body)).toEqual({
      recordKey: OIDC_RECORD_KEY,
      projectId: PROJECT_ID,
      ciBuildId: CI_BUILD_ID
    })

    const revoke = formRequest(2)
    expect(revoke.url).toBe(`${DIRECTOR_URL}/oidc/revoke`)
    expect(revoke.form.get('token')).toBe(OIDC_RECORD_KEY)

    expect(setSecret).toHaveBeenCalledWith(OIDC_RECORD_KEY)
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Using a record key from the GitHub Actions OIDC token, valid until'
      )
    )
    expect(info).toHaveBeenCalledWith('Run run-1 was cancelled')
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('requests the token for the origin of director-url', async () => {
    process.env['INPUT_DIRECTOR-URL'] = 'https://Currents.Example.com:443/cy/'
    fetchMock.mockResolvedValue(reply(404, {}))

    await run()

    expect(getIDToken).toHaveBeenCalledWith('https://currents.example.com')
  })

  test('requests the token for https://cy.currents.dev by default', async () => {
    delete process.env['INPUT_DIRECTOR-URL']
    fetchMock.mockResolvedValue(reply(404, {}))

    await run()

    expect(getIDToken).toHaveBeenCalledWith('https://cy.currents.dev')
  })

  test('uses a record key when one is provided', async () => {
    process.env['CURRENTS_RECORD_KEY'] = RECORD_KEY
    fetchMock.mockResolvedValue(
      reply(200, {status: 'OK', data: {runId: 'run-1'}})
    )

    await run()

    expect(getIDToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastRequest().body).toMatchObject({recordKey: RECORD_KEY})
  })

  test('uses api-token when one is provided', async () => {
    process.env['INPUT_API-TOKEN'] = API_TOKEN
    process.env['INPUT_API-URL'] = API_URL
    fetchMock.mockResolvedValue(reply(200, {status: 'OK', data: {}}))

    await run()

    expect(getIDToken).not.toHaveBeenCalled()
    expect(lastRequest().url).toBe(`${API_URL}/runs/cancel-ci/github`)
  })

  test('is not used without both GitHub OIDC variables', async () => {
    delete process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(getIDToken).not.toHaveBeenCalled()
    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('permissions: id-token: write')
    )
  })

  test('requires the run identifiers before getting a token', async () => {
    delete process.env['INPUT_PROJECT-ID']
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('GitHub Actions OIDC requires project-id')
    )
    expect(getIDToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fails when GitHub does not issue a token', async () => {
    getIDToken.mockRejectedValue(
      new Error('Error message: Failed to get ID Token.')
    )
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      'Could not get the GitHub Actions OIDC token: Error message: Failed to get ID Token.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fails when the exchange is disabled on the server', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(404, {
        error: 'invalid_request',
        error_description: 'OIDC token exchange is disabled',
        code: 'OIDC_EXCHANGE_DISABLED'
      })
    )

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      'Could not exchange the GitHub Actions OIDC token for a record key: OIDC token exchange is disabled'
    )
    // No cancel request, and nothing to revoke.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fails when the server refuses the token', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(400, {
        error: 'invalid_grant',
        error_description: 'No OIDC trust policy matches the token',
        code: 'OIDC_NO_MATCHING_POLICY'
      })
    )

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      'Could not exchange the GitHub Actions OIDC token for a record key: No OIDC trust policy matches the token'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('falls back to the OAuth error code without a description', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(reply(400, {error: 'invalid_grant'}))

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      'Could not exchange the GitHub Actions OIDC token for a record key: invalid_grant'
    )
  })

  test('fails when the response has no record key', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(reply(200, {token_type: 'Bearer'}))

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      'Could not exchange the GitHub Actions OIDC token for a record key: the response has no access token'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not follow a redirect of the exchange', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(308, '', {location: 'http://elsewhere.example.com/oidc/token'})
    )

    await run()

    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        'redirected to http://elsewhere.example.com/oidc/token (HTTP 308)'
      )
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not send the token to a URL that is not http', async () => {
    process.env['INPUT_DIRECTOR-URL'] = 'file:///etc'
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('is not an http or https URL')
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not follow a redirect of the cancel request, and revokes the key', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock
      .mockResolvedValueOnce(exchanged())
      .mockResolvedValueOnce(
        reply(307, '', {
          location: 'http://elsewhere.example.com/v1/runs/cancel'
        })
      )
      .mockResolvedValueOnce(reply(200, ''))

    await run()

    expect(fetchMock.mock.calls[1][1].redirect).toBe('manual')
    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('redirected to http://elsewhere.example.com')
    )
    expect(formRequest(2).url).toBe(`${DIRECTOR_URL}/oidc/revoke`)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('does not fail or retry when revoking the key fails', async () => {
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock
      .mockResolvedValueOnce(exchanged())
      .mockResolvedValueOnce(reply(200, {status: 'OK', data: {runId: 'run-1'}}))
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    await run()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(setFailed).not.toHaveBeenCalled()
  })

  test('never logs the OIDC token', async () => {
    const logged: string[] = []
    for (const method of [
      'info',
      'debug',
      'warning',
      'error',
      'notice',
      'setFailed'
    ] as const) {
      jest.spyOn(core, method).mockImplementation((...args: unknown[]) => {
        logged.push(String(args[0]))
      })
    }
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        logged.push(String(chunk))
        return true
      })

    try {
      // A successful run, a refused token, and a failed request.
      fetchMock
        .mockResolvedValueOnce(exchanged())
        .mockResolvedValueOnce(
          reply(200, {status: 'OK', data: {runId: 'run-1'}})
        )
        .mockResolvedValueOnce(reply(500, ''))
      await run()

      fetchMock.mockReset()
      fetchMock.mockResolvedValue(reply(400, {error: 'invalid_grant'}))
      await run()

      fetchMock.mockReset()
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      await run()
    } finally {
      write.mockRestore()
    }

    expect(logged.length).toBeGreaterThan(0)
    expect(logged.join('\n')).not.toContain(OIDC_TOKEN)
  })
})
