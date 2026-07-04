import type { ApiConfiguration } from "@shared/api"
import { toSdkProviderId } from "@/sdk/model-catalog/sdk-provider-id"

/** Providers that only serve user-loaded local models. */
const LOCAL_ONLY_MODEL_PROVIDERS = new Set(["lmstudio", "ollama"])

/** Hard cap for bash/search tool timeout — never use API timeout for terminal commands. */
const MAX_TOOL_TIMEOUT_MS = 300_000 // 5 minutes

/**
 * Timeout for run_commands, search_codebase, and related SDK tools (ms).
 * Uses Settings → API → Request Timeout when set (capped at 5 min);
 * otherwise 120s for local providers, 30s for cloud.
 */
export function resolveAgentToolTimeoutMs(providerId: string | undefined, apiConfig?: ApiConfiguration): number {
	const configured = apiConfig?.requestTimeoutMs
	if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
		return Math.min(Math.trunc(configured), MAX_TOOL_TIMEOUT_MS)
	}

	const sdkProviderId = toSdkProviderId(providerId ?? "")
	if (LOCAL_ONLY_MODEL_PROVIDERS.has(sdkProviderId)) {
		return 120_000
	}

	return 30_000
}
