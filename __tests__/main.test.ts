import * as core from '@actions/core'
import nock from 'nock'
import {request, run} from '../src/main'

const currentsApiUrl = 'http://localhost:4000/v1'
const currentsApiCancelationPath = '/runs/cancel-ci/github'
const githubRunId = '45166321'
const githubRunAttempt = '1'

describe('input validation', () => {
  test('api-token is required', async () => {
    process.env['INPUT_API-URL'] = currentsApiUrl

    const spy = jest.spyOn(core, 'setFailed')

    await run()

    expect(spy).toHaveBeenCalledWith(
      'Input required and not supplied: api-token'
    )
  })

  test('github-run-id is required', async () => {
    process.env['INPUT_API-URL'] = currentsApiUrl
    process.env['INPUT_API-TOKEN'] = 'api-token'

    const spy = jest.spyOn(core, 'setFailed')

    await run()

    expect(spy).toHaveBeenCalledWith(
      'Input required and not supplied: github-run-id'
    )
  })

  test('github-run-attempt is required', async () => {
    process.env['INPUT_API-TOKEN'] = 'api-token'
    process.env['INPUT_GITHUB-RUN-ID'] = githubRunId

    const spy = jest.spyOn(core, 'setFailed')

    await run()

    expect(spy).toHaveBeenCalledWith(
      'Input required and not supplied: github-run-attempt'
    )
  })
})

describe('api request', () => {
  beforeEach(() => {
    process.env['INPUT_API-URL'] = currentsApiUrl
    process.env['INPUT_API-TOKEN'] = 'api-token'
    process.env['INPUT_GITHUB-RUN-ID'] = githubRunId
    process.env['INPUT_GITHUB-RUN-ATTEMPT'] = githubRunAttempt
  })

  afterEach(() => {
    delete process.env['INPUT_API-URL']
    delete process.env['INPUT_API-TOKEN']
    delete process.env['INPUT_GITHUB-RUN-ID']
    delete process.env['INPUT_GITHUB-RUN-ATTEMPT']
  })

  test('should resolve when status code is not 200', () => {
    const error = JSON.stringify({
      error: 'Invalid params'
    })
    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(400, error)
    expect(
      request({
        url: `${currentsApiUrl}${currentsApiCancelationPath}`,
        body: {
          githubRunId,
          githubRunAttempt
        },
        bearerToken: 'token'
      })
    ).rejects.toThrowError(error)
  })

  test('should fail when status code is 404', async () => {
    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(404, {})
    const spy = jest.spyOn(core, 'setFailed')

    await run()
    expect(spy).toHaveBeenCalledWith('Resource not found')
  })

  test('should retry when status code is 500', async () => {
    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(500)
    const spy = jest.spyOn(core, 'setFailed')

    await run()
    expect(spy).toBeCalled()
  }, 15000)

  test('should fail when the input is invalid', async () => {
    process.env['INPUT_API-URL'] = 'bad url'
    const spy = jest.spyOn(core, 'setFailed')

    await run()
    expect(spy).toHaveBeenCalledWith(expect.any(String))
  })

  test('should return the result when status code is 200', () => {
    const result = {
      githubRunId,
      githubRunAttempt,
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    expect(
      request({
        url: `${currentsApiUrl}${currentsApiCancelationPath}`,
        body: {
          githubRunId,
          githubRunAttempt
        },
        bearerToken: 'token'
      })
    ).resolves.toEqual({
      headers: {
        'content-type': 'application/json'
      },
      result,
      statusCode: 200
    })
  })

  test('should show the result when debug is enabled', async () => {
    const result = {
      // githubRunId,
      // githubRunAttempt,
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    const spy = jest.spyOn(core, 'debug')

    // enable debug
    process.env['RUNNER_DEBUG'] = '1'

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    await run()

    expect(spy).toHaveBeenCalled()
  })
})
