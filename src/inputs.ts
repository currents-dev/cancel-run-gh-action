import * as core from '@actions/core'

export const DEFAULT_API_URL = 'https://api.currents.dev/v1'
export const DEFAULT_DIRECTOR_URL = 'https://cy.currents.dev'

/**
 * The record key path identifies the run the same way the reporter recorded it,
 * so it needs the project and the CI build id. The API token path can also look
 * the run up by the GitHub run id and attempt stored on it.
 */
export type Credentials =
  | {
      kind: 'record-key'
      recordKey: string
      projectId: string
      ciBuildId: string
    }
  | {
      kind: 'api-token'
      apiToken: string
      githubRunId: string
      githubRunAttempt: string
      projectId?: string
      ciBuildId?: string
    }

function input(name: string, fallback?: string): string {
  return core.getInput(name, {trimWhitespace: true}) || fallback || ''
}

export function readCredentials(): Credentials {
  const apiToken = input('api-token')

  // The env fallback only applies when api-token is absent: a workflow that
  // exports CURRENTS_RECORD_KEY for the whole job must keep using the api-token
  // it passes to this step.
  const recordKey = apiToken
    ? input('record-key')
    : input('record-key', process.env.CURRENTS_RECORD_KEY)

  if (recordKey) {
    core.setSecret(recordKey)

    if (apiToken) {
      core.info('Both record-key and api-token were provided, using record-key')
    }

    const projectId = input('project-id', process.env.CURRENTS_PROJECT_ID)
    const ciBuildId = input('ci-build-id', process.env.CURRENTS_CI_BUILD_ID)
    const missing = [
      projectId ? null : 'project-id',
      ciBuildId ? null : 'ci-build-id'
    ].filter(Boolean)

    if (missing.length) {
      throw new Error(
        `record-key requires ${missing.join(
          ' and '
        )} to identify the run. Pass the same values the reporting step used, or set CURRENTS_PROJECT_ID and CURRENTS_CI_BUILD_ID.`
      )
    }

    return {kind: 'record-key', recordKey, projectId, ciBuildId}
  }

  if (!apiToken) {
    throw new Error(
      'Provide record-key, or api-token to cancel with a Currents API key.'
    )
  }

  core.setSecret(apiToken)

  // Both are always set by the runner, so the inputs only exist to override them.
  const githubRunId = input('github-run-id', process.env.GITHUB_RUN_ID)
  const githubRunAttempt = input(
    'github-run-attempt',
    process.env.GITHUB_RUN_ATTEMPT
  )

  if (!githubRunId || !githubRunAttempt) {
    throw new Error(
      'api-token requires github-run-id and github-run-attempt to identify the run.'
    )
  }

  return {
    kind: 'api-token',
    apiToken,
    githubRunId,
    githubRunAttempt,
    projectId: input('project-id') || undefined,
    ciBuildId: input('ci-build-id') || undefined
  }
}

export function readApiUrl(): string {
  return input('api-url', DEFAULT_API_URL).replace(/\/+$/, '')
}

export function readDirectorUrl(): string {
  return input('director-url', DEFAULT_DIRECTOR_URL).replace(/\/+$/, '')
}
