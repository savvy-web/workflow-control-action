# workflow-control-action

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-24.x-brightgreen.svg)](https://nodejs.org)

A lightweight GitHub Action for pre-flight workflow control checks. Split monolithic release workflows into targeted workflows that only run when needed.

## Table of Contents

* [The Problem](#the-problem)
* [The Solution](#the-solution)
* [Installation](#installation)
* [Inputs](#inputs)
* [Outputs](#outputs)
* [Phase Detection Logic](#phase-detection-logic)
* [Usage Examples](#usage-examples)
  * [Phase 1: Release Branch Management](#phase-1-release-branch-management)
  * [Phase 2: Release Validation](#phase-2-release-validation)
  * [Phase 3: Release Publishing](#phase-3-release-publishing)
* [Integration with Savvy Web Actions](#integration-with-savvy-web-actions)
* [Job Summary Output](#job-summary-output)
* [Advanced Scenarios](#advanced-scenarios)
* [Requirements](#requirements)
* [License](#license)

## The Problem

The parent project `savvy-web/workflow-release-action` provides comprehensive release workflow automation handling branch management, validation, and publishing. However, a single monolithic workflow triggering on all pushes runs unnecessary jobs:

* Push to `main` with changesets should create/update release branch
* Push to `main` from merged release PR should publish packages
* Push to feature branch should do nothing
* All scenarios trigger the same workflow, wasting CI time and resources

## The Solution

**workflow-control-action** provides fast pre-flight checks (less than 5 seconds) to detect which workflow phase should run. This enables splitting a monolithic workflow into multiple targeted workflows:

* **Phase 1 (branch-management)**: Runs only when changesets are pushed to main
* **Phase 2 (validation)**: Runs only on the release branch
* **Phase 3 (publishing)**: Runs only when release PR is merged
* **Phase 3a (close-issues)**: Runs when release PR is merged to close related issues

## Installation

Add this action as a step in your workflow:

```yaml
- uses: savvy-web/workflow-control-action@v1
  id: control
  with:
    token: ${{ github.token }}
```

## Inputs

All inputs are optional with sensible defaults.

| Input            | Description                                          | Required | Default                  |
| ---------------- | ---------------------------------------------------- | -------- | ------------------------ |
| `token`          | GitHub token for API calls (detects merged PRs)      | No       | `${{ github.token }}`    |
| `release-branch` | Release branch name                                  | No       | `changeset-release/main` |
| `target-branch`  | Target branch name (usually main)                    | No       | `main`                   |

## Outputs

The action provides comprehensive outputs for workflow control decisions:

| Output              | Type    | Description                                                  |
| ------------------- | ------- | ------------------------------------------------------------ |
| `phase`             | string  | Detected phase: `branch-management`, `validation`, etc.      |
| `has_changesets`    | boolean | Whether changesets exist in `.changeset` directory           |
| `changeset_count`   | number  | Number of changeset files found                              |
| `release_type`      | string  | Highest release type: `major`, `minor`, `patch`, or empty    |
| `is_release_commit` | boolean | Whether this is a release merge commit                       |
| `is_release_branch` | boolean | Whether currently on the release branch                      |
| `is_main_branch`    | boolean | Whether currently on the target (main) branch                |
| `merged_pr_number`  | string  | PR number of the merged release PR (if detected)             |
| `should_continue`   | boolean | Whether the workflow should proceed (phase is not `none`)    |
| `reason`            | string  | Human-readable explanation of the phase detection            |

## Phase Detection Logic

The action uses a sophisticated detection algorithm:

1. **Phase 3a (close-issues)**: Detects `pull_request` event where release PR was merged to main
2. **Phase 3 (publishing)**: Push to main from a merged release PR commit
3. **Phase 2 (validation)**: Push to the release branch
4. **Phase 1 (branch-management)**: Push to main with a non-release commit
5. **none**: Any other scenario (feature branches, external PRs, etc.)

### Release Commit Detection

Release commits are identified using:

* **Primary method**: GitHub API query for PRs associated with the commit
* **Fallback methods**:
  * Commit message patterns (e.g., "chore: version packages")
  * Merge commit message analysis
  * Branch name patterns in commit messages

This dual approach ensures reliable detection even when API calls are unavailable.

## Usage Examples

### Phase 1: Release Branch Management

Create or update the release branch when changesets are pushed to main:

```yaml
# .github/workflows/release-branch.yml
name: Release Branch Management

on:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  control:
    name: Check Release Phase
    runs-on: ubuntu-latest
    outputs:
      should_continue: ${{ steps.control.outputs.should_continue }}
      phase: ${{ steps.control.outputs.phase }}
      has_changesets: ${{ steps.control.outputs.has_changesets }}
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Detect workflow phase
        id: control
        uses: savvy-web/workflow-control-action@v1

  branch-management:
    name: Update Release Branch
    needs: control
    if: needs.control.outputs.phase == 'branch-management'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
          persist-credentials: true

      - name: Setup runtime
        id: runtime
        uses: savvy-web/workflow-runtime-action@v1

      - name: Run release
        uses: savvy-web/workflow-release-action@v1
        with:
          phase: ${{ needs.control.outputs.phase }}
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Phase 2: Release Validation

Validate the release branch on every push:

```yaml
# .github/workflows/release-validate.yml
name: Release Validation

on:
  push:
    branches: [changeset-release/main]

permissions:
  contents: read

jobs:
  validate:
    name: Validate Release Branch
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Detect workflow phase
        id: control
        uses: savvy-web/workflow-control-action@v1

      - name: Display release info
        run: |
          echo "Phase: ${{ steps.control.outputs.phase }}"
          echo "Release type: ${{ steps.control.outputs.release_type }}"
          echo "Changeset count: ${{ steps.control.outputs.changeset_count }}"

      - name: Setup runtime
        uses: savvy-web/workflow-runtime-action@v1

      - name: Run validation
        run: |
          npm run build
          npm run test
          npm run lint
```

### Phase 3: Release Publishing

Publish packages when the release PR is merged:

```yaml
# .github/workflows/release-publish.yml
name: Release Publishing

on:
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  control:
    name: Check Release Phase
    runs-on: ubuntu-latest
    outputs:
      should_publish: ${{ steps.control.outputs.is_release_commit }}
      phase: ${{ steps.control.outputs.phase }}
      merged_pr: ${{ steps.control.outputs.merged_pr_number }}
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Detect workflow phase
        id: control
        uses: savvy-web/workflow-control-action@v1

  publish:
    name: Publish Packages
    needs: control
    if: needs.control.outputs.should_publish == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          persist-credentials: true

      - name: Setup runtime
        id: runtime
        uses: savvy-web/workflow-runtime-action@v1

      - name: Run release
        uses: savvy-web/workflow-release-action@v1
        with:
          phase: ${{ needs.control.outputs.phase }}
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  close-issues:
    name: Close Related Issues
    needs: [control, publish]
    if: needs.control.outputs.should_publish == 'true'
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Close related issues
        run: echo "Closing issues from PR #${{ needs.control.outputs.merged_pr }}"
        env:
          GH_TOKEN: ${{ github.token }}
```

## Integration with Savvy Web Actions

This action is part of a suite of **three companion actions** for release workflow automation:

| Action                    | Purpose                  | When to Use                              |
| ------------------------- | ------------------------ | ---------------------------------------- |
| `workflow-control-action` | Pre-flight checks        | Determine **IF** a workflow should run   |
| `workflow-runtime-action` | Runtime setup & caching  | Set up Node.js, pnpm, and cache deps     |
| `workflow-release-action` | Full release automation  | Perform the actual release operations    |

### Recommended Pattern

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  control:
    name: Check Release Phase
    runs-on: ubuntu-latest
    outputs:
      should_continue: ${{ steps.control.outputs.should_continue }}
      phase: ${{ steps.control.outputs.phase }}
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Detect workflow phase
        id: control
        uses: savvy-web/workflow-control-action@v1

  release:
    name: Run Release
    needs: control
    if: needs.control.outputs.should_continue == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      packages: write
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
          persist-credentials: true

      - name: Setup runtime
        id: runtime
        uses: savvy-web/workflow-runtime-action@v1

      - name: Run release
        uses: savvy-web/workflow-release-action@v1
        with:
          phase: ${{ needs.control.outputs.phase }}
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The `workflow-runtime-action` handles Node.js setup, package manager detection (npm/pnpm/yarn), dependency installation, and intelligent caching. This ensures consistent, fast builds across all release phases.

## Job Summary Output

The action automatically generates a beautiful markdown job summary showing:

* Detected workflow phase with visual indicators
* Git context (current branch, commit SHA)
* Release commit detection status
* Changeset analysis (count, release type, affected packages)
* Human-readable reasoning for the phase detection

This summary appears in the GitHub Actions UI under the job's summary tab.

## Advanced Scenarios

### Custom Release Branch Names

```yaml
- uses: savvy-web/workflow-control-action@v1
  with:
    release-branch: releases/next
    target-branch: main
```

### Skip Phase Check (Always Run)

```yaml
jobs:
  control:
    steps:
      - uses: savvy-web/workflow-control-action@v1
        id: control

  always-run:
    needs: control
    runs-on: ubuntu-latest
    steps:
      - run: echo "This runs regardless of phase"

  conditional-run:
    needs: control
    if: needs.control.outputs.phase == 'publishing'
    runs-on: ubuntu-latest
    steps:
      - run: echo "This only runs during publishing phase"
```

### Debug Output

All outputs are available for debugging:

```yaml
- uses: savvy-web/workflow-control-action@v1
  id: control

- name: Debug outputs
  run: |
    echo "Phase: ${{ steps.control.outputs.phase }}"
    echo "Should continue: ${{ steps.control.outputs.should_continue }}"
    echo "Reason: ${{ steps.control.outputs.reason }}"
    echo "Has changesets: ${{ steps.control.outputs.has_changesets }}"
    echo "Changeset count: ${{ steps.control.outputs.changeset_count }}"
    echo "Release type: ${{ steps.control.outputs.release_type }}"
    echo "Is release commit: ${{ steps.control.outputs.is_release_commit }}"
    echo "Merged PR: ${{ steps.control.outputs.merged_pr_number }}"
```

## Requirements

* **Node.js 24**: GitHub Actions hosted runners include Node.js 24
* **GitHub token**: Uses `github.token` by default (no configuration needed)
* **Changesets**: Assumes `.changeset` directory for changeset detection

## License

MIT

---

**Maintainer**: [savvy-web](https://github.com/savvy-web)

**Issues**: [Report bugs or request features](https://github.com/savvy-web/workflow-control-action/issues)
