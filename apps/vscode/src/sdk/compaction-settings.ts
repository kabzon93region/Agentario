import type { CoreCompactionConfig, CoreCompactionSummarizerConfig } from "@agentario/core"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
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
	const modelId = stateManager.getGlobalSettingsKey("compactionModelId")?.trim()
	if (!modelId) {
		return undefined
	}
	const providerId = stateManager.getGlobalSettingsKey("compactionProviderId")?.trim() || activeProviderId
	const baseUrl = stateManager.getGlobalSettingsKey("compactionBaseUrl")?.trim()
	const apiKey = stateManager.getGlobalSettingsKey("compactionApiKey")?.trim()

	return {
		providerId: toSdkProviderId(providerId),
		modelId,
		...(baseUrl ? { baseUrl } : {}),
		...(apiKey ? { apiKey } : {}),
	}
}

/**
 * Построить конфигурацию компакции контекста.
 *
 * @param providerContextWindow — длина контекста провайдера (LM Studio / Ollama),
 *   передаётся из session-factory. Это то же значение, что UI показывает в
 *   настройках провайдера и в полоске контекста чата. Используется как
 *   maxInputTokens для определения порога авто-компакции.
 */
export function buildCompactionConfig(
	stateManager: StateManager,
	activeProviderId: string,
	useAutoCondense: boolean,
	providerContextWindow?: number,
): CoreCompactionConfig | undefined {
	if (!useAutoCondense) {
		return undefined
	}
	const strategy = getCompactionStrategySetting(stateManager)
	const chunkSize = stateManager.getGlobalSettingsKey("compactionChunkSize") ?? 16000
	const doubleSummarization = stateManager.getGlobalSettingsKey("compactionDoubleSummarization") ?? true
	const reserveTokens = stateManager.getGlobalSettingsKey("compactionReserveTokens") ?? 16384
	const explicitMaxInputTokens = stateManager.getGlobalSettingsKey("compactionMaxInputTokens")
	const promptTemplateBefore = stateManager.getGlobalSettingsKey("compactionPromptTemplateBefore")
	const promptTemplateAfter = stateManager.getGlobalSettingsKey("compactionPromptTemplateAfter")

	const summarizer = resolveCompactionSummarizerConfig(stateManager, activeProviderId)

	// Agentario: вычисляем maxInputTokens как простое число.
	// Приоритет: (1) ручная настройка пользователя, (2) providerContextWindow из session-factory.
	// НЕ используем функцию-резолвер — замыкания теряются при передаче через CoreSessionConfig.
	const effectiveMaxInputTokens =
		(typeof explicitMaxInputTokens === "number" && explicitMaxInputTokens > 0)
			? explicitMaxInputTokens
			: (typeof providerContextWindow === "number" && providerContextWindow > 0)
				? providerContextWindow
				: undefined

	Logger.log(`[CompactionSettings] build: provider=${activeProviderId}, providerContextWindow=${providerContextWindow ?? "undefined"}, explicitMaxInputTokens=${explicitMaxInputTokens ?? "undefined"}, effectiveMaxInputTokens=${effectiveMaxInputTokens ?? "undefined"}, reserveTokens=${reserveTokens}`)

	return {
		enabled: true,
		strategy,
		...(summarizer ? { summarizer } : {}),
		...(typeof chunkSize === "number" ? { chunkSize } : {}),
		...(typeof doubleSummarization === "boolean" ? { doubleSummarization } : {}),
		...(typeof reserveTokens === "number" ? { reserveTokens } : {}),
		...(typeof effectiveMaxInputTokens === "number" ? { maxInputTokens: effectiveMaxInputTokens } : {}),
		reserveTokensResolver: () => {
			const currentReserveTokens = stateManager.getGlobalSettingsKey("compactionReserveTokens") ?? 16384
			return typeof currentReserveTokens === "number" ? currentReserveTokens : 16384
		},
		...(promptTemplateBefore ? { promptTemplateBefore } : {}),
		...(promptTemplateAfter ? { promptTemplateAfter } : {}),
	}
}
