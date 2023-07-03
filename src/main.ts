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
  githubRunId: string
  githubRunAttempt: number
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
    const currentsApiUrl = `https://api.currents.dev/v1`
    const bearerToken = core.getInput('api-token', {required: true})
    const githubRunId = core.getInput('github-run-id', {required: true})
    const githubRunAttempt = core.getInput('github-run-attempt', {
      required: true
    })

    core.info('Cancelling via Currents API...')
    core.info(`GitHub run id: ${githubRunId}`)
    core.info(`GitHub run attempt: ${githubRunAttempt}`)

    const result = await pRetry(
      async () => {
        const response = await request<
          {
            githubRunId: string
            githubRunAttempt: string
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
            githubRunAttempt
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
