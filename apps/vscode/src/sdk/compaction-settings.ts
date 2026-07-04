import type { CoreCompactionConfig, CoreCompactionSummarizerConfig } from "@cline/core"
import type { StateManager } from "@/core/storage/StateManager"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"

export type CompactionStrategySetting = "basic" | "agentic"

export function getCompactionStrategySetting(stateManager: StateManager): CompactionStrategySetting {
	const raw = stateManager.getGlobalSettingsKey("compactionStrategy")
	return raw === "basic" ? "basic" : "agentic"
}

export function resolveCompactionSummarizerConfig(
	stateManager: StateManager,
	activeProviderId: string,
): CoreCompactionSummarizerConfig | undefined {
	const modelId = stateManager.getGlobalSettingsKey("compactionSummarizerModelId")?.trim()
	if (!modelId) {
		return undefined
	}
	const providerRaw =
		stateManager.getGlobalSettingsKey("compactionSummarizerProviderId")?.trim() || activeProviderId
	return {
		providerId: toSdkProviderId(providerRaw),
		modelId,
	}
}

export function buildCompactionConfig(
	stateManager: StateManager,
	activeProviderId: string,
	useAutoCondense: boolean,
): CoreCompactionConfig | undefined {
	if (!useAutoCondense) {
		return undefined
	}
	const strategy = getCompactionStrategySetting(stateManager)
	const summarizer = resolveCompactionSummarizerConfig(stateManager, activeProviderId)
	return {
		enabled: true,
		strategy,
		...(summarizer ? { summarizer } : {}),
	}
}
