import { type OpenAiCompatibleModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"

/** MiMo Token Plan (подписка) — см. https://mimo.mi.com/docs/en-US/tokenplan/integration/cline */
export const MIMO_TOKEN_PLAN_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
export const MIMO_PAYG_BASE_URL = "https://api.xiaomimimo.com/v1"
export const MIMO_TOKEN_PLAN_MODEL_ID = "mimo-v2.5-pro"
export const MIMO_TOKEN_PLAN_CONTEXT_WINDOW = 1_048_576

export type MimoPresetId = "token-plan" | "payg"

export function getMimoPresetBaseUrl(preset: MimoPresetId): string {
	return preset === "token-plan" ? MIMO_TOKEN_PLAN_BASE_URL : MIMO_PAYG_BASE_URL
}

export function getMimoPresetApiKeyHint(preset: MimoPresetId): string {
	return preset === "token-plan" ? "Ключ Token Plan: tp-…" : "Ключ Pay-as-you-go: sk-…"
}

export function createMimoTokenPlanModelInfo(modelId = MIMO_TOKEN_PLAN_MODEL_ID): OpenAiCompatibleModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		contextWindow: MIMO_TOKEN_PLAN_CONTEXT_WINDOW,
		supportsImages: false,
		supportsPromptCache: false,
		temperature: 1,
		maxTokens: -1,
	}
}

export const MIMO_PRESET_LABELS: Record<MimoPresetId, string> = {
	"token-plan": "MiMo Token Plan (подписка)",
	payg: "MiMo Pay-as-you-go",
}
