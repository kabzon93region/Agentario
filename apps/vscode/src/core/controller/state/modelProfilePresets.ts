import type { ApiConfiguration } from "@shared/api"
import {
	collectProviderIdsFromApiConfiguration,
	createModelProfilePreset,
	type ModelProfilePreset,
	type ModelProfileProviderConfig,
	stripSecretsFromApiConfiguration,
} from "@shared/model-profile-presets"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import type { ProviderConfigPatch } from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { toSdkProviderId } from "@/sdk/model-catalog/sdk-provider-id"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import type { Mode } from "@shared/storage/types"
import { Logger } from "@/shared/services/Logger"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "../models/taskApiModel"
import type { Controller } from ".."

function readProviderConfigSnapshot(providerId: string): ModelProfileProviderConfig | undefined {
	const storeConfig = getProviderSettingsManager().getProviderSettings(toSdkProviderId(providerId))
	const snapshot: ModelProfileProviderConfig = {}
	if (typeof storeConfig?.baseUrl === "string" && storeConfig.baseUrl.trim()) {
		snapshot.baseUrl = storeConfig.baseUrl.trim()
	}
	if (typeof storeConfig?.apiLine === "string" && storeConfig.apiLine.trim()) {
		snapshot.apiLine = storeConfig.apiLine.trim()
	}
	const reasoning = storeConfig?.reasoning
	if (reasoning && typeof reasoning === "object") {
		snapshot.reasoning = {
			enabled: typeof reasoning.enabled === "boolean" ? reasoning.enabled : undefined,
			effort: typeof reasoning.effort === "string" ? reasoning.effort : undefined,
		}
	}
	return Object.keys(snapshot).length > 0 ? snapshot : undefined
}

function preserveSecretsFromPrevious(
	target: ApiConfiguration,
	previous: ApiConfiguration,
): ApiConfiguration {
	const merged = { ...target }
	for (const key of Object.keys(previous) as (keyof ApiConfiguration)[]) {
		const lower = key.toLowerCase()
		if (lower.includes("apikey") || lower.includes("secret") || key === "authNonce") {
			merged[key] = previous[key]
		}
	}
	return merged
}

function resolveModelIdForMode(apiConfiguration: ApiConfiguration, mode: Mode): string | undefined {
	const provider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
	if (!provider) {
		return undefined
	}
	const modelKey = getProviderModelIdKey(provider, mode)
	const modelId = apiConfiguration[modelKey as keyof ApiConfiguration]
	return typeof modelId === "string" && modelId.trim() ? modelId.trim() : undefined
}

function syncProviderSelectionsFromPreset(controller: Controller, preset: ModelProfilePreset): void {
	const store = controller.getProviderConfigStore()
	const modes: Mode[] = preset.planActSeparateModelsSetting ? ["plan", "act"] : ["plan", "act"]

	for (const mode of modes) {
		const provider = mode === "plan" ? preset.apiConfiguration.planModeApiProvider : preset.apiConfiguration.actModeApiProvider
		if (!provider) {
			continue
		}
		const providerId = parseProviderId(provider)
		if (!providerId) {
			continue
		}
		const modelId = resolveModelIdForMode(preset.apiConfiguration, mode)
		if (!modelId) {
			continue
		}
		const existing = store.readSelection(providerId, mode)
		store.commitSelection(providerId, mode, {
			providerId: providerId.toString(),
			modelId,
			modelInfo: existing?.modelInfo ?? { name: modelId },
		})
	}
}

function writeProviderConfigSnapshot(providerId: string, providerConfig: ModelProfileProviderConfig): void {
	const sdkProviderId = toSdkProviderId(providerId)
	const manager = getProviderSettingsManager()
	const existing = manager.getProviderSettings(sdkProviderId) ?? {}
	const next: Record<string, unknown> = { ...existing, provider: sdkProviderId }

	if (providerConfig.baseUrl !== undefined) {
		next.baseUrl = providerConfig.baseUrl
	}
	if (providerConfig.apiLine !== undefined) {
		next.apiLine = providerConfig.apiLine
	}
	if (providerConfig.reasoning) {
		next.reasoning = {
			...(typeof existing.reasoning === "object" && existing.reasoning ? existing.reasoning : {}),
			enabled: providerConfig.reasoning.enabled,
			effort: providerConfig.reasoning.effort,
		}
	}

	manager.saveProviderSettings(next as never, { setLastUsed: false })
	Logger.log(
		`[ModelProfilePreset] Provider config persisted for ${providerId}: baseUrl=${providerConfig.baseUrl ?? "unchanged"}, apiLine=${providerConfig.apiLine ?? "unchanged"}`,
	)
}

export function readModelProfilePresets(controller: Controller): ModelProfilePreset[] {
	const stored = controller.stateManager.getGlobalSettingsKey("modelProfilePresets")
	return Array.isArray(stored) ? (stored as ModelProfilePreset[]) : []
}

export function readActiveModelProfilePresetId(controller: Controller): string | undefined {
	return controller.stateManager.getGlobalSettingsKey("activeModelProfilePresetId")
}

/** Grace period after preset apply during which stale webview partial updates are ignored. */
export const MODEL_PROFILE_PRESET_APPLY_GUARD_MS = 2000

export function wasModelProfilePresetAppliedRecently(
	stateManager: { getGlobalSettingsKey?: (key: string) => unknown },
	windowMs: number = MODEL_PROFILE_PRESET_APPLY_GUARD_MS,
): boolean {
	const presetAppliedAt = stateManager.getGlobalSettingsKey?.("modelProfilePresetAppliedAt") ?? 0
	return typeof presetAppliedAt === "number" && Date.now() - presetAppliedAt <= windowMs
}

export function saveModelProfilePresets(
	controller: Controller,
	presets: ModelProfilePreset[],
	activePresetId?: string,
): void {
	controller.stateManager.setGlobalState("modelProfilePresets", presets)
	if (activePresetId !== undefined) {
		controller.stateManager.setGlobalState("activeModelProfilePresetId", activePresetId || undefined)
	}
}

export function buildModelProfilePresetFromCurrentSettings(
	controller: Controller,
	id: string,
	name: string,
): ModelProfilePreset {
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const planActSeparateModelsSetting =
		controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false
	const providerConfigs: Record<string, ModelProfileProviderConfig> = {}
	for (const providerId of collectProviderIdsFromApiConfiguration(apiConfiguration)) {
		const snapshot = readProviderConfigSnapshot(providerId)
		if (snapshot) {
			providerConfigs[providerId] = snapshot
		}
	}
	return createModelProfilePreset({
		id,
		name,
		planActSeparateModelsSetting,
		apiConfiguration,
		providerConfigs,
	})
}

export async function applyModelProfilePreset(controller: Controller, presetId: string): Promise<void> {
	const presets = readModelProfilePresets(controller)
	const preset = presets.find((entry) => entry.id === presetId)
	if (!preset) {
		throw new Error(`Model profile preset not found: ${presetId}`)
	}

	// Mark immediately so concurrent stale partial updates from the previous
	// provider UI cannot overwrite the preset while we are still applying it.
	controller.stateManager.setGlobalState("modelProfilePresetAppliedAt", Date.now())

	const previousApiConfiguration = controller.stateManager.getApiConfiguration()
	const mergedApiConfiguration = preserveSecretsFromPrevious(
		stripSecretsFromApiConfiguration(preset.apiConfiguration),
		previousApiConfiguration,
	)

	controller.stateManager.setGlobalState("planActSeparateModelsSetting", preset.planActSeparateModelsSetting)

	const store = controller.getProviderConfigStore()
	for (const [providerId, providerConfig] of Object.entries(preset.providerConfigs)) {
		const patch: ProviderConfigPatch = {}
		if (providerConfig.baseUrl !== undefined) {
			patch.baseUrl = providerConfig.baseUrl
		}
		if (providerConfig.apiLine !== undefined) {
			patch.apiLine = providerConfig.apiLine
		}
		if (providerConfig.reasoning) {
			patch.reasoning = {
				enabled: providerConfig.reasoning.enabled,
				effort: providerConfig.reasoning.effort as "low" | "medium" | "high" | "xhigh" | "none" | undefined,
			}
		}
		if (Object.keys(patch).length > 0) {
			store.write(providerId as never, patch)
			writeProviderConfigSnapshot(providerId, providerConfig)
		}
	}

	controller.stateManager.setApiConfiguration(mergedApiConfiguration)
	controller.stateManager.setGlobalState("activeModelProfilePresetId", preset.id)

	const applySeq = (controller.stateManager.getGlobalStateKey("modelProfilePresetApplySeq") ?? 0) + 1
	controller.stateManager.setGlobalState("modelProfilePresetApplySeq", applySeq)

	syncProviderSelectionsFromPreset(controller, preset)
	for (const [providerId, providerConfig] of Object.entries(preset.providerConfigs)) {
		const patch: ProviderConfigPatch = {}
		if (providerConfig.baseUrl !== undefined) {
			patch.baseUrl = providerConfig.baseUrl
		}
		if (providerConfig.apiLine !== undefined) {
			patch.apiLine = providerConfig.apiLine
		}
		if (providerConfig.reasoning) {
			patch.reasoning = {
				enabled: providerConfig.reasoning.enabled,
				effort: providerConfig.reasoning.effort as "low" | "medium" | "high" | "xhigh" | "none" | undefined,
			}
		}
		if (Object.keys(patch).length > 0) {
			store.write(providerId as never, patch)
			writeProviderConfigSnapshot(providerId, providerConfig)
		}
	}

	if (controller.task) {
		const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
		const modelId = resolveActiveModelIdFromApiConfiguration(mergedApiConfiguration, currentMode)
		controller.task.api = createTaskApiModelShim(modelId)
	}

	Logger.log(
		`[ModelProfilePreset] Applied "${preset.name}" (${preset.id}): plan=${mergedApiConfiguration.planModeApiProvider}/${mergedApiConfiguration.planModeApiModelId}, act=${mergedApiConfiguration.actModeApiProvider}/${mergedApiConfiguration.actModeApiModelId}`,
	)

	controller.handleApiConfigurationChanged(previousApiConfiguration, mergedApiConfiguration)
	await controller.stateManager.flushPendingState?.()
	await controller.postStateToWebview()
}
