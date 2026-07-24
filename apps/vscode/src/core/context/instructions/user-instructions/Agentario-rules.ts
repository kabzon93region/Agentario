import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import {
	ensureRulesDirectoryExists,
	LOCAL_RULES_EXCLUDED_SUBPATHS,
	resolveLocalRulesDirectory,
} from "@core/storage/disk"
import { AgentarioRulesToggles } from "@shared/Agentario-rules"
import { Controller } from "@/core/controller"

export async function refreshAgentarioRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: AgentarioRulesToggles
	localToggles: AgentarioRulesToggles
}> {
	// Global toggles
	const globalAgentarioRulesToggles = controller.stateManager.getGlobalSettingsKey("globalAgentarioRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalAgentarioRulesToggles)
	controller.stateManager.setGlobalState("globalAgentarioRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localAgentarioRulesToggles = controller.stateManager.getWorkspaceStateKey("localAgentarioRulesToggles")
	const localClineRulesFilePath = await resolveLocalRulesDirectory(workingDirectory)
	const updatedLocalToggles = await synchronizeRuleToggles(
		localClineRulesFilePath,
		localAgentarioRulesToggles,
		"",
		LOCAL_RULES_EXCLUDED_SUBPATHS,
	)
	controller.stateManager.setWorkspaceState("localAgentarioRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
