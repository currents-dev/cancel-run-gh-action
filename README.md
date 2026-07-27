# Cancel a Currents run

Cancels a [Currents](https://currents.dev) run when the GitHub Actions workflow that recorded it is cancelled.

A cancelled workflow stops reporting mid-run, so without this the run stays in progress until it hits the project's [run timeout](https://docs.currents.dev/dashboard/runs/run-timeouts).

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

The action reads the record key, the project and the CI build id from the same environment variables the reporting step uses, so a job that already exports them needs no inputs. Pass them as inputs instead if you prefer.

## Credentials

The action accepts either credential.

**`record-key`** — the same [record key](https://docs.currents.dev/guides/record-key) the reporting step uses, so the workflow needs no additional secret. It identifies the run within `project-id`, by `ci-build-id` or `run-id`.

**`api-token`** — a Currents [API key](https://docs.currents.dev/resources/api/api-keys). It can also identify the run by the GitHub run id and attempt, which the reporter stores on the run, so nothing else is required. Kept for workflows that already use it.

If both are provided, `record-key` is used.

## Identifying the run

With `record-key`, the run is identified by either `ci-build-id` or `run-id`. `run-id` wins when both are set.

**`ci-build-id`** is the usual choice from CI: set `CURRENTS_CI_BUILD_ID` on the job and the reporting step and this step read the same value, so nothing has to be passed between them.

> Set `CURRENTS_CI_BUILD_ID` explicitly. Without it Currents generates a CI build id that includes the test framework — `pw:owner/repo-16873-1` — which this step cannot reconstruct from the environment. It would report that there is no run to cancel.

**`run-id`** is the id in the run URL, `https://app.currents.dev/run/<run-id>`. Use it when the job already has the run id and can pass it on.

## Inputs

Every input is optional. `record-key`, `project-id`, `ci-build-id` and `run-id` fall back to `CURRENTS_RECORD_KEY`, `CURRENTS_PROJECT_ID`, `CURRENTS_CI_BUILD_ID` and `CURRENTS_RUN_ID`.

| Input                | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `record-key`         | Currents record key. The env fallback is skipped when `api-token` is set.                              |
| `api-token`          | Currents API key. Used when no record key is available.                                                |
| `project-id`         | Currents project ID. Required with `record-key`, optional with `api-token`.                            |
| `ci-build-id`        | CI build ID the run was recorded with.                                                                 |
| `run-id`             | Currents run ID. An alternative to `ci-build-id`, and takes precedence. Only used with `record-key`.   |
| `github-run-id`      | Only used with `api-token`. Defaults to the current workflow run.                                      |
| `github-run-attempt` | Only used with `api-token`. Defaults to the current workflow run attempt.                              |
| `director-url`       | Currents reporting URL, used with `record-key`. Defaults to `https://cy.currents.dev`.                 |
| `api-url`            | Currents REST API URL, used with `api-token`. Defaults to `https://api.currents.dev/v1`.               |

With `record-key`, `project-id` and one of `ci-build-id` / `run-id` must be available. With `api-token`, nothing else is required.

## Behavior

- **No run to cancel.** A workflow cancelled before any results reached Currents has no run. The action logs a warning and succeeds, so it does not add a failed step to an already cancelled workflow.
- **Already cancelled.** Every job of a parallel run can run this step. All but the first find the run already cancelled, which is reported as a success.
- **Retries.** Network errors and `429`/`5xx` responses are retried three times with a growing delay. Every other error fails the step.
- **Where the credential goes.** `director-url` and `api-url` are not pinned to a host, because self-hosted Currents needs them. A URL that is not `http`/`https` fails the step before anything is sent, sending a credential over plain `http` to anything but localhost logs a warning, and redirects are not followed — a `307` would repeat the request, credential included, against a host that was never checked.

## Examples

### With inputs instead of environment variables

```yaml
- name: Cancel the Currents run
  if: ${{ cancelled() }}
  uses: currents-dev/cancel-run-gh-action@v1
  with:
    record-key: ${{ secrets.CURRENTS_RECORD_KEY }}
    project-id: my-project-id
    ci-build-id: ${{ github.run_id }}-${{ github.run_attempt }}
```

### Cancelling a known run

```yaml
- name: Cancel the Currents run
  if: ${{ cancelled() }}
  uses: currents-dev/cancel-run-gh-action@v1
  with:
    record-key: ${{ secrets.CURRENTS_RECORD_KEY }}
    project-id: my-project-id
    run-id: ${{ needs.tests.outputs.run-id }}
```

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

## Releases

Releases move the `v1` tag, so `@v1` picks up fixes. See [action versioning](https://github.com/actions/toolkit/blob/main/docs/action-versioning.md).

The `record-key` credential calls `POST /v1/runs/cancel` on the Currents reporting service. Deploy that endpoint before moving `v1`, or every workflow on `@v1` that uses a record key fails with a 404. The `api-token` path is unaffected.
