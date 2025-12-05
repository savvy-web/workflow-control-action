import * as core from "@actions/core";
import { PHASE } from "./utils/logger.js";

async function run(): Promise<void> {
	try {
		core.setOutput("phase", PHASE.toString());
	} catch (error) {
		core.setFailed(`Phase 1 failed: ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
}

// Run the action
await run();
