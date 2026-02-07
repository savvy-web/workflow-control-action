---
status: current
module: workflow-control-action
category: architecture
created: 2026-02-07
updated: 2026-02-07
last-synced: 2026-02-07
completeness: 85
related:
  - workflow-control-action/phase-detection.md
dependencies: []
---

# Workflow Control Action Architecture

## Overview

The workflow-control-action is a lightweight GitHub Action that performs
pre-flight checks to determine which release workflow phase should execute.
It replaces a monolithic release workflow with targeted workflows that only
run when needed, reducing CI/CD resource usage and improving clarity.

The action runs as a single Node.js 24 entry point (`src/main.ts`) that
orchestrates three subsystems: workflow phase detection, changeset parsing,
and output generation (logging and job summaries). It uses `@vercel/ncc` to
bundle all dependencies into a single `dist/main.js` file for fast
execution in GitHub Actions.

## Current State

The action is fully implemented and production-ready with:

- **Single entry point** (`src/main.ts`) -- no pre/post scripts needed
- **5 workflow phases** detected: `branch-management`, `validation`,
  `publishing`, `close-issues`, `none`
- **10 action outputs** providing fine-grained workflow control signals
- **Markdown job summaries** via `@actions/core` summary API and
  `ts-markdown`
- **69 tests** passing with 100% statement coverage
- **Fast execution** completing in under 5 seconds

### File Structure

```text
src/
  main.ts                          # Action entry point and orchestrator
  utils/
    detect-workflow-phase.ts       # Phase detection algorithm (async + sync)
    parse-changesets.ts            # Changeset file parsing
    logger.ts                      # Structured logging with emoji indicators
    summary-writer.ts              # Job summary markdown generation
  types/
    global.d.ts                    # Global type augmentations
    shared-types.ts                # Validation and publish result types
    publish-config.ts              # Multi-registry publish configuration types
```

## System Architecture

### Entry Point: `src/main.ts`

The main orchestrator follows a linear pipeline:

1. **Read inputs** -- `token`, `release-branch`, `target-branch` from
   `action.yml`
2. **Detect phase** -- calls either `detectWorkflowPhase` (async, with
   GitHub API) or `detectWorkflowPhaseSync` (sync, message patterns only)
   depending on whether a token is provided
3. **Parse changesets** -- reads `.changeset/` directory for changeset
   files
4. **Log context** -- outputs structured context information about the
   current git state
5. **Set outputs** -- sets all 10 action outputs for downstream workflow
   steps
6. **Write summary** -- generates a markdown job summary with phase,
   context, and changeset tables

The orchestrator wraps everything in a try/catch that calls
`core.setFailed()` on error, ensuring the action fails gracefully with a
clear error message.

### Subsystem: Phase Detection

See the dedicated design doc at
`workflow-control-action/phase-detection.md` for the full algorithm.

The phase detection subsystem (`src/utils/detect-workflow-phase.ts`)
exports two functions:

- **`detectWorkflowPhase(options)`** -- Async version that uses the GitHub
  API via Octokit to query PRs associated with the current commit. This is
  the primary detection path when a token is available.
- **`detectWorkflowPhaseSync(options)`** -- Sync version that relies
  solely on commit message pattern matching. Used as a fallback when no
  token is provided.

Both return a `PhaseDetectionResult` containing the detected phase, a
human-readable reason, and boolean flags for branch/commit/PR state.

### Subsystem: Changeset Parsing

The changeset parser (`src/utils/parse-changesets.ts`) reads the
`.changeset/` directory and extracts:

- **Changeset count** and presence flag
- **Per-changeset data** -- ID, summary, and releases (package name +
  bump type)
- **Aggregated data** -- highest release type across all changesets,
  deduplicated affected packages, and a map of package-to-highest-bump

The parser handles YAML frontmatter in changeset files using a simple
regex-based approach. Each changeset file has the format:

```markdown
---
"package-name": major
"@scope/package": minor
---

Summary of changes
```

The CLAUDE.md notes this hand-written parser could be replaced with
official `@changesets/*` packages, though the current implementation works
correctly.

### Subsystem: Logging

The logger (`src/utils/logger.ts`) provides consistent, structured output
using `@actions/core` methods. It defines two constant objects:

- **`STATE`** -- Emoji indicators for status: good (green), neutral
  (white), warning (yellow), issue (red)
- **`PHASE`** -- Emoji indicators for phases: branch (leaf), validation
  (check), publish (package), skip (fast-forward), rocket, test

The logger object exposes methods for common logging patterns: `start`,
`phase`, `step`/`endStep`, `context`, `success`, `info`, `warn`, `error`,
`skip`, `phaseComplete`, and `noAction`.

### Subsystem: Summary Writing

The summary writer (`src/utils/summary-writer.ts`) builds markdown job
summaries using the `ts-markdown` library for type-safe generation. It
provides:

- **`write(markdown)`** -- Writes to `$GITHUB_STEP_SUMMARY`
- **`table(headers, rows)`** -- Standard markdown tables
- **`keyValueTable(entries)`** -- Property/Value format tables
- **`list(items)`** -- Bulleted lists
- **`heading(text, level)`** -- H2/H3/H4 headings
- **`codeBlock(code, lang)`** -- Fenced code blocks
- **`section(heading, level, content)`** -- Heading + content pairs
- **`build(sections)`** -- Assembles multiple sections into a complete
  summary

## Data Flow

```text
GitHub Event
    |
    v
+-------------------+
|    main.ts        |
|   (orchestrator)  |
+-------------------+
    |           |
    v           v
+---------+  +-----------+
| detect  |  |  parse    |
| phase   |  | changesets|
+---------+  +-----------+
    |           |
    v           v
+-------------------+
|  Set 10 outputs   |
|  Log context      |
|  Write summary    |
+-------------------+
    |
    v
Downstream workflow steps
use outputs for conditionals
```

## Action Inputs and Outputs

### Inputs

| Input | Required | Default | Description |
| :---- | :------- | :------ | :---------- |
| `token` | No | `github.token` | GitHub token for API calls |
| `release-branch` | No | `changeset-release/main` | Release branch name |
| `target-branch` | No | `main` | Target branch name |

### Outputs

| Output | Type | Description |
| :----- | :--- | :---------- |
| `phase` | string | Detected workflow phase |
| `has_changesets` | string | Whether changesets exist |
| `changeset_count` | string | Number of changeset files |
| `release_type` | string | Highest release type (major/minor/patch) |
| `is_release_commit` | string | Whether this is a release merge commit |
| `is_release_branch` | string | Whether on the release branch |
| `is_main_branch` | string | Whether on the target branch |
| `merged_pr_number` | string | PR number of merged release PR |
| `should_continue` | string | Whether the workflow should proceed |
| `reason` | string | Human-readable detection explanation |

## Build System

The build uses `@savvy-web/github-action-builder` which wraps `@vercel/ncc`
to bundle `src/main.ts` into `dist/main.js`. Since ncc inlines all
dependencies, the action executes extremely fast with no node_modules
resolution at runtime.

Key build commands:

- `pnpm build` -- Production build via turbo
- `pnpm build:prod` -- Direct build via github-action-builder
- `pnpm validate` -- Validates the action configuration

## Integration Points

### Workflow Split Pattern

The action enables splitting one monolithic workflow into three targeted
workflows:

1. **release-branch.yml** (Phase 1) -- Triggers on push to main, uses
   `has_changesets` and `!is_release_commit` to create/update the release
   branch
2. **release-validate.yml** (Phase 2) -- Triggers on push to the release
   branch or open PR from release to main, always runs validation
3. **release-publish.yml** (Phase 3) -- Triggers on `pull_request` closed
   event on main, uses `is_release_pr_merged` to publish packages

Each workflow runs this action first, then conditionally proceeds:

```yaml
- uses: savvy-web/workflow-control-action@main
  id: control
  with:
    token: ${{ secrets.GITHUB_TOKEN }}

- name: Run release step
  if: steps.control.outputs.should_continue == 'true'
  run: ...
```

### Type System

The `src/types/` directory contains types that are forward-looking for the
parent `workflow-release-action`:

- **`shared-types.ts`** -- `ValidationResult` and
  `PackageValidationResult` for validation phases
- **`publish-config.ts`** -- Multi-registry publish configuration
  (`PublishTarget`, `ResolvedTarget`, `PublishResult`, etc.) supporting
  npm, GitHub Packages, and JSR registries with OIDC-first authentication

These types are not yet consumed by the control action itself but define
the contract for downstream release workflow steps.

## Rationale

### Why a Separate Action?

The parent `workflow-release-action` runs a comprehensive release workflow.
A single workflow triggering on all pushes to main runs unnecessary jobs
(validation when only branch management is needed, publishing when no
release PR was merged). By extracting the detection logic into a lightweight
pre-flight action, each workflow can independently decide whether to
proceed.

### Why Sync + Async Detection?

The async path (GitHub API) is more accurate because it queries the actual
PR metadata associated with a commit. However, requiring a token adds
friction. The sync fallback using commit message patterns handles the
common cases (merge commit messages, "chore: version packages") without
any API calls. This dual approach maximizes compatibility while preferring
accuracy.

### Why Hand-Written Changeset Parsing?

The current regex-based parser handles the simple YAML frontmatter format
used by changesets reliably. Using official `@changesets/*` packages would
add dependencies that ncc bundles anyway, but the current implementation
is simpler and well-tested. Replacement is noted as a future improvement
but is not urgent.

### Why ts-markdown for Summaries?

Job summaries need structured markdown (tables, headings, lists).
`ts-markdown` provides type-safe construction that prevents malformed
output. Since ncc bundles it, there is no runtime cost.

## Related Documentation

- Phase detection algorithm details:
  `workflow-control-action/phase-detection.md`
- Project README: `README.md`
- Action configuration: `action.yml`
