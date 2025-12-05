import * as core from "@actions/core";
import * as github from "@actions/github";
import type { PhaseDetectionResult, WorkflowPhase } from "./utils/detect-workflow-phase.js";
import { detectWorkflowPhase, detectWorkflowPhaseSync } from "./utils/detect-workflow-phase.js";
import { PHASE, STATE, logger } from "./utils/logger.js";
import type { ParseChangesetsResult } from "./utils/parse-changesets.js";
import { parseChangesets } from "./utils/parse-changesets.js";
import { summaryWriter } from "./utils/summary-writer.js";

/**
 * Get the emoji for a workflow phase
 */
function getPhaseEmoji(phase: WorkflowPhase): string {
	switch (phase) {
		case "branch-management":
			return PHASE.branch;
		case "validation":
			return PHASE.validation;
		case "publishing":
			return PHASE.publish;
		case "close-issues":
			return PHASE.publish;
		case "none":
			return PHASE.skip;
	}
}

/**
 * Get the description for a workflow phase
 */
function getPhaseDescription(phase: WorkflowPhase): string {
	switch (phase) {
		case "branch-management":
			return "Create or update the release branch with changesets";
		case "validation":
			return "Validate the release branch (build, test, lint)";
		case "publishing":
			return "Publish packages and create GitHub releases";
		case "close-issues":
			return "Close linked issues after release PR merge";
		case "none":
			return "No release action needed";
	}
}

/**
 * Build the job summary markdown
 */
function buildJobSummary(
	phaseResult: PhaseDetectionResult | Omit<PhaseDetectionResult, "mergedReleasePRNumber">,
	changesetResult: ParseChangesetsResult,
	inputs: { releaseBranch: string; targetBranch: string },
): string {
	const emoji = getPhaseEmoji(phaseResult.phase);
	const description = getPhaseDescription(phaseResult.phase);

	// Phase detection table
	const phaseTable = summaryWriter.keyValueTable([
		{ key: "Phase", value: `${emoji} \`${phaseResult.phase}\`` },
		{ key: "Description", value: description },
		{ key: "Reason", value: phaseResult.reason },
		{ key: "Should Continue", value: phaseResult.phase !== "none" ? "Yes" : "No" },
	]);

	// Context table
	const contextEntries = [
		{ key: "Target Branch", value: `\`${inputs.targetBranch}\`` },
		{ key: "Release Branch", value: `\`${inputs.releaseBranch}\`` },
		{ key: "On Main Branch", value: phaseResult.isMainBranch ? `${STATE.good} Yes` : `${STATE.neutral} No` },
		{
			key: "On Release Branch",
			value: phaseResult.isReleaseBranch ? `${STATE.good} Yes` : `${STATE.neutral} No`,
		},
		{
			key: "Is Release Commit",
			value: phaseResult.isReleaseCommit ? `${STATE.good} Yes` : `${STATE.neutral} No`,
		},
	];

	if ("mergedReleasePRNumber" in phaseResult && phaseResult.mergedReleasePRNumber) {
		contextEntries.push({ key: "Merged PR", value: `#${phaseResult.mergedReleasePRNumber}` });
	}

	const contextTable = summaryWriter.keyValueTable(contextEntries);

	// Changesets table
	const changesetEntries = [
		{
			key: "Has Changesets",
			value: changesetResult.hasChangesets ? `${STATE.good} Yes` : `${STATE.neutral} No`,
		},
		{ key: "Changeset Count", value: String(changesetResult.changesetCount) },
	];

	if (changesetResult.releaseType) {
		changesetEntries.push({
			key: "Release Type",
			value: `\`${changesetResult.releaseType}\``,
		});
	}

	if (changesetResult.affectedPackages.length > 0) {
		changesetEntries.push({
			key: "Affected Packages",
			value: changesetResult.affectedPackages.map((p) => `\`${p}\``).join(", "),
		});
	}

	const changesetTable = summaryWriter.keyValueTable(changesetEntries);

	// Build the full summary
	return summaryWriter.build([
		{ heading: `${emoji} Workflow Control`, content: phaseTable },
		{ heading: "Git Context", level: 3, content: contextTable },
		{ heading: "Changesets", level: 3, content: changesetTable },
	]);
}

async function run(): Promise<void> {
	try {
		logger.start();

		// Get inputs
		const token = core.getInput("token");
		const releaseBranch = core.getInput("release-branch") || "changeset-release/main";
		const targetBranch = core.getInput("target-branch") || "main";

		core.info(`Configuration:`);
		core.info(`  Target branch: ${targetBranch}`);
		core.info(`  Release branch: ${releaseBranch}`);
		core.info(`  Has token: ${token ? "yes" : "no"}`);

		const context = github.context;

		// Detect workflow phase
		let phaseResult: PhaseDetectionResult | Omit<PhaseDetectionResult, "mergedReleasePRNumber">;

		if (token) {
			const octokit = github.getOctokit(token);
			phaseResult = await detectWorkflowPhase({
				releaseBranch,
				targetBranch,
				context,
				octokit,
			});
		} else {
			// Fallback to sync detection (no API calls)
			core.warning("No token provided, using sync detection (less accurate for release commits)");
			phaseResult = detectWorkflowPhaseSync({
				releaseBranch,
				targetBranch,
				context,
			});
		}

		// Parse changesets
		const changesetResult = parseChangesets();

		// Log context
		logger.context({
			branch: context.ref.replace("refs/heads/", ""),
			commitMessage: phaseResult.commitMessage,
			isReleaseBranch: phaseResult.isReleaseBranch,
			isMainBranch: phaseResult.isMainBranch,
			isReleaseCommit: phaseResult.isReleaseCommit,
			mergedReleasePR:
				"mergedReleasePRNumber" in phaseResult && phaseResult.mergedReleasePRNumber
					? `#${phaseResult.mergedReleasePRNumber}`
					: undefined,
			isPullRequestEvent: phaseResult.isPullRequestEvent,
			isPRMerged: phaseResult.isPRMerged,
			isReleasePRMerged: phaseResult.isReleasePRMerged,
			dryRun: false,
		});

		// Log phase detection result
		const emoji = getPhaseEmoji(phaseResult.phase);
		core.info("");
		core.info(`${emoji} Detected phase: ${phaseResult.phase}`);
		core.info(`${STATE.neutral} Reason: ${phaseResult.reason}`);

		// Log changeset info
		if (changesetResult.hasChangesets) {
			core.info("");
			core.info(`${STATE.good} Found ${changesetResult.changesetCount} changeset(s)`);
			if (changesetResult.releaseType) {
				core.info(`${STATE.neutral} Release type: ${changesetResult.releaseType}`);
			}
		} else {
			core.info("");
			core.info(`${STATE.neutral} No changesets found`);
		}

		// Set outputs
		core.setOutput("phase", phaseResult.phase);
		core.setOutput("has_changesets", String(changesetResult.hasChangesets));
		core.setOutput("changeset_count", String(changesetResult.changesetCount));
		core.setOutput("release_type", changesetResult.releaseType || "");
		core.setOutput("is_release_commit", String(phaseResult.isReleaseCommit));
		core.setOutput("is_release_branch", String(phaseResult.isReleaseBranch));
		core.setOutput("is_main_branch", String(phaseResult.isMainBranch));
		core.setOutput(
			"merged_pr_number",
			"mergedReleasePRNumber" in phaseResult && phaseResult.mergedReleasePRNumber
				? String(phaseResult.mergedReleasePRNumber)
				: "",
		);
		core.setOutput("should_continue", String(phaseResult.phase !== "none"));
		core.setOutput("reason", phaseResult.reason);

		// Write job summary
		const summary = buildJobSummary(phaseResult, changesetResult, { releaseBranch, targetBranch });
		await summaryWriter.write(summary);

		// Final status
		if (phaseResult.phase === "none") {
			logger.noAction(phaseResult.reason);
		} else {
			logger.success(`Workflow should proceed with phase: ${phaseResult.phase}`);
		}
	} catch (error) {
		core.setFailed(`Workflow control failed: ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
}

// Run the action
await run();
