import type { ModelInfo as SdkModelInfo } from "@agentario/llms"
import type { ApiConfiguration, ModelInfo as HostModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { createProviderConfigStore } from "./store"
import type { ProviderId } from "./contracts"

function buildCapabilities(info: HostModelInfo): SdkModelInfo["capabilities"] {
	const capabilities: NonNullable<SdkModelInfo["capabilities"]> = []
	if (info.supportsImages) {
		capabilities.push("images")
	}
	if (info.supportsPromptCache) {
		capabilities.push("prompt-cache")
	}
	if (info.supportsReasoning) {
		capabilities.push("reasoning")
	}
	return capabilities.length > 0 ? capabilities : undefined
}

/**
 * Convert extension {@link HostModelInfo} into SDK {@link SdkModelInfo} for session runtime.
 */
export function hostModelInfoToSdkModelInfo(modelId: string, info: HostModelInfo): SdkModelInfo {
	const pricing =
		info.inputPrice !== undefined ||
		info.outputPrice !== undefined ||
		info.cacheReadsPrice !== undefined ||
		info.cacheWritesPrice !== undefined
			? {
					input: info.inputPrice,
					output: info.outputPrice,
					cacheRead: info.cacheReadsPrice,
					cacheWrite: info.cacheWritesPrice,
				}
			: undefined

	return {
		id: modelId,
		name: info.name ?? modelId,
		description: info.description,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		maxInputTokens: info.contextWindow,
		capabilities: buildCapabilities(info),
		temperature: info.temperature,
		apiFormat: info.apiFormat,
		thinkingConfig: info.thinkingConfig,
		pricing,
	}
}

function readLegacyOpenAiModelInfo(mode: Mode, config: ApiConfiguration): HostModelInfo | undefined {
	const info = mode === "plan" ? config.planModeOpenAiModelInfo : config.actModeOpenAiModelInfo
	return info && typeof info.supportsPromptCache === "boolean" ? info : undefined
}

/**
 * Build `knownModels` for the active session from committed provider selection / legacy state.
 */
export function resolveSessionKnownModels(
	providerId: string,
	mode: Mode,
	modelId: string | undefined,
	apiConfig: ApiConfiguration | undefined,
): Record<string, SdkModelInfo> | undefined {
	if (!modelId?.trim() || !apiConfig) {
		return undefined
	}

	const trimmedModelId = modelId.trim()
	const store = createProviderConfigStore()
	const selection = store.readSelection(providerId as ProviderId, mode)
	let hostModelInfo =
		selection?.modelId === trimmedModelId ? selection.modelInfo : undefined

	if (!hostModelInfo && providerId === "openai") {
		hostModelInfo = readLegacyOpenAiModelInfo(mode, apiConfig)
	}

	if (!hostModelInfo || typeof hostModelInfo.supportsPromptCache !== "boolean") {
		return undefined
	}

	return {
		[trimmedModelId]: hostModelInfoToSdkModelInfo(trimmedModelId, hostModelInfo),
	}
}
