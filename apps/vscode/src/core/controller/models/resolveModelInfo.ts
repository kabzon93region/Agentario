import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type { ProviderModelsResult } from "@/sdk/model-catalog/contracts"
import { providerAllowsCustomModelIds } from "@/sdk/model-catalog/custom-model-ids"
import { applyHostModelInfoOverrides } from "@/sdk/model-catalog/host-overrides"
import { ResolveModelInfoRequest, ResolveModelInfoResponse } from "@/shared/proto/agentario/models"
import { toProtobufModelInfo } from "@/shared/proto-conversions/models/typeConversion"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseProviderIdRequest,
} from "./providerCatalogShared"

/**
 * Agentario: запросить live context window из LM Studio API.
 * Кэширует результат на 30 секунд, чтобы не перегружать API при частых вызовах
 * resolveModelInfo от webview.
 */
let lmStudioLiveCache: { value: number; timestamp: number } | undefined
const LM_STUDIO_LIVE_CACHE_TTL_MS = 30_000

async function fetchLmStudioContextWindowLive(
	apiConfiguration?: Pick<ApiConfiguration, "lmStudioBaseUrl">,
): Promise<number | undefined> {
	if (lmStudioLiveCache && Date.now() - lmStudioLiveCache.timestamp < LM_STUDIO_LIVE_CACHE_TTL_MS) {
		return lmStudioLiveCache.value
	}
	const baseUrl = apiConfiguration?.lmStudioBaseUrl?.trim() || "http://127.0.0.1:1234"
	// Agentario: /api/v0/models (native) содержит loaded_context_length, /v1/models (OpenAI) — нет.
	const url = `${baseUrl.replace(/\/+$/, "")}/api/v0/models`
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)
		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timeout)
		if (!response.ok) return undefined
		const data = await response.json() as { data?: Array<{ id: string; loaded_context_length?: number; max_context_length?: number; state?: string }> }
		const models = data.data
		if (!Array.isArray(models) || models.length === 0) return undefined
		const loaded = models.find((m) => m.state === "loaded" && m.loaded_context_length && m.loaded_context_length > 0)
		const value = loaded?.loaded_context_length ?? models.find((m) => m.loaded_context_length && m.loaded_context_length > 0)?.loaded_context_length ?? models.find((m) => m.max_context_length && m.max_context_length > 0)?.max_context_length
		if (typeof value === "number" && value > 0) {
			lmStudioLiveCache = { value, timestamp: Date.now() }
			return value
		}
		return undefined
	} catch {
		return undefined
	}
}

/**
 * Resolve a single (provider, model) pair for the webview's status /
 * summary surfaces (`useNormalizedApiConfiguration`, TaskHeader,
 * context-window indicator, etc.).
 *
 * Resolution order:
 *
 *   1. Committed selection — the user's most-recently-chosen plan/act
 *      selection in the provider config store. This is the source of
 *      truth for dynamic-list providers (openrouter, openai-compatible,
 *      ollama, lmstudio, requesty, litellm, …) where the picker writes
 *      the live `ModelInfo` into the selection when the user commits.
 *
 *   2. Catalog peek — a non-fetching look-up of the catalog cache for
 *      the provider's current effective config fingerprint. Hits when
 *      the catalog has been populated for the current config, either
 *      by the settings UI opening or by a prior call to this handler.
 *
 *   3. Awaited catalog resolve — if the peek misses, awaits
 *      `catalog.resolveModels(providerId)` so the response carries
 *      authoritative data the first time it is asked. The catalog has
 *      in-flight dedup and a per-fingerprint cache, so subsequent
 *      callers do not pay this cost again.
 *
 * If after all three steps neither the committed selection nor the
 * SDK catalog has anything to say, the handler returns
 * `source: "unknown"`. Webview consumers render that as a neutral
 * placeholder rather than fabricating a model info.
 */
export async function resolveModelInfo(
	controller: ProviderCatalogController,
	request: ResolveModelInfoRequest,
): Promise<ResolveModelInfoResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const requestedModelId = request.modelId?.trim() || ""
	const apiConfiguration = hasProviderCatalogStateController(controller)
		? controller.stateManager.getApiConfiguration?.()
		: undefined

	// Agentario: для LM Studio запрашиваем live context window из API,
	// чтобы UI показывал реальное значение, а не stale из globalState/preset.
	let liveContextWindow: number | undefined
	if (providerId === "lmstudio") {
		liveContextWindow = await fetchLmStudioContextWindowLive(apiConfiguration)
	}

	const finalize = (
		modelId: string,
		modelInfo: ModelInfo,
		source: ResolveModelInfoResponse["source"],
	): ResolveModelInfoResponse =>
		ResolveModelInfoResponse.create({
			providerId,
			modelId,
			modelInfo: toProtobufModelInfo(applyHostModelInfoOverrides(providerId, modelId, modelInfo, apiConfiguration, liveContextWindow)),
			source,
		})

	const store = controller.getProviderConfigStore()
	if (requestedModelId) {
		const actSelection = store.readSelection(providerId, "act")
		if (actSelection?.modelId === requestedModelId) {
			return finalize(actSelection.modelId, actSelection.modelInfo, "committed-selection")
		}

		const planSelection = store.readSelection(providerId, "plan")
		if (planSelection?.modelId === requestedModelId) {
			return finalize(planSelection.modelId, planSelection.modelInfo, "committed-selection")
		}
	}

	// Custom-model-id providers (openai-compatible, ollama, lmstudio, litellm)
	// accept arbitrary user-supplied model ids that the SDK catalog does not
	// list. For these, a catalog lookup must only count as a hit when it matches
	// the requested id; an unrecognized id is the user's own model and must be
	// preserved rather than replaced with the catalog default.
	const allowCustomModelIds = providerAllowsCustomModelIds(providerId)

	const catalog = controller.getProviderCatalog()
	const cached = catalog.peekModels(providerId)
	if (cached?.ok) {
		const hit = pickFromCatalog(cached, requestedModelId, allowCustomModelIds)
		if (hit) {
			return finalize(hit.modelId, hit.modelInfo, hit.matchedRequested ? "sdk-known-models" : "sdk-default")
		}
	}

	// Cache miss. Await a real resolve so the caller doesn't have to
	// retry or race a warmer. The catalog dedup's in-flight requests
	// and caches the result, so the per-fingerprint cost is paid once.
	const resolved = await catalog.resolveModels(providerId).catch(() => undefined)
	if (resolved?.ok) {
		const hit = pickFromCatalog(resolved, requestedModelId, allowCustomModelIds)
		if (hit) {
			return finalize(hit.modelId, hit.modelInfo, hit.matchedRequested ? "sdk-known-models" : "sdk-default")
		}
	}

	return ResolveModelInfoResponse.create({
		providerId,
		modelId: requestedModelId,
		source: "unknown",
	})
}

function pickFromCatalog(
	result: Extract<ProviderModelsResult, { ok: true }>,
	requestedModelId: string,
	allowCustomModelIds: boolean,
) {
	const matchedRequested = Boolean(requestedModelId) && result.models.has(requestedModelId)

	// For custom-model-id providers, never substitute the catalog default for an
	// unrecognized requested id — the user's id is authoritative.
	if (allowCustomModelIds && requestedModelId && !matchedRequested) {
		return undefined
	}

	const modelId = matchedRequested ? requestedModelId : result.defaultModelId
	const modelInfo = modelId ? result.models.get(modelId) : undefined
	if (!modelId || !modelInfo) {
		return undefined
	}
	return { modelId, modelInfo, matchedRequested: requestedModelId === modelId }
}
