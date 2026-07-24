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
 * Адаптивный reserveTokens: 25% от контекст-окна, clamp [4096, 16384].
 * Для маленьких контекстов (20k) — 5k, для больших (128k) — 16k.
 */
function computeAdaptiveReserveTokens(contextWindow?: number): number {
	const ctx = contextWindow ?? 32000
	return Math.min(16384, Math.max(4096, Math.floor(ctx * 0.25)))
}

/**
 * Прочитать текущий контекст-окно провайдера из настроек (динамически).
 * Вызывается на каждой проверке компакции, чтобы реагировать на изменения
 * контекст-окна модели без перезапуска сессии.
 */
function readProviderContextWindow(stateManager: StateManager, providerId: string): number | undefined {
	const apiConfig = stateManager.getApiConfiguration()
	if (providerId === "lmstudio" || providerId === "openai-compatible") {
		const raw = apiConfig?.lmStudioMaxTokens
		if (raw) {
			const parsed = Number.parseInt(String(raw).trim(), 10)
			if (Number.isFinite(parsed) && parsed > 0) return parsed
		}
	}
	if (providerId === "ollama") {
		const raw = apiConfig?.ollamaApiOptionsCtxNum
		if (raw) {
			const parsed = Number.parseInt(String(raw).trim(), 10)
			if (Number.isFinite(parsed) && parsed > 0) return parsed
		}
	}
	return undefined
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
	const explicitMaxInputTokens = stateManager.getGlobalSettingsKey("compactionMaxInputTokens")
	const promptTemplateBefore = stateManager.getGlobalSettingsKey("compactionPromptTemplateBefore")
	const promptTemplateAfter = stateManager.getGlobalSettingsKey("compactionPromptTemplateAfter")

	const summarizer = resolveCompactionSummarizerConfig(stateManager, activeProviderId)

	// Agentario: вычисляем maxInputTokens как простое число для статического fallback.
	// Приоритет: (1) ручная настройка пользователя, (2) providerContextWindow из session-factory.
	const effectiveMaxInputTokens =
		(typeof explicitMaxInputTokens === "number" && explicitMaxInputTokens > 0)
			? explicitMaxInputTokens
			: (typeof providerContextWindow === "number" && providerContextWindow > 0)
				? providerContextWindow
				: undefined

	// Agentario: адаптивный reserveTokens — по умолчанию 25% от контекст-окна, clamp [4096, 16384].
	// Ранее был фиксированный 16384, что составляло 50% контекста 32k и вызывало
	// слишком частую компакцию. Теперь маленькие контексты (20k) триггерятся на 75%,
	// большие (128k) — на 87.5%.
	const defaultReserve = computeAdaptiveReserveTokens(providerContextWindow)

	Logger.log(`[CompactionSettings] build: provider=${activeProviderId}, providerContextWindow=${providerContextWindow ?? "undefined"}, explicitMaxInputTokens=${explicitMaxInputTokens ?? "undefined"}, effectiveMaxInputTokens=${effectiveMaxInputTokens ?? "undefined"}, defaultReserve=${defaultReserve}`)

	return {
		enabled: true,
		strategy,
		...(summarizer ? { summarizer } : {}),
		...(typeof chunkSize === "number" ? { chunkSize } : {}),
		...(typeof doubleSummarization === "boolean" ? { doubleSummarization } : {}),
		...(typeof effectiveMaxInputTokens === "number" ? { maxInputTokens: effectiveMaxInputTokens } : {}),
		// Agentario: динамический резолвер контекст-окна.
		// Вызывается на каждой проверке компакции. Читает актуальное значение
		// из настроек провайдера, чтобы реагировать на перезагрузку модели
		// в LM Studio/Ollama без перезапуска сессии.
		maxInputTokensResolver: () => {
			const explicit = stateManager.getGlobalSettingsKey("compactionMaxInputTokens")
			if (typeof explicit === "number" && explicit > 0) return explicit
			const dynamicWindow = readProviderContextWindow(stateManager, activeProviderId)
			if (typeof dynamicWindow === "number" && dynamicWindow > 0) return dynamicWindow
			return providerContextWindow
		},
		// Agentario: динамический резолвер reserveTokens.
		// Если пользователь задал явное значение — используем его.
		// Иначе — адаптивный (25% от контекст-окна, clamp [4096, 16384]).
		reserveTokensResolver: () => {
			const explicit = stateManager.getGlobalSettingsKey("compactionReserveTokens")
			if (typeof explicit === "number" && explicit > 0) return explicit
			// Читаем актуальный контекст-окно для адаптивного расчёта
			const dynamicWindow = readProviderContextWindow(stateManager, activeProviderId)
			return computeAdaptiveReserveTokens(dynamicWindow ?? providerContextWindow)
		},
		...(promptTemplateBefore ? { promptTemplateBefore } : {}),
		...(promptTemplateAfter ? { promptTemplateAfter } : {}),
	}
}
