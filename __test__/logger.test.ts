import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE, STATE, logger } from "../src/utils/logger.js";
import { cleanupTestEnvironment, setupTestEnvironment } from "./utils/github-mocks.js";

vi.mock("@actions/core");

describe("logger", () => {
	beforeEach(() => {
		setupTestEnvironment({ suppressOutput: true });
	});

	afterEach(() => {
		cleanupTestEnvironment();
	});

	describe("STATE constants", () => {
		it("should define all state emojis", () => {
			expect(STATE.good).toBe("\u{1F7E2}");
			expect(STATE.neutral).toBe("\u{26AA}");
			expect(STATE.warning).toBe("\u{1F7E1}");
			expect(STATE.issue).toBe("\u{1F534}");
		});
	});

	describe("PHASE constants", () => {
		it("should define all phase emojis", () => {
			expect(PHASE.branch).toBe("\u{1F33F}");
			expect(PHASE.validation).toBe("\u{2705}");
			expect(PHASE.publish).toBe("\u{1F4E6}");
			expect(PHASE.skip).toBe("\u{23ED}\u{FE0F}");
			expect(PHASE.rocket).toBe("\u{1F680}");
			expect(PHASE.test).toBe("\u{1F9EA}");
		});
	});

	describe("start", () => {
		it("should log rocket emoji with start message", () => {
			logger.start();
			expect(core.info).toHaveBeenCalledWith(`${PHASE.rocket} Starting release workflow...`);
		});
	});

	describe("success", () => {
		it("should log with green circle", () => {
			logger.success("All good");
			expect(core.info).toHaveBeenCalledWith(`${STATE.good} All good`);
		});
	});

	describe("info", () => {
		it("should log with neutral circle", () => {
			logger.info("Some info");
			expect(core.info).toHaveBeenCalledWith(`${STATE.neutral} Some info`);
		});
	});

	describe("warn", () => {
		it("should call core.warning with warning emoji", () => {
			logger.warn("Be careful");
			expect(core.warning).toHaveBeenCalledWith(`${STATE.warning} Be careful`);
		});
	});

	describe("error", () => {
		it("should call core.error with issue emoji", () => {
			logger.error("Something broke");
			expect(core.error).toHaveBeenCalledWith(`${STATE.issue} Something broke`);
		});
	});

	describe("skip", () => {
		it("should log with skip emoji", () => {
			logger.skip("Nothing to do");
			expect(core.info).toHaveBeenCalledWith(`${PHASE.skip} Nothing to do`);
		});
	});

	describe("noAction", () => {
		it("should log skip emoji with reason", () => {
			logger.noAction("No changes detected");
			expect(core.info).toHaveBeenCalledWith(`${PHASE.skip} No release action needed: No changes detected`);
		});
	});

	describe("phase", () => {
		it("should log phase header with emoji and number", () => {
			logger.phase(1, PHASE.branch, "Branch Management");
			expect(core.info).toHaveBeenCalledWith("");
			expect(core.info).toHaveBeenCalledWith(`${PHASE.branch} Phase 1: Branch Management`);
		});
	});

	describe("step", () => {
		it("should start a group with step number and name", () => {
			logger.step(2, "Run tests");
			expect(core.startGroup).toHaveBeenCalledWith("Step 2: Run tests");
		});
	});

	describe("endStep", () => {
		it("should end the group", () => {
			logger.endStep();
			expect(core.endGroup).toHaveBeenCalled();
		});
	});

	describe("phaseComplete", () => {
		it("should log phase completion with green circle", () => {
			logger.phaseComplete(3);
			expect(core.info).toHaveBeenCalledWith("");
			expect(core.info).toHaveBeenCalledWith(`${STATE.good} Phase 3 completed successfully`);
		});
	});

	describe("context", () => {
		it("should log basic branch context", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith("=== Workflow Context ===");
			expect(core.info).toHaveBeenCalledWith(`${STATE.neutral} Branch: main`);
			expect(core.info).toHaveBeenCalledWith("Branch detection:");
			expect(core.info).toHaveBeenCalledWith(`  ${STATE.good} Main branch: true`);
			expect(core.info).toHaveBeenCalledWith(`  ${STATE.neutral} Release branch: false`);
		});

		it("should log dry-run mode when enabled", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: true,
			});

			expect(core.info).toHaveBeenCalledWith(`${PHASE.test} Running in dry-run mode (preview only)`);
		});

		it("should log commit message when present", () => {
			logger.context({
				branch: "main",
				commitMessage: "fix: something",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith(`${STATE.neutral} Commit: fix: something`);
		});

		it("should truncate long commit messages at 80 chars", () => {
			const longMessage = "a".repeat(100);
			logger.context({
				branch: "main",
				commitMessage: longMessage,
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith(`${STATE.neutral} Commit: ${"a".repeat(80)}...`);
		});

		it("should truncate multi-line commit messages to first line", () => {
			logger.context({
				branch: "main",
				commitMessage: "first line\nsecond line\nthird line",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith(`${STATE.neutral} Commit: first line`);
		});

		it("should not log commit line when commitMessage is absent", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			const calls = vi.mocked(core.info).mock.calls.map((c) => c[0]);
			expect(calls.every((c) => !String(c).includes("Commit:"))).toBe(true);
		});

		it("should log merged release PR when present", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: true,
				mergedReleasePR: "#42",
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith(`  ${STATE.good} Merged release PR: #42`);
		});

		it("should not log merged release PR when absent", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			const calls = vi.mocked(core.info).mock.calls.map((c) => c[0]);
			expect(calls.every((c) => !String(c).includes("Merged release PR"))).toBe(true);
		});

		it("should log PR event detection when isPullRequestEvent is defined", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				isPullRequestEvent: true,
				isPRMerged: true,
				isReleasePRMerged: false,
				dryRun: false,
			});

			expect(core.info).toHaveBeenCalledWith("PR event detection:");
			expect(core.info).toHaveBeenCalledWith(`  ${STATE.good} Pull request event: true`);
			expect(core.info).toHaveBeenCalledWith(`  ${STATE.good} PR merged: true`);
			expect(core.info).toHaveBeenCalledWith(`  ${STATE.neutral} Release PR merged: false`);
		});

		it("should not log PR event detection when isPullRequestEvent is undefined", () => {
			logger.context({
				branch: "main",
				isReleaseBranch: false,
				isMainBranch: true,
				isReleaseCommit: false,
				dryRun: false,
			});

			const calls = vi.mocked(core.info).mock.calls.map((c) => c[0]);
			expect(calls.every((c) => !String(c).includes("PR event detection"))).toBe(true);
		});
	});
});
