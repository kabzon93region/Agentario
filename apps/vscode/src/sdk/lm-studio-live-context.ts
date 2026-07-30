/**
 * Shared LM Studio live context-window fetch + short TTL cache.
 * Used by resolveModelInfo (UI), session-factory, and compaction-settings so
 * mid-session model reloads stay consistent across the progress bar and compaction.
 */

const LM_STUDIO_LIVE_CACHE_TTL_MS = 30_000

let lmStudioLiveCache: { value: number; timestamp: number } | undefined
let lmStudioForceInFlight: Promise<number | undefined> | undefined

export function getCachedLmStudioContextWindow(): number | undefined {
	if (!lmStudioLiveCache) {
		return undefined
	}
	if (Date.now() - lmStudioLiveCache.timestamp >= LM_STUDIO_LIVE_CACHE_TTL_MS) {
		return undefined
	}
	return lmStudioLiveCache.value
}

export function setCachedLmStudioContextWindow(value: number): void {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		lmStudioLiveCache = { value, timestamp: Date.now() }
	}
}

export function invalidateLmStudioContextWindowCache(): void {
	lmStudioLiveCache = undefined
}

async function requestLmStudioContextWindow(baseUrl?: string): Promise<number | undefined> {
	const url = `${(baseUrl?.trim() || "http://127.0.0.1:1234").replace(/\/+$/, "")}/api/v0/models`
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)
		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timeout)
		if (!response.ok) {
			return undefined
		}
		const data = (await response.json()) as {
			data?: Array<{
				id: string
				loaded_context_length?: number
				max_context_length?: number
				state?: string
			}>
		}
		const models = data.data
		if (!Array.isArray(models) || models.length === 0) {
			return undefined
		}
		const loaded = models.find((m) => m.state === "loaded" && m.loaded_context_length && m.loaded_context_length > 0)
		const value =
			loaded?.loaded_context_length ??
			models.find((m) => m.loaded_context_length && m.loaded_context_length > 0)?.loaded_context_length ??
			models.find((m) => m.max_context_length && m.max_context_length > 0)?.max_context_length
		if (typeof value === "number" && value > 0) {
			setCachedLmStudioContextWindow(value)
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
 */
export async function fetchLmStudioContextWindowLive(
	baseUrl?: string,
	options?: { force?: boolean },
): Promise<number | undefined> {
	if (!options?.force) {
		const cached = getCachedLmStudioContextWindow()
		if (cached !== undefined) {
			return cached
		}
		return requestLmStudioContextWindow(baseUrl)
	}

	if (lmStudioForceInFlight) {
		return lmStudioForceInFlight
	}
	lmStudioForceInFlight = requestLmStudioContextWindow(baseUrl).finally(() => {
		lmStudioForceInFlight = undefined
	})
	return lmStudioForceInFlight
}
