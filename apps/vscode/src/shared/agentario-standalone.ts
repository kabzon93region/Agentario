import { ClineEndpoint } from "@/config"
import type { ApiConfiguration } from "@shared/api"
import type { StateManager } from "@/core/storage/StateManager"

/** Agentario ships with bundled endpoints.json → selfHosted; no Cline cloud required. */
export function isAgentarioStandaloneMode(): boolean {
	return ClineEndpoint.isSelfHosted()
}

const CLINE_CLOUD_PROVIDERS = new Set(["cline", "cline-pass"])

/** Rewrites legacy Cline cloud provider selection to LM Studio on startup. */
export function migrateStandaloneProviderSettings(stateManager: StateManager): void {
	if (!isAgentarioStandaloneMode()) {
		return
	}

	const api = stateManager.getApiConfiguration()
	const patch: Partial<ApiConfiguration> = {}

	if (CLINE_CLOUD_PROVIDERS.has(api.planModeApiProvider ?? "")) {
		patch.planModeApiProvider = "lmstudio"
	}
	if (CLINE_CLOUD_PROVIDERS.has(api.actModeApiProvider ?? "")) {
		patch.actModeApiProvider = "lmstudio"
	}
	if (!api.lmStudioBaseUrl) {
		patch.lmStudioBaseUrl = "http://127.0.0.1:1234"
	}

	if (Object.keys(patch).length === 0) {
		return
	}

	stateManager.setApiConfiguration({ ...api, ...patch })
}
