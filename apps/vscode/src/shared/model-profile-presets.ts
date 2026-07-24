import type { ApiConfiguration, ModelInfo } from "./api"
import { SecretKeys } from "./storage/state-keys"

/** Non-secret provider fields captured alongside apiConfiguration. */
export type ModelProfileProviderConfig = {
	baseUrl?: string
	apiLine?: string
	reasoning?: {
		enabled?: boolean
		effort?: string
	}
	/** Сохранённая информация о модели (цены, контекст и т.д.) для каждого mode. */
	selections?: {
		plan?: { modelId: string; modelInfo: ModelInfo }
		act?: { modelId: string; modelInfo: ModelInfo }
	}
}

export type ModelProfilePreset = {
	id: string
	name: string
	planActSeparateModelsSetting: boolean
	apiConfiguration: ApiConfiguration
	providerConfigs: Record<string, ModelProfileProviderConfig>
}

const SECRET_KEY_SET = new Set<string>(SecretKeys)

export function stripSecretsFromApiConfiguration(config: ApiConfiguration): ApiConfiguration {
	const next: ApiConfiguration = { ...config }
	for (const key of Object.keys(next) as (keyof ApiConfiguration)[]) {
		if (SECRET_KEY_SET.has(key)) {
			delete next[key]
		}
	}
	return next
}

export function createModelProfilePreset(input: {
	id: string
	name: string
	planActSeparateModelsSetting: boolean
	apiConfiguration: ApiConfiguration
	providerConfigs: Record<string, ModelProfileProviderConfig>
}): ModelProfilePreset {
	return {
		id: input.id,
		name: input.name.trim(),
		planActSeparateModelsSetting: input.planActSeparateModelsSetting,
		apiConfiguration: stripSecretsFromApiConfiguration(input.apiConfiguration),
		providerConfigs: { ...input.providerConfigs },
	}
}

export function collectProviderIdsFromApiConfiguration(config: ApiConfiguration): string[] {
	const ids = new Set<string>()
	if (config.planModeApiProvider) {
		ids.add(config.planModeApiProvider)
	}
	if (config.actModeApiProvider) {
		ids.add(config.actModeApiProvider)
	}
	return [...ids]
}
