# Cancel a Currents run

Cancels a [Currents](https://currents.dev) run when the GitHub Actions workflow that recorded it is cancelled.

A cancelled workflow stops reporting mid-run, so without this the run stays in progress until it hits the project's [run timeout](https://docs.currents.dev/dashboard/runs/run-timeouts).

```yaml
- name: Cancel the Currents run
  if: ${{ cancelled() }}
  uses: currents-dev/cancel-run-gh-action@v1
  with:
    record-key: ${{ secrets.CURRENTS_RECORD_KEY }}
    project-id: my-project-id
    ci-build-id: ${{ github.run_id }}-${{ github.run_attempt }}
```

## Credentials

The action accepts either credential.

**`record-key`** — the same [record key](https://docs.currents.dev/guides/record-key) the reporting step uses, so the workflow needs no additional secret. It identifies the run by `project-id` and `ci-build-id`, which must match the values the reporting step used.

**`api-token`** — a Currents [API key](https://docs.currents.dev/resources/api/api-keys). It can also identify the run by the GitHub run id and attempt, which the reporter stores on the run, so `project-id` and `ci-build-id` are optional. Kept for workflows that already use it.

If both are provided, `record-key` is used.

## Inputs

| Input                | Required          | Description                                                                              |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `record-key`         | one of the two    | Currents record key. Defaults to `CURRENTS_RECORD_KEY` when `api-token` is not set.        |
| `api-token`          | one of the two    | Currents API key.                                                                          |
| `project-id`         | with `record-key` | Currents project ID. Defaults to `CURRENTS_PROJECT_ID`.                                    |
| `ci-build-id`        | with `record-key` | CI build ID the run was recorded with. Defaults to `CURRENTS_CI_BUILD_ID`.                 |
| `github-run-id`      | no                | Only used with `api-token`. Defaults to the current workflow run.                          |
| `github-run-attempt` | no                | Only used with `api-token`. Defaults to the current workflow run attempt.                  |
| `director-url`       | no                | Currents reporting URL, used with `record-key`. Defaults to `https://cy.currents.dev`.     |
| `api-url`            | no                | Currents REST API URL, used with `api-token`. Defaults to `https://api.currents.dev/v1`.   |

## Behavior

- **No run to cancel.** A workflow cancelled before any results reached Currents has no run. The action logs a warning and succeeds, so it does not add a failed step to an already cancelled workflow.
- **Already cancelled.** Every job of a parallel run can run this step. All but the first find the run already cancelled, which is reported as a success.
- **Retries.** Network errors and `429`/`5xx` responses are retried three times with a growing delay. Every other error fails the step.

## Examples

### With the record key the tests already use

```yaml
env:
  CURRENTS_RECORD_KEY: ${{ secrets.CURRENTS_RECORD_KEY }}
  CURRENTS_PROJECT_ID: my-project-id
  CURRENTS_CI_BUILD_ID: ${{ github.run_id }}-${{ github.run_attempt }}

steps:
  - name: Run tests
    run: npx playwright test

  - name: Cancel the Currents run
    if: ${{ cancelled() }}
    uses: currents-dev/cancel-run-gh-action@v1
```

The action reads the record key, project and CI build id from the environment the reporting step already sets.

### With an API key

```yaml
- name: Cancel the Currents run
  if: ${{ cancelled() }}
  uses: currents-dev/cancel-run-gh-action@v1
  with:
    api-token: ${{ secrets.CURRENTS_API_KEY }}
```

The run is matched by the GitHub run id and attempt. Add `project-id` and `ci-build-id` to match by CI build id instead, which is what you need when the workflow records under a CI build id of its own.

### Without a GitHub action

The same thing on any CI provider, using the [Currents CLI](https://docs.currents.dev/resources/reporters/currents-cmd/currents-cancel):

```yaml
- name: Cancel the Currents run
  if: ${{ cancelled() }}
  run: npx currents cancel
```

## Development

```bash
npm install
npm run all     # typecheck, format check, lint, package, test
```

`dist/` is the bundle workflows actually run. It is built by `npm run package` and committed — CI fails if it does not match `src/`.

Releases move the `v1` tag, so `@v1` picks up fixes. See [action versioning](https://github.com/actions/toolkit/blob/main/docs/action-versioning.md).
