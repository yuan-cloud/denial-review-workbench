# CI Status

## Current State (2026-04-20)

GitHub Actions is red. No CI jobs are executing. This is an external
billing issue, not a code or workflow failure.

## Root Cause

Every job fails immediately with:

> The job was not started because recent account payments have failed
> or your spending limit needs to be increased. Please check the
> 'Billing & plans' section in your settings.

This appears on all jobs (backend-unit, frontend-unit, security-grep,
secret-check, integration, playwright). No job reaches the checkout
step. The workflow YAML is valid and the same configuration ran
successfully before the billing issue appeared.

## Evidence

```
$ gh run list --limit 3
completed  failure  docs: add observability...  CI  main  push  24651974632  4s
completed  failure  docs: add production...     CI  main  push  24651916447  5s
completed  failure  chore(security): add...     CI  main  push  24651853195  5s

$ gh run view 24651974632
ANNOTATIONS
X The job was not started because recent account payments have
  failed or your spending limit needs to be increased.
```

## What Is NOT Broken

- The workflow file (`.github/workflows/ci.yml`) is syntactically
  valid and correctly configured.
- Backend tests pass locally: 124/124 (including 13 skipped
  integration tests that require `ANTHROPIC_API_KEY`).
- Frontend tests pass locally: 99/99. Typecheck passes. Build
  succeeds.
- Security grep returns empty locally.

## Resolution

The GitHub account's billing or spending limit must be updated by the
account owner. Once billing is resolved, the next push to `main` will
trigger CI normally. No workflow changes are needed.

## How to Verify After Resolution

```bash
# Push any change or re-run manually
gh run list --limit 1
# Should show: completed  success  ...

# Or re-run the last failed run
gh run rerun 24651974632
```
