import type { CoreCompactionConfig, CoreCompactionSummarizerConfig } from "@agentario/core"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { fetchLmStudioContextWindowLive, setCachedLmStudioContextWindow } from "./lm-studio-live-context"
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
 * Адаптивный reserveTokens: 15% от контекст-окна, clamp [4096, 16384].
 * Для 32k → ~4.9k reserve → триггер ~85% (раньше 25%/75% срабатывало слишком рано
 * на завышенной char-оценке относительно реального usage от LM Studio).
 */
function computeAdaptiveReserveTokens(contextWindow?: number): number {
	const ctx = contextWindow ?? 32000
	return Math.min(16384, Math.max(4096, Math.floor(ctx * 0.15)))
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

function readPreferredLmStudioModelId(stateManager: StateManager): string | undefined {
	const apiConfig = stateManager.getApiConfiguration()
	const mode = stateManager.getGlobalSettingsKey("mode")
	const fromMode =
		mode === "plan"
			? apiConfig?.planModeLmStudioModelId
			: apiConfig?.actModeLmStudioModelId
	const candidate = fromMode ?? apiConfig?.lmStudioModelId
	const trimmed = typeof candidate === "string" ? candidate.trim() : ""
	return trimmed || undefined
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

	// Agentario: адаптивный reserveTokens — 15% от контекст-окна, clamp [4096, 16384].
	// Ранее 25% давал триггер ~75% и ложные срабатывания на завышенной estimate.
	const defaultReserve = computeAdaptiveReserveTokens(providerContextWindow)

	Logger.log(`[CompactionSettings] build: provider=${activeProviderId}, providerContextWindow=${providerContextWindow ?? "undefined"}, explicitMaxInputTokens=${explicitMaxInputTokens ?? "undefined"}, effectiveMaxInputTokens=${effectiveMaxInputTokens ?? "undefined"}, defaultReserve=${defaultReserve}`)


/** Shared fallback chain: LM Studio live API (force) -> persisted settings -> session window. */
async function resolveDynamicContextWindow(
	stateManager: StateManager,
	activeProviderId: string | undefined,
	providerContextWindow: number | undefined,
	preferredModelId?: string,
): Promise<number | undefined> {
	// Always refresh LM Studio from the runtime so mid-session context reloads
	// (e.g. user lowered n_ctx) match compaction + the chat progress bar.
	if (activeProviderId === "lmstudio" || activeProviderId === "openai-compatible") {
		const apiConfig = stateManager.getApiConfiguration()
		const liveWindow = await fetchLmStudioContextWindowLive(apiConfig?.lmStudioBaseUrl, {
			force: true,
			preferredModelId,
		})
		if (typeof liveWindow === "number" && liveWindow > 0) {
			stateManager.setGlobalState("lmStudioMaxTokens", String(liveWindow))
			setCachedLmStudioContextWindow(liveWindow, preferredModelId)
			Logger.log(`[CompactionSettings] live LM Studio context window=${liveWindow} (model=${preferredModelId ?? "any"})`)
			return liveWindow
		}
	}
	const dynamicWindow = readProviderContextWindow(stateManager, activeProviderId ?? "")
	if (typeof dynamicWindow === "number" && dynamicWindow > 0) {
		return dynamicWindow
	}
	return typeof providerContextWindow === "number" && providerContextWindow > 0
		? providerContextWindow
		: undefined
}

	return {
		enabled: true,
		strategy,
		...(summarizer ? { summarizer } : {}),
		...(typeof chunkSize === "number" ? { chunkSize } : {}),
		...(typeof doubleSummarization === "boolean" ? { doubleSummarization } : {}),
		...(typeof effectiveMaxInputTokens === "number" ? { maxInputTokens: effectiveMaxInputTokens } : {}),
		// Agentario: динамический резолвер контекст-окна (async).
		// Вызывается на каждой проверке компакции. Читает актуальное значение
		// из настроек провайдера. Для LM Studio: если значение отсутствует
		// или выглядит подозрительно — запрашивает live из API и сохраняет.
		maxInputTokensResolver: async () => {
			const explicit = stateManager.getGlobalSettingsKey("compactionMaxInputTokens")
			if (typeof explicit === "number" && explicit > 0) return explicit
			return resolveDynamicContextWindow(
				stateManager,
				activeProviderId,
				providerContextWindow,
				readPreferredLmStudioModelId(stateManager),
			)
		},
		// Agentario: динамический резолвер reserveTokens (async).
		// Если пользователь задал явное значение — используем его.
		// Иначе — адаптивный (25% от контекст-окна, clamp [4096, 16384]).
		reserveTokensResolver: async () => {
			const explicit = stateManager.getGlobalSettingsKey("compactionReserveTokens")
			if (typeof explicit === "number" && explicit > 0) return explicit
			const window = await resolveDynamicContextWindow(
				stateManager,
				activeProviderId,
				providerContextWindow,
				readPreferredLmStudioModelId(stateManager),
			)
			return computeAdaptiveReserveTokens(window)
		},
		...(promptTemplateBefore ? { promptTemplateBefore } : {}),
		...(promptTemplateAfter ? { promptTemplateAfter } : {}),
	}
}
