# XLSX push trigger proposal

This proposal adds a temporary push-triggered workflow used to test `proposal/xlsx-ci-artifact-260625` without workflow_dispatch.

Trigger branch:

- `proposal/xlsx-ci-runner-260625`

When that branch is pushed, the workflow checks out:

- `proposal/xlsx-ci-artifact-260625`

It then runs metadata checks, tests, XLSX generation, and artifact upload.

This is a bootstrap/testing workflow. It does not claim to solve existing Excel preservation.
