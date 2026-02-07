---
status: current
module: workflow-control-action
category: architecture
created: 2026-02-07
updated: 2026-02-07
last-synced: 2026-02-07
completeness: 90
related:
  - workflow-control-action/architecture.md
dependencies: []
---

# Phase Detection Algorithm

## Overview

The phase detection algorithm is the core logic of the workflow-control-action.
It examines the GitHub Actions event context (branch, commit, PR state) and
determines which of five workflow phases should execute. The algorithm exists
in two variants: an async version that makes GitHub API calls for high-accuracy
detection, and a sync version that relies on commit message pattern matching
as a fallback.

## Current State

The algorithm is fully implemented in `src/utils/detect-workflow-phase.ts`
with two exported functions:

- **`detectWorkflowPhase(options)`** -- Async, uses Octokit for API queries
- **`detectWorkflowPhaseSync(options)`** -- Sync, pattern-matching only

Both are well-tested (the test file `__tests__/detect-workflow-phase.test.ts`
covers all phase transitions and edge cases) with 100% coverage.

### Workflow Phases

| Phase | Trigger | Purpose |
| :---- | :------ | :------ |
| `branch-management` | Push to main (non-release) | Create/update release branch |
| `validation` | Push to release branch or open release PR | Run build, test, lint |
| `publishing` | Release PR merged (push event on main) | Publish packages |
| `close-issues` | Release PR merged (pull_request event) | Close linked issues |
| `none` | Any other scenario | No action needed |

## Detection Algorithm

### Priority Order

The algorithm evaluates conditions in strict priority order. The first
matching condition determines the phase:

```text
1. Phase 3a (close-issues)
   - Event: pull_request
   - PR merged: true
   - Head branch: release branch
   - Base branch: target branch

2. Phase 2a (validation, PR-triggered)
   - Event: pull_request
   - PR merged: false (open PR)
   - Head branch: release branch
   - Base branch: target branch

3. Release commit detection (async only)
   - Event: push
   - Branch: target (main)
   - API query: check for merged release PR associated with commit

4. Phase 3 (publishing)
   - Branch: target (main)
   - isReleaseCommit: true

5. Phase 2 (validation, push-triggered)
   - Branch: release branch

6. Phase 1 (branch-management)
   - Branch: target (main)
   - isReleaseCommit: false

7. Phase none
   - No conditions matched
```

### Decision Tree

```text
Is this a pull_request event?
  |
  +-- Yes: Is the PR merged?
  |     |
  |     +-- Yes: Is it from release branch to target?
  |     |     +-- Yes --> close-issues (Phase 3a)
  |     |     +-- No  --> none
  |     |
  |     +-- No: Is it from release branch to target?
  |           +-- Yes --> validation (Phase 2a)
  |           +-- No  --> none
  |
  +-- No: Is this a push event?
        |
        +-- On target (main) branch?
        |     |
        |     +-- Yes: Is this a release commit?
        |     |     +-- Yes --> publishing (Phase 3)
        |     |     +-- No  --> branch-management (Phase 1)
        |     |
        |     +-- No: continue
        |
        +-- On release branch?
        |     +-- Yes --> validation (Phase 2)
        |
        +-- Otherwise --> none
```

## Release Commit Detection

The most complex part of the algorithm is determining whether a push to
main is a release commit (i.e., came from a merged release PR). Two
strategies are used in sequence.

### Primary Strategy: GitHub API

When a token is available, the async function queries the GitHub API:

```typescript
octokit.rest.repos.listPullRequestsAssociatedWithCommit({
  owner: context.repo.owner,
  repo: context.repo.repo,
  commit_sha: context.sha,
});
```

It then searches the returned PRs for one that:

1. Has `merged_at !== null` (PR was merged, not closed)
2. Has `head.ref === releaseBranch` (came from the release branch)
3. Has `base.ref === targetBranch` (targeted the main branch)

If found, the commit is confirmed as a release commit and the PR number is
captured.

### Fallback Strategy: Commit Message Patterns

When the API call fails or no token is provided, the algorithm falls back
to commit message pattern matching:

**Merge patterns** (indicates merge from release branch):

- Contains `from {owner}/{releaseBranch}`
- Contains `Merge branch '{releaseBranch}'`
- Contains both `Merge pull request` and `{releaseBranch}`

**Version patterns** (indicates a version bump commit):

- Contains `chore: version packages`
- Contains `version packages` (case-insensitive)
- Starts with `chore: release`

A commit matching any merge pattern OR any version pattern is classified as
a release commit. The fallback cannot determine the PR number.

### Trade-offs

| Aspect | API Strategy | Message Strategy |
| :----- | :----------- | :--------------- |
| Accuracy | High -- queries actual PR data | Medium -- patterns can false-positive |
| PR number | Available | Not available |
| Token required | Yes | No |
| Network required | Yes | No |
| Speed | Slower (API call) | Instant |

The sync variant (`detectWorkflowPhaseSync`) always uses the message
strategy. The async variant (`detectWorkflowPhase`) tries the API first
and falls back to messages on error.

## PhaseDetectionResult Interface

Both functions return a `PhaseDetectionResult` with these fields:

```typescript
interface PhaseDetectionResult {
  phase: WorkflowPhase;
  reason: string;
  isReleaseBranch: boolean;
  isMainBranch: boolean;
  isReleaseCommit: boolean;
  mergedReleasePRNumber?: number;  // async only
  isPullRequestEvent: boolean;
  isPRMerged: boolean;
  isReleasePRMerged: boolean;
  commitMessage: string;           // truncated to 100 chars
}
```

The sync variant omits `mergedReleasePRNumber` from its return type since
it cannot detect PR numbers without API access.

## Context Extraction

Both variants extract the same context from `@actions/github`:

| Field | Source |
| :---- | :----- |
| `commitMessage` | `context.payload.head_commit?.message` |
| `isReleaseBranch` | `context.ref === refs/heads/{releaseBranch}` |
| `isMainBranch` | `context.ref === refs/heads/{targetBranch}` |
| `isPullRequestEvent` | `context.eventName === "pull_request"` |
| `isPRMerged` | `context.payload.pull_request?.merged === true` |
| `isReleasePRMerged` | `isPRMerged && head.ref === releaseBranch && base.ref === targetBranch` |

## Edge Cases

### Push to Unrelated Branch

If the push is to a branch that is neither the target nor the release
branch, the algorithm returns `phase: "none"` with the reason "Not on
{target} or {release} branch".

### Pull Request to Unrelated Branches

If a pull_request event involves branches other than the release-to-target
combination, the algorithm returns `phase: "none"`.

### API Failure

If the GitHub API call fails in the async path, the algorithm logs a
warning and falls back to message pattern matching. This ensures the
action never fails due to transient API issues.

### Empty Commit Message

If `context.payload.head_commit?.message` is undefined (possible in some
event types), an empty string is used. The message pattern fallback will
not match, and the algorithm proceeds based on branch detection alone.

### Commit Message Truncation

The commit message is truncated to 100 characters in the result to prevent
excessively long output in logs and summaries. A `...` suffix is added
when truncation occurs.

## Rationale

### Why Priority-Based Detection?

The algorithm uses a strict priority order rather than independent
condition checks because phases are mutually exclusive. A release PR merge
event on the main branch could match both "publishing" (push to main with
release commit) and "close-issues" (PR merge event). The priority ordering
ensures the most specific phase is selected.

### Why Two Variants?

Not all workflows need API access. Simple workflows that only check "am I
on the release branch?" can use the sync variant without providing a token.
The dual-variant approach keeps the action flexible while maintaining
accuracy for workflows that can provide authentication.

### Why Check PR State on pull_request Events?

The `pull_request` event fires for many actions (opened, synchronize,
closed, etc.). Only the "closed with merged=true" state indicates a
completed merge. Checking `isPRMerged` prevents the action from triggering
publishing logic on PR updates or closures without merge.

### Why Separate close-issues from publishing?

These phases need different workflow triggers. Publishing runs on a `push`
event to main (after the merge commit lands), while issue closing runs on
the `pull_request` closed event (which has access to the PR metadata
needed to find linked issues). Separating them allows each workflow to use
the natural trigger for its task.

## Related Documentation

- Overall action architecture:
  `workflow-control-action/architecture.md`
- Test coverage:
  `__tests__/detect-workflow-phase.test.ts`
