# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **workflow-control-action** - a lightweight GitHub Action for pre-flight workflow control checks. It enables splitting monolithic release workflows into targeted workflows that only run when needed.

**Background**: The parent project `savvy-web/workflow-release-action` has a comprehensive release workflow handling branch management, validation, and publishing. The problem: a single workflow triggering on all pushes runs unnecessary jobs. This action provides lightweight pre-flight checks so workflows can be split into targeted pieces.

## Proposed Action Interface

```yaml
inputs:
  token:
    description: GitHub token for API calls
    required: true
  release-branch:
    description: Release branch name
    default: changeset-release/main
  target-branch:
    description: Target branch name
    default: main

outputs:
  phase:              # Detected workflow phase
  has_changesets:     # Whether changesets exist
  is_release_commit:  # Whether this is a release merge commit
  is_release_pr_merged: # Whether a release PR was just merged
  should_continue:    # Whether the workflow should proceed
```

## Example Workflow Split

Three workflows replace one monolithic workflow:

```yaml
# release-branch.yml - Phase 1: Create/update release branch
on:
  push:
    branches: [main]
# Uses: has_changesets && !is_release_commit

# release-validate.yml - Phase 2: Validate release branch
on:
  push:
    branches: [changeset-release/main]
# Always runs on release branch

# release-publish.yml - Phase 3: Publish on PR merge
on:
  pull_request:
    types: [closed]
    branches: [main]
# Uses: is_release_pr_merged
```

Workflows use conditionals like: `if: steps.control.outputs.should_continue == 'true'`

## Build & Development Commands

```bash
# Install dependencies (required first)
pnpm install

# Build the action (bundles to dist/)
pnpm build

# Run tests
pnpm test                    # or pnpm ci:test

# Run a single test file
pnpm vitest __tests__/detect-workflow-phase.test.ts

# Run tests matching a pattern
pnpm vitest -t "should detect branch-management"

# Linting
pnpm lint                    # Check only
pnpm lint:fix                # Apply safe fixes
pnpm lint:fix:unsafe         # Apply all fixes

# Type checking (use tsgo, not tsc)
pnpm typecheck               # Via turbo
pnpm exec tsgo --noEmit      # Direct

# Markdown linting
pnpm lint:md                 # Check only
pnpm lint:md:fix             # Apply fixes
```

## Architecture

### Action Entry Points

The action uses Node.js 24 with three lifecycle scripts bundled by `@vercel/ncc`:

- `src/pre.ts` → `dist/pre.js` - Pre-action setup
- `src/main.ts` → `dist/main.js` - Main action logic
- `src/post.ts` → `dist/post.js` - Post-action cleanup

### Core Utilities

**`src/utils/detect-workflow-phase.ts`** - Determines which workflow phase should run:

- `detectWorkflowPhase(options)` - Async version with GitHub API calls
- `detectWorkflowPhaseSync(options)` - Sync version using commit message patterns only

Phases: `"branch-management"` | `"validation"` | `"publishing"` | `"close-issues"` | `"none"`

**`src/utils/parse-changesets.ts`** - Currently hand-written changeset parsing. **Should be replaced** with official `@changesets/*` packages from [changesets/changesets](https://github.com/changesets/changesets/tree/main/packages).

**`src/utils/logger.ts`** - Consistent logging with emoji indicators for phases and states.

**`src/utils/summary-writer.ts`** - Job summary utilities using `@actions/core` summary API.

### Available Packages

Since ncc bundles all dependencies, use npm packages freely. Compiled actions execute extremely fast in GitHub Actions.

**GitHub Actions packages** (use liberally):

- `@actions/core` - Inputs, outputs, logging, **job summaries**
- `@actions/github` - Octokit client, context
- `@actions/exec`, `@actions/io`, `@actions/glob` - Shell operations
- `@actions/cache`, `@actions/tool-cache` - Caching utilities

**Changesets** (prefer over hand-written parsing):

- `@changesets/read` - Read changeset files
- `@changesets/parse` - Parse changeset content
- `@changesets/types` - TypeScript types
- See: <https://github.com/changesets/changesets/tree/main/packages>

**Utilities**:

- `ts-markdown` - Build markdown programmatically
- `semver` - Version parsing and comparison
- `@octokit/rest` - Full GitHub API client

### Logging & Job Summaries

Actions should produce **beautiful, helpful output**:

1. **Structured logging** via `@actions/core` (info, warning, error, debug, group)
2. **Markdown job summaries** explaining what was expected vs what happened
3. Use `ts-markdown` for building summary content
4. Use `core.summary` API to write to `$GITHUB_STEP_SUMMARY`

```typescript
import * as core from "@actions/core";

await core.summary
  .addHeading("Workflow Control Results")
  .addTable([["Phase", "Status"], ["branch-management", "✅ Active"]])
  .write();
```

### Build System

The build script (`lib/scripts/build.ts`) uses `@vercel/ncc` to bundle `src/main.ts` into a single self-contained `dist/main.js` file. It also copies the action to `.github/actions/release/` for local testing.

## Testing

Tests use Vitest with comprehensive mocking for GitHub Actions modules.

### Test Utilities (`__tests__/utils/`)

- **`github-mocks.ts`** - Factory functions for mocking `@actions/core`, `@actions/exec`, `@actions/cache`, and Octokit
- **`test-types.ts`** - TypeScript interfaces for mock objects (`MockOctokit`, `MockCore`, etc.)

Key patterns:

```typescript
import { createMockOctokit, setupTestEnvironment, cleanupTestEnvironment } from "./utils/github-mocks.js";

beforeEach(() => {
  setupTestEnvironment({ suppressOutput: true });
  mockOctokit = createMockOctokit();
});

afterEach(() => {
  cleanupTestEnvironment();
});
```

### Coverage

Vitest is configured with V8 coverage at 85% thresholds per file. Coverage reports go to `.coverage/`.

## Code Style

Biome enforces strict rules:

- **Tabs** for indentation, 120 character line width
- **Explicit `.js` extensions** in imports (even for `.ts` files)
- **Separate type imports**: `import type { Foo } from "./foo.js";`
- **Node.js protocol**: `import * as fs from "node:fs";`
- **Explicit types** required for exports (except in tests/scripts)

## Workflow Phase Detection Logic

The core detection algorithm:

1. **Phase 3a (close-issues)**: `pull_request` event where release PR was merged
2. **Phase 3 (publishing)**: Push to main from a merged release PR
3. **Phase 2 (validation)**: Push to release branch
4. **Phase 1 (branch-management)**: Push to main (non-release commit)
5. **none**: Any other scenario

Release commits are detected via:

- GitHub API query for PRs associated with the commit (primary)
- Commit message patterns as fallback (e.g., "chore: version packages", merge commit patterns)

## Development Status

**Current state**: The action is fully implemented and ready for use.

**Completed**:

- `src/main.ts` - Fully wired up to orchestrate utilities and set action outputs
- `action.yml` - Proper inputs (token, release-branch, target-branch) and outputs (phase, has_changesets, etc.)
- Job summary output with detection results and reasoning
- README.md with comprehensive documentation
- All 69 tests passing with 100% statement coverage

**Architecture**:

- Single entry point (`main.ts`) - no pre/post scripts needed
- Uses npm packages freely (ncc bundles everything, no runtime penalty)
- Fast execution - completes in <5 seconds
- Beautiful logging and detailed markdown job summaries

**Future improvements**:

- Consider replacing hand-written `parse-changesets.ts` with `@changesets/*` packages (current implementation works well)
