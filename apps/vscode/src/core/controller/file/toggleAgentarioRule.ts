import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleAgentarioRuleRequest } from "@shared/proto/agentario/file"
import { RuleScope, ToggleAgentarioRules } from "@shared/proto/agentario/file"
import * as path from "path"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Cline rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Cline rule toggles
 */
export async function toggleAgentarioRule(controller: Controller, request: ToggleAgentarioRuleRequest): Promise<ToggleAgentarioRules> {
	const { scope, rulePath, enabled } = request
	const normalizedRulePath = path.normalize(rulePath)

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleAgentarioRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleAgentarioRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalAgentarioRulesToggles")
			if (normalizedRulePath !== rulePath) {
				delete toggles[rulePath]
			}
			toggles[normalizedRulePath] = enabled
			controller.stateManager.setGlobalState("globalAgentarioRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localAgentarioRulesToggles")
			if (normalizedRulePath !== rulePath) {
				delete toggles[rulePath]
			}
			toggles[normalizedRulePath] = enabled
			controller.stateManager.setWorkspaceState("localAgentarioRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(normalizedRulePath, "Controller.toggleAgentarioRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureClineRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalAgentarioRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localAgentarioRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleAgentarioRules.create({
		globalAgentarioRulesToggles: { toggles: globalToggles },
		localAgentarioRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
