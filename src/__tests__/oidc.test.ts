import * as core from '@actions/core'
import {parseRetryAfter} from '../api'
import {getRecordKeyFromOidc} from '../oidc'

const POLICY_ID = '0123456789abcdef01234567'
const NOW = Date.parse('2026-11-19T12:00:00Z')
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
  jest.useFakeTimers({now: NOW})
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
  ['60', 60000],
  ['Thu, 19 Nov 2026 12:00:30 GMT', 30000],
  ['Thu, 19 Nov 2026 11:59:00 GMT', 1000],
  [undefined, 1000],
  ['invalid', 1000],
  ['-1', 1000],
  ['0', 1000]
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
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(delay - 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toBe('record-key')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(jest.getTimerCount()).toBe(0)
  }
)

test.each(['61', 'Thu, 19 Nov 2026 12:02:00 GMT'])(
  'stops when Retry-After %s asks for a wait over 60 seconds',
  async header => {
    fetchMock.mockResolvedValueOnce(
      reply(429, {error: 'rate_limit_exceeded'}, {'Retry-After': header})
    )

    await expect(exchange()).rejects.toThrow(
      /rate_limit_exceeded \(HTTP 429\)\. The server asked to wait \d+ seconds before retrying, more than the 60 seconds this action waits\./
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(core.info).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  }
)

test.each([
  ['30', 30000],
  [' 30 ', 30000],
  ['Thu, 19 Nov 2026 12:00:30 GMT', 30000],
  ['Thursday, 19-Nov-26 12:00:30 GMT', 30000],
  ['Thu Nov 19 12:00:30 2026', 30000],
  ['Thu, 19 Nov 2026 11:00:00 GMT', 0],
  ['1.5', undefined],
  ['-1', undefined],
  ['soon', undefined],
  ['', undefined],
  [null, undefined]
])('parseRetryAfter(%p) is %p ms', (header, expected) => {
  expect(parseRetryAfter(header, NOW)).toBe(expected)
})

test.each([undefined, '0'])(
  'succeeds after three 429 responses with Retry-After %s',
  async header => {
    for (let attempt = 0; attempt < 3; attempt++) {
      fetchMock.mockResolvedValueOnce(
        reply(
          429,
          {error: 'rate_limit_exceeded'},
          header ? {'Retry-After': header} : {}
        )
      )
    }
    fetchMock.mockResolvedValueOnce(reply(200, {access_token: 'record-key'}))

    const result = exchange()
    await jest.advanceTimersByTimeAsync(0)
    for (const [attempt, delay] of [1000, 2000, 4000].entries()) {
      expect(fetchMock).toHaveBeenCalledTimes(attempt + 2)
      await jest.advanceTimersByTimeAsync(delay - 1)
      expect(fetchMock).toHaveBeenCalledTimes(attempt + 2)
      await jest.advanceTimersByTimeAsync(1)
    }

    await expect(result).resolves.toBe('record-key')
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(jest.getTimerCount()).toBe(0)
  }
)

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
