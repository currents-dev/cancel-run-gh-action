import * as core from '@actions/core'
import {run} from '../main'

jest.mock('../sleep', () => ({sleep: jest.fn().mockResolvedValue(undefined)}))

const DIRECTOR_URL = 'http://localhost:1234'
const API_URL = 'http://localhost:1234/v1'
const RECORD_KEY = 'record-key'
const API_TOKEN = 'api-token'
const PROJECT_ID = 'project-id'
const CI_BUILD_ID = 'ci-build-id'

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

function reply(status: number, body: unknown): Response {
  return {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as Response
}

function lastRequest(): {url: string; init: RequestInit; body: unknown} {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return {url, init, body: JSON.parse(init.body)}
}

const CURRENTS_ENV = [
  'CURRENTS_RECORD_KEY',
  'CURRENTS_PROJECT_ID',
  'CURRENTS_CI_BUILD_ID'
]

beforeEach(() => {
  fetchMock.mockReset()
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
      'Provide record-key, or api-token to cancel with a Currents API key.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fails when record-key is provided without project-id and ci-build-id', async () => {
    process.env['INPUT_RECORD-KEY'] = RECORD_KEY
    const setFailed = jest.spyOn(core, 'setFailed')

    await run()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('record-key requires project-id and ci-build-id')
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

  test('warns instead of failing when no run was recorded', async () => {
    const warning = jest.spyOn(core, 'warning')
    const setFailed = jest.spyOn(core, 'setFailed')
    fetchMock.mockResolvedValue(
      reply(404, 'No run with ciBuildId "ci-build-id" was found')
    )

    await run()

    expect(warning).toHaveBeenCalledWith(
      'No run with ciBuildId "ci-build-id" was found'
    )
    expect(setFailed).not.toHaveBeenCalled()
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
