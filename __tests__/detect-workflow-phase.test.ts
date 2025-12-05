import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import type { Context } from "@actions/github/lib/context.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhaseDetectionOptions } from "../src/utils/detect-workflow-phase.js";
import { detectWorkflowPhase, detectWorkflowPhaseSync } from "../src/utils/detect-workflow-phase.js";
import { cleanupTestEnvironment, createMockOctokit, setupTestEnvironment } from "./utils/github-mocks.js";
import type { MockOctokit } from "./utils/test-types.js";

// Mock modules
vi.mock("@actions/core");
vi.mock("@actions/github");

describe("detect-workflow-phase", () => {
	let mockOctokit: MockOctokit;
	let mockContext: Context;

	beforeEach(() => {
		setupTestEnvironment({ suppressOutput: true });

		mockOctokit = createMockOctokit();
		vi.mocked(getOctokit).mockReturnValue(mockOctokit as unknown as ReturnType<typeof getOctokit>);

		// Setup default context
		mockContext = {
			repo: { owner: "test-owner", repo: "test-repo" },
			sha: "abc123",
			ref: "refs/heads/main",
			eventName: "push",
			payload: {
				head_commit: { message: "feat: add new feature" },
			},
		} as unknown as Context;

		Object.defineProperty(vi.mocked(context), "repo", {
			value: mockContext.repo,
			writable: true,
		});
		Object.defineProperty(vi.mocked(context), "sha", {
			value: mockContext.sha,
			writable: true,
		});
		Object.defineProperty(vi.mocked(context), "ref", {
			value: mockContext.ref,
			writable: true,
		});
		Object.defineProperty(vi.mocked(context), "eventName", {
			value: mockContext.eventName,
			writable: true,
		});
		Object.defineProperty(vi.mocked(context), "payload", {
			value: mockContext.payload,
			writable: true,
		});
	});

	afterEach(() => {
		cleanupTestEnvironment();
	});

	describe("detectWorkflowPhase (async)", () => {
		const createOptions = (): PhaseDetectionOptions => ({
			releaseBranch: "changeset-release/main",
			targetBranch: "main",
			context: mockContext,
			octokit: mockOctokit as unknown as PhaseDetectionOptions["octokit"],
		});

		it("should detect branch-management phase on push to main with no release commit", async () => {
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({ data: [] });

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("branch-management");
			expect(result.isMainBranch).toBe(true);
			expect(result.isReleaseCommit).toBe(false);
			expect(result.reason).toContain("not a release commit");
		});

		it("should detect validation phase on push to release branch", async () => {
			mockContext.ref = "refs/heads/changeset-release/main";

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("validation");
			expect(result.isReleaseBranch).toBe(true);
			expect(result.reason).toContain("Push to release branch");
		});

		it("should detect publishing phase when merged release PR is found", async () => {
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({
				data: [
					{
						number: 42,
						merged_at: "2024-01-01T00:00:00Z",
						head: { ref: "changeset-release/main" },
						base: { ref: "main" },
					},
				],
			});

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
			expect(result.mergedReleasePRNumber).toBe(42);
			expect(result.reason).toContain("Merged release PR #42");
		});

		it("should detect close-issues phase on pull_request merge event", async () => {
			mockContext.eventName = "pull_request";
			mockContext.payload = {
				pull_request: {
					number: 99,
					merged: true,
					head: { ref: "changeset-release/main" },
					base: { ref: "main" },
				},
			};

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("close-issues");
			expect(result.isReleasePRMerged).toBe(true);
			expect(result.mergedReleasePRNumber).toBe(99);
		});

		it("should detect validation phase on open PR from release branch to main", async () => {
			mockContext.eventName = "pull_request";
			mockContext.ref = "refs/pull/42/merge";
			mockContext.payload = {
				pull_request: {
					number: 42,
					merged: false,
					head: { ref: "changeset-release/main" },
					base: { ref: "main" },
				},
			};

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("validation");
			expect(result.reason).toBe("Open PR #42 from changeset-release/main to main");
			expect(result.isPullRequestEvent).toBe(true);
			expect(result.isPRMerged).toBe(false);
			expect(result.isReleasePRMerged).toBe(false);
		});

		it("should detect none phase for unrelated branches", async () => {
			mockContext.ref = "refs/heads/feature/my-feature";
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({ data: [] });

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("none");
			expect(result.isMainBranch).toBe(false);
			expect(result.isReleaseBranch).toBe(false);
			expect(result.reason).toContain("Not on main or changeset-release/main");
		});

		it("should fallback to commit message detection when API fails", async () => {
			mockContext.payload = {
				head_commit: { message: "chore: release v1.0.0\n\nVersion Packages" },
			};
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockRejectedValue(new Error("API Error"));

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to check for associated PRs"));
		});

		it("should detect release commit from merge commit message", async () => {
			mockContext.payload = {
				head_commit: { message: "Merge branch 'changeset-release/main' into main" },
			};
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockRejectedValue(new Error("API Error"));

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
		});

		it("should use custom branch names", async () => {
			mockContext.ref = "refs/heads/release/next";
			const options = {
				...createOptions(),
				releaseBranch: "release/next",
				targetBranch: "develop",
			};

			const result = await detectWorkflowPhase(options);

			expect(result.phase).toBe("validation");
			expect(result.isReleaseBranch).toBe(true);
		});

		it("should not treat non-release PR merges as release commits", async () => {
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({
				data: [
					{
						number: 50,
						merged_at: "2024-01-01T00:00:00Z",
						head: { ref: "feature/something" },
						base: { ref: "main" },
					},
				],
			});

			const result = await detectWorkflowPhase(createOptions());

			expect(result.phase).toBe("branch-management");
			expect(result.isReleaseCommit).toBe(false);
		});

		it("should handle PR merge event that is not from release branch", async () => {
			mockContext.eventName = "pull_request";
			mockContext.payload = {
				pull_request: {
					number: 55,
					merged: true,
					head: { ref: "feature/other" },
					base: { ref: "main" },
				},
			};

			const result = await detectWorkflowPhase(createOptions());

			// Since it's not a release PR, it won't be close-issues phase
			// But since it's a pull_request event, we can't determine the branch from context.ref
			expect(result.isReleasePRMerged).toBe(false);
		});

		it("should truncate long commit messages", async () => {
			mockContext.payload = {
				head_commit: { message: "a".repeat(200) },
			};
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({ data: [] });

			const result = await detectWorkflowPhase(createOptions());

			expect(result.commitMessage.length).toBe(103); // 100 chars + "..."
			expect(result.commitMessage.endsWith("...")).toBe(true);
		});

		it("should handle workflow_dispatch event on main branch", async () => {
			mockContext.eventName = "workflow_dispatch";
			mockOctokit.rest.repos.listPullRequestsAssociatedWithCommit.mockResolvedValue({ data: [] });

			const result = await detectWorkflowPhase(createOptions());

			// workflow_dispatch on main with no release commit should be branch-management
			expect(result.phase).toBe("branch-management");
		});
	});

	describe("detectWorkflowPhaseSync", () => {
		const createSyncOptions = (): { releaseBranch: string; targetBranch: string; context: Context } => ({
			releaseBranch: "changeset-release/main",
			targetBranch: "main",
			context: mockContext,
		});

		it("should detect branch-management phase on main branch", () => {
			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("branch-management");
			expect(result.isMainBranch).toBe(true);
		});

		it("should detect validation phase on release branch", () => {
			mockContext.ref = "refs/heads/changeset-release/main";

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("validation");
			expect(result.isReleaseBranch).toBe(true);
		});

		it("should detect publishing from commit message patterns", () => {
			mockContext.payload = {
				head_commit: { message: "chore: version packages" },
			};

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
		});

		it("should detect close-issues on PR merge event", () => {
			mockContext.eventName = "pull_request";
			mockContext.payload = {
				pull_request: {
					number: 10,
					merged: true,
					head: { ref: "changeset-release/main" },
					base: { ref: "main" },
				},
			};

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("close-issues");
			expect(result.isReleasePRMerged).toBe(true);
		});

		it("should detect validation on open PR from release branch to main", () => {
			mockContext.eventName = "pull_request";
			mockContext.ref = "refs/pull/55/merge";
			mockContext.payload = {
				pull_request: {
					number: 55,
					merged: false,
					head: { ref: "changeset-release/main" },
					base: { ref: "main" },
				},
			};

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("validation");
			expect(result.reason).toBe("Open PR #55 from changeset-release/main to main");
			expect(result.isPullRequestEvent).toBe(true);
			expect(result.isPRMerged).toBe(false);
		});

		it("should detect none phase for other branches", () => {
			mockContext.ref = "refs/heads/feature/test";

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("none");
		});

		it("should detect release commit from merge pull request message", () => {
			mockContext.payload = {
				head_commit: { message: "Merge pull request #123 from owner/changeset-release/main" },
			};

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
		});

		it("should detect release commit from chore: release prefix", () => {
			mockContext.payload = {
				head_commit: { message: "chore: release v2.0.0" },
			};

			const result = detectWorkflowPhaseSync(createSyncOptions());

			expect(result.phase).toBe("publishing");
			expect(result.isReleaseCommit).toBe(true);
		});
	});
});
