/**
 * Applies the `ModelInfo` fields the extension owns locally, on top of
 * an adapted SDK `ModelInfo`. Today this is Vertex's
 * `supportsGlobalEndpoint` allowlist (see `./vertex-global-endpoint.ts`)
 * and live context-window values for dynamic local providers (LM Studio,
 * Ollama) that the SDK catalog cannot know without polling the runtime.
 *
 * Both the model-list resolution path (`resolveSdkModels`) and the
 * single-model lookup path (`resolveModelInfo`) pass adapted
 * `ModelInfo` through this function so the same UX guard rails apply
 * regardless of which RPC the webview uses. When the SDK adopts these
 * flags upstream, the override and this file can be removed together.
 */

import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type { ProviderId } from "./contracts"
import { vertexModelSupportsGlobalEndpoint } from "./vertex-global-endpoint"

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value?.trim()) {
		return undefined
	}
	const parsed = Number.parseInt(value.trim(), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function applyDynamicProviderContextWindow(
	providerId: ProviderId,
	modelInfo: ModelInfo,
	apiConfiguration?: Pick<ApiConfiguration, "lmStudioMaxTokens" | "ollamaApiOptionsCtxNum">,
	liveContextWindow?: number,
): ModelInfo {
	if (providerId === "lmstudio") {
		// Prefer live value from API, fallback to persisted lmStudioMaxTokens
		const contextWindow = liveContextWindow ?? parsePositiveInt(apiConfiguration?.lmStudioMaxTokens)
		if (contextWindow) {
			return { ...modelInfo, contextWindow }
		}
	}
	if (providerId === "ollama") {
		const contextWindow = parsePositiveInt(apiConfiguration?.ollamaApiOptionsCtxNum)
		if (contextWindow) {
			return { ...modelInfo, contextWindow }
		}
	}
	return modelInfo
}

export function applyHostModelInfoOverrides(
	providerId: ProviderId,
	modelId: string,
	modelInfo: ModelInfo,
	apiConfiguration?: Pick<ApiConfiguration, "lmStudioMaxTokens" | "ollamaApiOptionsCtxNum">,
	liveContextWindow?: number,
): ModelInfo {
	let result = modelInfo
	if (providerId === "vertex" && vertexModelSupportsGlobalEndpoint(providerId, modelId)) {
		result = { ...result, supportsGlobalEndpoint: true }
	}
	return applyDynamicProviderContextWindow(providerId, result, apiConfiguration, liveContextWindow)
}
