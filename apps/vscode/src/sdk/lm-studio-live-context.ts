/**
 * Shared LM Studio live context-window fetch + short TTL cache.
 * Used by resolveModelInfo (UI), session-factory, and compaction-settings so
 * mid-session model reloads stay consistent across the progress bar and compaction.
 *
 * IMPORTANT: LM Studio often has an embedding model loaded alongside the chat model.
 * Embedding models typically report context ~2048. Picking the first loaded model
 * (old behavior) poisoned chat context / compaction with 2k. Always prefer the
 * selected LLM model and skip embeddings.
 */

import {
	isLmStudioEmbeddingModelType,
	lmStudioModelMatches,
} from "@agentario/shared"

const LM_STUDIO_LIVE_CACHE_TTL_MS = 30_000

type LmStudioLiveModel = {
	id?: string
	type?: string
	state?: string
	loaded_context_length?: number
	max_context_length?: number
}

type LiveCacheEntry = { value: number; timestamp: number; modelKey: string }

let lmStudioLiveCache: LiveCacheEntry | undefined
let lmStudioForceInFlight: { modelKey: string; promise: Promise<number | undefined> } | undefined

function cacheKey(preferredModelId?: string): string {
	return preferredModelId?.trim() || "*"
}

function looksLikeEmbeddingModel(model: LmStudioLiveModel): boolean {
	if (isLmStudioEmbeddingModelType(model.type)) {
		return true
	}
	const id = (model.id ?? "").toLowerCase()
	return id.includes("embed") || id.includes("embedding")
}

function isLoadedLlm(model: LmStudioLiveModel): boolean {
	if (looksLikeEmbeddingModel(model)) {
		return false
	}
	const ctx = model.loaded_context_length ?? model.max_context_length
	return model.state === "loaded" && typeof ctx === "number" && ctx > 0
}

function contextOf(model: LmStudioLiveModel): number | undefined {
	const loaded = model.loaded_context_length
	if (typeof loaded === "number" && loaded > 0) {
		return loaded
	}
	const max = model.max_context_length
	if (typeof max === "number" && max > 0) {
		return max
	}
	return undefined
}

/**
 * Pick context window for the chat LLM, never for embeddings.
 * Priority: preferred model match → largest loaded LLM context → any LLM max_context.
 */
export function pickLmStudioChatContextWindow(
	models: LmStudioLiveModel[],
	preferredModelId?: string,
): number | undefined {
	if (!Array.isArray(models) || models.length === 0) {
		return undefined
	}

	const preferred = preferredModelId?.trim()
	if (preferred) {
		const match = models.find(
			(m) =>
				typeof m.id === "string" &&
				lmStudioModelMatches(m.id, preferred) &&
				!looksLikeEmbeddingModel(m),
		)
		const matchedCtx = match ? contextOf(match) : undefined
		if (matchedCtx) {
			return matchedCtx
		}
	}

	const loadedLlms = models.filter(isLoadedLlm)
	if (loadedLlms.length > 0) {
		let best = 0
		for (const m of loadedLlms) {
			const ctx = contextOf(m) ?? 0
			if (ctx > best) {
				best = ctx
			}
		}
		if (best > 0) {
			return best
		}
	}

	// Fallback: any non-embedding model with a context length (not necessarily loaded)
	let bestAny = 0
	for (const m of models) {
		if (looksLikeEmbeddingModel(m)) {
			continue
		}
		const ctx = contextOf(m) ?? 0
		if (ctx > bestAny) {
			bestAny = ctx
		}
	}
	return bestAny > 0 ? bestAny : undefined
}

export function getCachedLmStudioContextWindow(preferredModelId?: string): number | undefined {
	if (!lmStudioLiveCache) {
		return undefined
	}
	if (Date.now() - lmStudioLiveCache.timestamp >= LM_STUDIO_LIVE_CACHE_TTL_MS) {
		return undefined
	}
	if (lmStudioLiveCache.modelKey !== cacheKey(preferredModelId)) {
		return undefined
	}
	return lmStudioLiveCache.value
}

export function setCachedLmStudioContextWindow(value: number, preferredModelId?: string): void {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		lmStudioLiveCache = {
			value,
			timestamp: Date.now(),
			modelKey: cacheKey(preferredModelId),
		}
	}
}

export function invalidateLmStudioContextWindowCache(): void {
	lmStudioLiveCache = undefined
}

async function requestLmStudioContextWindow(
	baseUrl?: string,
	preferredModelId?: string,
): Promise<number | undefined> {
	const url = `${(baseUrl?.trim() || "http://127.0.0.1:1234").replace(/\/+$/, "")}/api/v0/models`
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)
		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timeout)
		if (!response.ok) {
			return undefined
		}
		const data = (await response.json()) as { data?: LmStudioLiveModel[] }
		const value = pickLmStudioChatContextWindow(data.data ?? [], preferredModelId)
		if (typeof value === "number" && value > 0) {
			setCachedLmStudioContextWindow(value, preferredModelId)
			return value
		}
		return undefined
	} catch {
		return undefined
	}
}

/**
 * Fetch loaded_context_length from LM Studio native `/api/v0/models`.
 * OpenAI-compatible `/v1/models` does not include these fields.
 * `force` bypasses TTL and dedupes concurrent force calls (max + reserve resolvers).
 * Pass `preferredModelId` so embedding models (often 2048) are not selected.
 */
export async function fetchLmStudioContextWindowLive(
	baseUrl?: string,
	options?: { force?: boolean; preferredModelId?: string },
): Promise<number | undefined> {
	const preferredModelId = options?.preferredModelId
	const key = cacheKey(preferredModelId)

	if (!options?.force) {
		const cached = getCachedLmStudioContextWindow(preferredModelId)
		if (cached !== undefined) {
			return cached
		}
		return requestLmStudioContextWindow(baseUrl, preferredModelId)
	}

	if (lmStudioForceInFlight && lmStudioForceInFlight.modelKey === key) {
		return lmStudioForceInFlight.promise
	}
	const promise = requestLmStudioContextWindow(baseUrl, preferredModelId).finally(() => {
		if (lmStudioForceInFlight?.promise === promise) {
			lmStudioForceInFlight = undefined
		}
	})
	lmStudioForceInFlight = { modelKey: key, promise }
	return promise
}
