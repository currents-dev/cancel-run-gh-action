<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/actions/typescript-action/workflows/build-test/badge.svg"></a>
</p>

# Cancel Cypress or Playwright Run

This action cancels the Cypress or Playwright on Currents Dashboard if the associated GitHub workflow gets canceled.

## Inputs

### `api-token`

**Required** Currents [API Token](https://currents.dev/readme/api/api-keys)

### `github-run-id`

**Required** GitHub Actions run id - should match the [`GITHUB_RUN_ID`](https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables)

### `github-run-attempt`

**Required** GitHub Actions run attempt - should match the [`GITHUB_RUN_ATTEMPT`](https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables)

## Example

```yaml
- name: Cancel Currents run if the workflow is cancelled
  if: ${{ cancelled() }}
  uses: currents-dev/cancel-run-gh-action@v1
  with:
    api-token: ${{ secrets.CURRENTS_API_TOKEN }}
    github-run-id: ${{ github.run_id }}
    github-run-attempt: ${{ github.run_attempt }}
```

## Development

The repository is made using [this](https://github.com/actions/typescript-action) template

> First, you'll need to have a reasonably modern version of `node` handy. This won't work with versions older than 9, for instance.

Install the dependencies

```bash
$ npm install
```

Build the typescript and package it for distribution

```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:

```bash
$ npm test

 PASS  ./index.test.js
  ✓ throws invalid number (3ms)
  ✓ wait 500 ms (504ms)
  ✓ test runs (95ms)

...
```

### Change action.yml

The action.yml defines the inputs and output for your action.

Update the action.yml with your name, description, inputs and outputs for your action.

See the [documentation](https://help.github.com/en/articles/metadata-syntax-for-github-actions)

### Change the Code

Most toolkit and CI/CD operations involve async operations so the action is run in an async function.

```javascript
import * as core from '@actions/core';
...

async function run() {
  try {
      ...
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
```

See the [toolkit documentation](https://github.com/actions/toolkit/blob/master/README.md#packages) for the various packages.

## Publish to a distribution branch

Actions are run from GitHub repos so we will commit the packed dist folder.

Then run [ncc](https://github.com/zeit/ncc) and push the results:

```bash
$ npm run buld
$ npm run package
$ git add dist
$ git commit -a -m "prod dependencies"
$ git push origin releases/v1
```

Note: We recommend using the `--license` option for ncc, which will create a license file for all of the production node modules used in your project.

Your action is now published! :rocket:

See the [versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

### Validate

You can now validate the action by referencing `./` in a workflow in your repo (see [test.yml](.github/workflows/test.yml))

```yaml
uses: ./
with:
  milliseconds: 1000
```

See the [actions tab](https://github.com/actions/typescript-action/actions) for runs of this action! :rocket:

### Usage:

After testing you can [create a v1 tag](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md) to reference the stable and latest V1 action
