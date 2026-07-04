import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import {
	ensureRulesDirectoryExists,
	LOCAL_RULES_EXCLUDED_SUBPATHS,
	resolveLocalRulesDirectory,
} from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { Controller } from "@/core/controller"

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localClineRulesFilePath = await resolveLocalRulesDirectory(workingDirectory)
	const updatedLocalToggles = await synchronizeRuleToggles(
		localClineRulesFilePath,
		localClineRulesToggles,
		"",
		LOCAL_RULES_EXCLUDED_SUBPATHS,
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
