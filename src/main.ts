import * as core from '@actions/core'
import {CancelResult, cancelWithApiToken, cancelWithRecordKey} from './api'
import {readApiUrl, readCredentials, readDirectorUrl} from './inputs'

export async function run(): Promise<void> {
  try {
    const credentials = readCredentials()
    let result: CancelResult

    if (credentials.kind === 'record-key') {
      core.info('Cancelling the run with a record key')
      core.info(`Project id: ${credentials.projectId}`)
      core.info(
        credentials.runId
          ? `Run id: ${credentials.runId}`
          : `CI build id: ${credentials.ciBuildId}`
      )

      if (credentials.runId && credentials.ciBuildId) {
        core.info('Both run-id and ci-build-id were provided, using run-id')
      }

      result = await cancelWithRecordKey({
        directorUrl: readDirectorUrl(),
        recordKey: credentials.recordKey,
        projectId: credentials.projectId,
        ciBuildId: credentials.ciBuildId,
        runId: credentials.runId
      })
    } else {
      core.info('Cancelling the run with an API key')
      core.info(`GitHub run id: ${credentials.githubRunId}`)
      core.info(`GitHub run attempt: ${credentials.githubRunAttempt}`)
      core.info(`Project id: ${credentials.projectId ?? 'not provided'}`)
      core.info(`CI build id: ${credentials.ciBuildId ?? 'not provided'}`)

      if (credentials.ciBuildId && !credentials.projectId) {
        core.warning(
          'ci-build-id is only used together with project-id. Falling back to the GitHub run id and attempt.'
        )
      }

      result = await cancelWithApiToken({
        apiUrl: readApiUrl(),
        apiToken: credentials.apiToken,
        githubRunId: credentials.githubRunId,
        githubRunAttempt: credentials.githubRunAttempt,
        projectId: credentials.projectId,
        ciBuildId: credentials.ciBuildId
      })
    }

    switch (result.outcome) {
      case 'cancelled':
        core.info(
          result.runId
            ? `Run ${result.runId} was cancelled`
            : 'The run was cancelled'
        )
        break
      case 'already-cancelled':
        core.info('The run was already cancelled')
        break
      // Nothing to cancel is the expected outcome when the workflow is
      // cancelled before any results reach Currents, so it must not fail the
      // step of an already cancelled workflow.
      case 'not-found':
        core.warning(result.message)
        break
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
