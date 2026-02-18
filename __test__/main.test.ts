import * as core from "@actions/core";
import * as github from "@actions/github";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhaseDetectionResult } from "../src/utils/detect-workflow-phase.js";
import { detectWorkflowPhase, detectWorkflowPhaseSync } from "../src/utils/detect-workflow-phase.js";
import type { ParseChangesetsResult } from "../src/utils/parse-changesets.js";
import { parseChangesets } from "../src/utils/parse-changesets.js";
import { cleanupTestEnvironment, setupTestEnvironment } from "./utils/github-mocks.js";

vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("../src/utils/detect-workflow-phase.js");
vi.mock("../src/utils/parse-changesets.js");
vi.mock("../src/utils/logger.js", () => ({
	PHASE: {
		branch: "\u{1F33F}",
		validation: "\u{2705}",
		publish: "\u{1F4E6}",
		skip: "\u{23ED}\u{FE0F}",
		rocket: "\u{1F680}",
		test: "\u{1F9EA}",
	},
	STATE: {
		good: "\u{1F7E2}",
		neutral: "\u{26AA}",
		warning: "\u{1F7E1}",
		issue: "\u{1F534}",
	},
	logger: {
		start: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		skip: vi.fn(),
		noAction: vi.fn(),
		phase: vi.fn(),
		step: vi.fn(),
		endStep: vi.fn(),
		phaseComplete: vi.fn(),
		context: vi.fn(),
	},
}));
vi.mock("../src/utils/summary-writer.js", () => ({
	summaryWriter: {
		write: vi.fn().mockResolvedValue(undefined),
		keyValueTable: vi.fn().mockReturnValue("table"),
		build: vi.fn().mockReturnValue("summary"),
	},
}));

function makePhaseResult(overrides: Partial<PhaseDetectionResult> = {}): PhaseDetectionResult {
	return {
		phase: "branch-management",
		reason: "Push to main (not a release commit)",
		isReleaseBranch: false,
		isMainBranch: true,
		isReleaseCommit: false,
		isPullRequestEvent: false,
		isPRMerged: false,
		isReleasePRMerged: false,
		commitMessage: "feat: add feature",
		...overrides,
	};
}

function makeChangesetResult(overrides: Partial<ParseChangesetsResult> = {}): ParseChangesetsResult {
	return {
		hasChangesets: false,
		changesetCount: 0,
		changesets: [],
		releaseType: null,
		affectedPackages: [],
		packageBumps: new Map(),
		...overrides,
	};
}

function setupMocks(
	phaseResult: PhaseDetectionResult,
	changesetResult: ParseChangesetsResult,
	options: { token?: string } = {},
): void {
	const token = options.token ?? "test-token";

	vi.mocked(core.getInput).mockImplementation((name: string) => {
		if (name === "token") return token;
		if (name === "release-branch") return "";
		if (name === "target-branch") return "";
		return "";
	});

	Object.defineProperty(github, "context", {
		value: {
			ref: "refs/heads/main",
			eventName: "push",
			sha: "abc123",
			payload: { head_commit: { message: "feat: add feature" } },
			repo: { owner: "test-owner", repo: "test-repo" },
		},
		writable: true,
		configurable: true,
	});

	const mockOctokit = {} as ReturnType<typeof github.getOctokit>;
	vi.mocked(github.getOctokit).mockReturnValue(mockOctokit);
	vi.mocked(detectWorkflowPhase).mockResolvedValue(phaseResult);
	vi.mocked(detectWorkflowPhaseSync).mockReturnValue(phaseResult);
	vi.mocked(parseChangesets).mockReturnValue(changesetResult);
}

async function runMain(): Promise<void> {
	vi.resetModules();

	// Re-apply mocks after resetModules
	vi.mock("@actions/core");
	vi.mock("@actions/github");
	vi.mock("../src/utils/detect-workflow-phase.js");
	vi.mock("../src/utils/parse-changesets.js");
	vi.mock("../src/utils/logger.js", () => ({
		PHASE: {
			branch: "\u{1F33F}",
			validation: "\u{2705}",
			publish: "\u{1F4E6}",
			skip: "\u{23ED}\u{FE0F}",
			rocket: "\u{1F680}",
			test: "\u{1F9EA}",
		},
		STATE: {
			good: "\u{1F7E2}",
			neutral: "\u{26AA}",
			warning: "\u{1F7E1}",
			issue: "\u{1F534}",
		},
		logger: {
			start: vi.fn(),
			success: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			skip: vi.fn(),
			noAction: vi.fn(),
			phase: vi.fn(),
			step: vi.fn(),
			endStep: vi.fn(),
			phaseComplete: vi.fn(),
			context: vi.fn(),
		},
	}));
	vi.mock("../src/utils/summary-writer.js", () => ({
		summaryWriter: {
			write: vi.fn().mockResolvedValue(undefined),
			keyValueTable: vi.fn().mockReturnValue("table"),
			build: vi.fn().mockReturnValue("summary"),
		},
	}));

	await import("../src/main.js");
}

describe("main", () => {
	beforeEach(() => {
		setupTestEnvironment({ suppressOutput: true });
	});

	afterEach(() => {
		cleanupTestEnvironment();
	});

	describe("phase detection with token", () => {
		it("should use async detectWorkflowPhase when token is provided", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult, { token: "my-token" });

			await runMain();

			const { detectWorkflowPhase: dwp } = await import("../src/utils/detect-workflow-phase.js");
			expect(vi.mocked(dwp)).toHaveBeenCalled();
		});

		it("should use sync detectWorkflowPhaseSync when no token", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult, { token: "" });

			await runMain();

			const { detectWorkflowPhaseSync: dwps } = await import("../src/utils/detect-workflow-phase.js");
			const coreModule = await import("@actions/core");
			expect(vi.mocked(dwps)).toHaveBeenCalled();
			expect(vi.mocked(coreModule.warning)).toHaveBeenCalledWith(expect.stringContaining("No token provided"));
		});
	});

	describe("input defaults", () => {
		it("should default release-branch to changeset-release/main", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const { detectWorkflowPhase: dwp } = await import("../src/utils/detect-workflow-phase.js");
			expect(vi.mocked(dwp)).toHaveBeenCalledWith(expect.objectContaining({ releaseBranch: "changeset-release/main" }));
		});

		it("should default target-branch to main", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const { detectWorkflowPhase: dwp } = await import("../src/utils/detect-workflow-phase.js");
			expect(vi.mocked(dwp)).toHaveBeenCalledWith(expect.objectContaining({ targetBranch: "main" }));
		});
	});

	describe("outputs", () => {
		it("should set all outputs for branch-management phase", async () => {
			const phaseResult = makePhaseResult({ phase: "branch-management" });
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			const setOutput = vi.mocked(coreModule.setOutput);
			expect(setOutput).toHaveBeenCalledWith("phase", "branch-management");
			expect(setOutput).toHaveBeenCalledWith("has_changesets", "false");
			expect(setOutput).toHaveBeenCalledWith("changeset_count", "0");
			expect(setOutput).toHaveBeenCalledWith("release_type", "");
			expect(setOutput).toHaveBeenCalledWith("is_release_commit", "false");
			expect(setOutput).toHaveBeenCalledWith("is_release_branch", "false");
			expect(setOutput).toHaveBeenCalledWith("is_main_branch", "true");
			expect(setOutput).toHaveBeenCalledWith("merged_pr_number", "");
			expect(setOutput).toHaveBeenCalledWith("should_continue", "true");
			expect(setOutput).toHaveBeenCalledWith("reason", "Push to main (not a release commit)");
		});

		it("should set should_continue to false for none phase", async () => {
			const phaseResult = makePhaseResult({ phase: "none", reason: "Not on main" });
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.setOutput)).toHaveBeenCalledWith("should_continue", "false");
		});

		it("should set merged_pr_number when present", async () => {
			const phaseResult = makePhaseResult({
				phase: "publishing",
				mergedReleasePRNumber: 42,
				isReleaseCommit: true,
			});
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.setOutput)).toHaveBeenCalledWith("merged_pr_number", "42");
		});

		it("should set changeset outputs when changesets exist", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult({
				hasChangesets: true,
				changesetCount: 3,
				releaseType: "minor",
			});
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.setOutput)).toHaveBeenCalledWith("has_changesets", "true");
			expect(vi.mocked(coreModule.setOutput)).toHaveBeenCalledWith("changeset_count", "3");
			expect(vi.mocked(coreModule.setOutput)).toHaveBeenCalledWith("release_type", "minor");
		});
	});

	describe("changeset logging", () => {
		it("should log changeset count and release type when changesets exist", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult({
				hasChangesets: true,
				changesetCount: 2,
				releaseType: "patch",
			});
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.info)).toHaveBeenCalledWith(expect.stringContaining("Found 2 changeset(s)"));
			expect(vi.mocked(coreModule.info)).toHaveBeenCalledWith(expect.stringContaining("Release type: patch"));
		});

		it("should log no changesets message when none exist", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.info)).toHaveBeenCalledWith(expect.stringContaining("No changesets found"));
		});

		it("should not log release type when null", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult({
				hasChangesets: true,
				changesetCount: 1,
				releaseType: null,
			});
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const coreModule = await import("@actions/core");
			const calls = vi.mocked(coreModule.info).mock.calls.map((c) => c[0]);
			expect(calls.some((c) => String(c).includes("Release type:"))).toBe(false);
		});
	});

	describe("phase terminal logging", () => {
		it("should call logger.noAction for none phase", async () => {
			const phaseResult = makePhaseResult({ phase: "none", reason: "Not on main" });
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const { logger: log } = await import("../src/utils/logger.js");
			expect(vi.mocked(log.noAction)).toHaveBeenCalledWith("Not on main");
		});

		it("should call logger.success for non-none phase", async () => {
			const phaseResult = makePhaseResult({ phase: "publishing" });
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const { logger: log } = await import("../src/utils/logger.js");
			expect(vi.mocked(log.success)).toHaveBeenCalledWith("Workflow should proceed with phase: publishing");
		});
	});

	describe("job summary", () => {
		it("should write job summary", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			await runMain();

			const { summaryWriter: sw } = await import("../src/utils/summary-writer.js");
			expect(vi.mocked(sw.write)).toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should call setFailed and re-throw on error", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			// Make detectWorkflowPhase throw
			vi.mocked(detectWorkflowPhase).mockRejectedValue(new Error("API failure"));

			await expect(runMain()).rejects.toThrow("API failure");

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.setFailed)).toHaveBeenCalledWith("Workflow control failed: API failure");
		});

		it("should handle non-Error thrown values", async () => {
			const phaseResult = makePhaseResult();
			const changesetResult = makeChangesetResult();
			setupMocks(phaseResult, changesetResult);

			vi.mocked(detectWorkflowPhase).mockRejectedValue("string error");

			await expect(runMain()).rejects.toThrow();

			const coreModule = await import("@actions/core");
			expect(vi.mocked(coreModule.setFailed)).toHaveBeenCalledWith("Workflow control failed: string error");
		});
	});
});
