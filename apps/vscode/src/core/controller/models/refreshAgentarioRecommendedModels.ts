import { ClineEnv } from "@/config"
import { isAgentarioStandaloneMode } from "@/shared/agentario-standalone"
import { FALLBACK_CLINE_RECOMMENDED_MODELS, fetchAgentarioRecommendedModels } from "@agentario/core"
import { fetch } from "@/shared/net"

interface AgentarioRecommendedModelData {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface AgentarioRecommendedModelsData {
	recommended: AgentarioRecommendedModelData[]
	free: AgentarioRecommendedModelData[]
	clinePass?: AgentarioRecommendedModelData[]
}

const RECOMMENDED_MODELS_CACHE_TTL_MS = 60 * 60 * 1000

let pendingRefresh: Promise<AgentarioRecommendedModelsData> | null = null
let inMemoryCache: { data: AgentarioRecommendedModelsData; timestamp: number } | null = null

export async function refreshAgentarioRecommendedModels(): Promise<AgentarioRecommendedModelsData> {
	if (isAgentarioStandaloneMode()) {
		return FALLBACK_CLINE_RECOMMENDED_MODELS
	}

	if (inMemoryCache && Date.now() - inMemoryCache.timestamp <= RECOMMENDED_MODELS_CACHE_TTL_MS) {
		return inMemoryCache.data
	}

	if (pendingRefresh) {
		return pendingRefresh
	}

	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheAgentarioRecommendedModels()
		} finally {
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

export function resetAgentarioRecommendedModelsCacheForTests(): void {
	pendingRefresh = null
	inMemoryCache = null
}

function isFallbackRecommendedModels(data: AgentarioRecommendedModelsData): boolean {
	return JSON.stringify(data) === JSON.stringify(FALLBACK_CLINE_RECOMMENDED_MODELS)
}

async function fetchAndCacheAgentarioRecommendedModels(): Promise<AgentarioRecommendedModelsData> {
	// Delegate the actual HTTP fetch + response normalization + offline fallback
	// to the SDK so the CLI/JetBrains and the extension share one implementation.
	// We pass the proxy-aware fetch (per .clinerules/network.md) and the
	// extension's configured API base URL. On failure the SDK returns its own
	// fallback list.
	const result = await fetchAgentarioRecommendedModels({
		baseUrl: ClineEnv.config().apiBaseUrl,
		fetchImpl: fetch,
	})

	// Only pin a populated, non-fallback result in memory for the full TTL; a
	// transient failure (SDK returns a clone of its fallback) should be retried
	// next call.
	if ((result.recommended.length > 0 || result.free.length > 0) && !isFallbackRecommendedModels(result)) {
		inMemoryCache = { data: result, timestamp: Date.now() }
	}
	return result
}
