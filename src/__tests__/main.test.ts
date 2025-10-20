import * as core from '@actions/core'
import nock from 'nock'
import {request, run} from '../main'

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

  test('project-id is optional', async () => {
    process.env['INPUT_API-URL'] = currentsApiUrl
    process.env['INPUT_API-TOKEN'] = 'api-token'
    process.env['INPUT_GITHUB-RUN-ID'] = githubRunId
    process.env['INPUT_GITHUB-RUN-ATTEMPT'] = githubRunAttempt

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    const setFailedSpy = jest.spyOn(core, 'setFailed')
    const infoSpy = jest.spyOn(core, 'info')

    await run()

    expect(setFailedSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith('Project id: not provided')
    expect(infoSpy).toHaveBeenCalledWith('CI build id: not provided')
    expect(infoSpy).toHaveBeenCalledWith(
      'Using GitHub run id and attempt to identify and cancel the run.'
    )
  })

  test('ci-build-id is optional', async () => {
    process.env['INPUT_API-URL'] = currentsApiUrl
    process.env['INPUT_API-TOKEN'] = 'api-token'
    process.env['INPUT_GITHUB-RUN-ID'] = githubRunId
    process.env['INPUT_GITHUB-RUN-ATTEMPT'] = githubRunAttempt

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    const setFailedSpy = jest.spyOn(core, 'setFailed')
    const infoSpy = jest.spyOn(core, 'info')

    await run()

    expect(setFailedSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith('Project id: not provided')
    expect(infoSpy).toHaveBeenCalledWith('CI build id: not provided')
    expect(infoSpy).toHaveBeenCalledWith(
      'Using GitHub run id and attempt to identify and cancel the run.'
    )
  })

  test('ci-build-id without project-id shows warning', async () => {
    process.env['INPUT_API-URL'] = currentsApiUrl
    process.env['INPUT_API-TOKEN'] = 'api-token'
    process.env['INPUT_GITHUB-RUN-ID'] = githubRunId
    process.env['INPUT_GITHUB-RUN-ATTEMPT'] = githubRunAttempt
    process.env['INPUT_CI-BUILD-ID'] = 'build-123'

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    const spy = jest.spyOn(core, 'info')

    await run()

    expect(spy).toHaveBeenCalledWith(
      'CI build id requires project ID. Please provide both project ID and CI build id if you expect the run to be cancelled based on the CI build id.'
    )
    expect(spy).toHaveBeenCalledWith('Project id: not provided')
    expect(spy).toHaveBeenCalledWith('CI build id: build-123')
    expect(spy).toHaveBeenCalledWith(
      'Using GitHub run id and attempt to identify and cancel the run.'
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
    delete process.env['INPUT_PROJECT-ID']
    delete process.env['INPUT_CI-BUILD-ID']
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

  test('should include project-id when provided', async () => {
    const projectId = 'test-project-123'
    process.env['INPUT_PROJECT-ID'] = projectId

    const infoSpy = jest.spyOn(core, 'info')

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    const scope = nock(currentsApiUrl)
      .put(currentsApiCancelationPath, body => {
        expect(body.projectId).toBe(projectId)
        return true
      })
      .reply(200, result)

    await run()

    expect(infoSpy).toHaveBeenCalledWith(`Project id: ${projectId}`)
    expect(infoSpy).toHaveBeenCalledWith('CI build id: not provided')
    expect(infoSpy).toHaveBeenCalledWith(
      'Using GitHub run id and attempt to identify and cancel the run.'
    )
    expect(scope.isDone()).toBe(true)
  })

  test('should include ci-build-id when provided with project-id', async () => {
    const projectId = 'test-project-456'
    const ciBuildId = 'build-456'
    process.env['INPUT_PROJECT-ID'] = projectId
    process.env['INPUT_CI-BUILD-ID'] = ciBuildId

    const infoSpy = jest.spyOn(core, 'info')

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    const scope = nock(currentsApiUrl)
      .put(currentsApiCancelationPath, body => {
        expect(body.projectId).toBe(projectId)
        expect(body.ciBuildId).toBe(ciBuildId)
        return true
      })
      .reply(200, result)

    await run()

    expect(infoSpy).toHaveBeenCalledWith(`Project id: ${projectId}`)
    expect(infoSpy).toHaveBeenCalledWith(`CI build id: ${ciBuildId}`)
    expect(infoSpy).toHaveBeenCalledWith(
      'Using project id and CI build id to identify and cancel the run.'
    )
    expect(scope.isDone()).toBe(true)
  })

  test('should include both project-id and ci-build-id when provided', async () => {
    const projectId = 'test-project-789'
    const ciBuildId = 'build-012'
    process.env['INPUT_PROJECT-ID'] = projectId
    process.env['INPUT_CI-BUILD-ID'] = ciBuildId

    const infoSpy = jest.spyOn(core, 'info')

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    const scope = nock(currentsApiUrl)
      .put(currentsApiCancelationPath, body => {
        expect(body.projectId).toBe(projectId)
        expect(body.ciBuildId).toBe(ciBuildId)
        return true
      })
      .reply(200, result)

    await run()

    expect(infoSpy).toHaveBeenCalledWith(`Project id: ${projectId}`)
    expect(infoSpy).toHaveBeenCalledWith(`CI build id: ${ciBuildId}`)
    expect(infoSpy).toHaveBeenCalledWith(
      'Using project id and CI build id to identify and cancel the run.'
    )
    expect(scope.isDone()).toBe(true)
  })

  test('should log "not provided" when project-id and ci-build-id are not provided', async () => {
    const infoSpy = jest.spyOn(core, 'info')

    const result = {
      status: 'OK',
      actor: 'api',
      canceledAt: new Date().toDateString(),
      reason: 'api call'
    }

    nock(currentsApiUrl).put(currentsApiCancelationPath).reply(200, result)

    await run()

    expect(infoSpy).toHaveBeenCalledWith('Project id: not provided')
    expect(infoSpy).toHaveBeenCalledWith('CI build id: not provided')
    expect(infoSpy).toHaveBeenCalledWith(
      'Using GitHub run id and attempt to identify and cancel the run.'
    )
  })
})
