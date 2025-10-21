import * as core from '@actions/core'
import {HttpClient} from '@actions/http-client'
import {BearerCredentialHandler} from '@actions/http-client/lib/auth'
import {TypedResponse} from '@actions/http-client/lib/interfaces'
import pRetry, {AbortError} from 'p-retry'

export type ResponseStatus = 'OK' | 'FAILED'
export type RunCancellation = {
  actor: string
  canceledAt: string
  reason: string
}
export type CancelRunGithubCIRouteParams = {
  githubRunId?: string
  githubRunAttempt?: number
  projectId?: string
  ciBuildId?: string
}

export async function request<A, B>({
  url,
  body,
  bearerToken
}: {
  url: string
  body: A
  bearerToken: string
}): Promise<TypedResponse<B>> {
  const http = new HttpClient('cancel-currents-run-action', [
    new BearerCredentialHandler(bearerToken)
  ])

  return http.putJson<B>(url, body)
}

export async function run(): Promise<void> {
  try {
    const currentsApiUrl =
      core.getInput('api-url', {required: false, trimWhitespace: true}) ??
      `https://api.currents.dev/v1`
    const bearerToken = core.getInput('api-token', {required: true})
    const githubRunId = core.getInput('github-run-id', {required: true})
    const githubRunAttempt = core.getInput('github-run-attempt', {
      required: true
    })
    const projectId = core.getInput('project-id', {required: false})
    const ciBuildId = core.getInput('ci-build-id', {required: false})

    core.info('Cancelling via Currents API...')
    core.info(`GitHub run id: ${githubRunId}`)
    core.info(`GitHub run attempt: ${githubRunAttempt}`)

    // Always log both optional IDs, and state which identifiers will be used
    const projectIdProvided = Boolean(projectId)
    const ciBuildIdProvided = Boolean(ciBuildId)
    core.info(`Project id: ${projectIdProvided ? projectId : 'not provided'}`)
    core.info(`CI build id: ${ciBuildIdProvided ? ciBuildId : 'not provided'}`)

    if (projectIdProvided && ciBuildIdProvided) {
      core.info(
        'Using project id and CI build id to identify and cancel the run.'
      )
    } else {
      core.info(
        'Using GitHub run id and attempt to identify and cancel the run.'
      )
    }

    if (ciBuildId && !projectId) {
      core.info(
        'CI build id requires project ID. Please provide both project ID and CI build id if you expect the run to be cancelled based on the CI build id.'
      )
    }

    const result = await pRetry(
      async () => {
        const response = await request<
          {
            githubRunId: string
            githubRunAttempt: string
            projectId?: string
            ciBuildId?: string
          },
          {
            status: ResponseStatus
            data: RunCancellation & CancelRunGithubCIRouteParams
          } | null
        >({
          url: `${currentsApiUrl}/runs/cancel-ci/github`,
          bearerToken,
          body: {
            githubRunId,
            githubRunAttempt,
            projectId,
            ciBuildId
          }
        })

        if (response.result === null) {
          throw new AbortError('Resource not found')
        }

        return response
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 10000,
        onFailedAttempt: error => {
          core.info(
            `Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`
          )
        }
      }
    )

    if (core.isDebug()) {
      core.debug(JSON.stringify(result))
    }

    core.info('The run was successfully canceled!')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
