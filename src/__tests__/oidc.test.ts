import * as core from '@actions/core'
import {getRecordKeyFromOidc} from '../oidc'

const POLICY_ID = '0123456789abcdef01234567'
const OIDC_TOKEN = 'header.oidc-token-payload.signature'
const fetchMock = jest.fn()

function reply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {status, headers})
}

function exchange(): Promise<string> {
  return getRecordKeyFromOidc({
    directorUrl: 'https://director.example.com',
    policyId: POLICY_ID,
    audience: 'currents:record-key'
  })
}

const originalFetch = global.fetch
const originalUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
const originalToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(core, 'setSecret').mockImplementation(() => undefined)
  jest.spyOn(core, 'info').mockImplementation(() => undefined)
  fetchMock.mockReset()
  fetchMock.mockResolvedValueOnce(reply(200, {value: OIDC_TOKEN}))
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.actions.example.com'
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'request-token'
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  global.fetch = originalFetch
  for (const [name, value] of [
    ['ACTIONS_ID_TOKEN_REQUEST_URL', originalUrl],
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', originalToken]
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test.each([
  ['2', 2000],
  ['120', 60000],
  [undefined, 1000],
  ['invalid', 1000],
  ['-1', 1000],
  ['0', 0]
])(
  'retries 429 after Retry-After %s with a %i ms wait',
  async (header, delay) => {
    fetchMock
      .mockResolvedValueOnce(
        reply(
          429,
          {error: 'rate_limit_exceeded'},
          header ? {'Retry-After': header} : {}
        )
      )
      .mockResolvedValueOnce(reply(200, {access_token: 'record-key'}))

    const result = exchange()
    await jest.advanceTimersByTimeAsync(0)
    if (delay > 0) {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await jest.advanceTimersByTimeAsync(delay - 1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await jest.advanceTimersByTimeAsync(1)
    } else {
      await jest.runAllTimersAsync()
    }

    await expect(result).resolves.toBe('record-key')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(jest.getTimerCount()).toBe(0)
  }
)

test('succeeds after three 429 responses', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    fetchMock.mockResolvedValueOnce(reply(429, {error: 'rate_limit_exceeded'}))
  }
  fetchMock.mockResolvedValueOnce(reply(200, {access_token: 'record-key'}))

  const result = exchange()
  await jest.advanceTimersByTimeAsync(7000)

  await expect(result).resolves.toBe('record-key')
  expect(fetchMock).toHaveBeenCalledTimes(5)
})

test('fails clearly after three retries without logging the token or policy ID', async () => {
  fetchMock.mockImplementation(async () =>
    reply(429, {error: `rate_limit_exceeded ${OIDC_TOKEN} ${POLICY_ID}`})
  )
  const result = expect(exchange()).rejects.toThrow(
    'Could not exchange the GitHub Actions OIDC token for a record key: rate_limit_exceeded *** *** (HTTP 429)'
  )

  await jest.advanceTimersByTimeAsync(7000)
  await result

  expect(fetchMock).toHaveBeenCalledTimes(5)
  expect(core.info).toHaveBeenCalledTimes(3)
  for (const [message] of jest.mocked(core.info).mock.calls) {
    expect(message).not.toContain(OIDC_TOKEN)
    expect(message).not.toContain(POLICY_ID)
  }
  expect(jest.getTimerCount()).toBe(0)
})

test.each([400, 401, 403, 408, 425])('does not retry HTTP %i', async status => {
  fetchMock.mockResolvedValueOnce(reply(status, {error: 'invalid_request'}))

  await expect(exchange()).rejects.toThrow('invalid_request')

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(core.info).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})
