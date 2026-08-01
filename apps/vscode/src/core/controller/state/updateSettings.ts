import { randomUUID } from "node:crypto"
import { Empty } from "@shared/proto/agentario/common"
import { PlanActMode, McpDisplayMode as ProtoMcpDisplayMode, UpdateSettingsRequest } from "@shared/proto/agentario/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { ClineEnv } from "@/config"
import { fetchRemoteConfig } from "@/core/storage/remote-config/fetch"
import { clearRemoteConfig } from "@/core/storage/remote-config/utils"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "../../../services/telemetry"
import { BrowserSettings as SharedBrowserSettings } from "../../../shared/BrowserSettings"
import { Controller } from ".."
import { accountLogoutClicked } from "../account/accountLogoutClicked"
import { normalizeProviderSwitchModel } from "../models/providerSwitchNormalization"
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "../models/taskApiModel"
import { applyModelProfilePreset, buildModelProfilePresetFromCurrentSettings, readModelProfilePresets, saveModelProfilePresets } from "./modelProfilePresets"
import type { ModelProfilePreset } from "@shared/model-profile-presets"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettings(controller: Controller, request: UpdateSettingsRequest): Promise<Empty> {
	try {
		if (request.clineEnv !== undefined && request.clineEnv !== "") {
			ClineEnv.setEnvironment(request.clineEnv)
			await accountLogoutClicked(controller, Empty.create())
		}

		if (request.apiConfiguration) {
			const protoApiConfiguration = request.apiConfiguration

			const convertedApiConfigurationFromProto = {
				...protoApiConfiguration,
				// Convert proto ApiProvider enums to native string types
				planModeApiProvider: protoApiConfiguration.planModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.planModeApiProvider)
					: undefined,
				actModeApiProvider: protoApiConfiguration.actModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.actModeApiProvider)
					: undefined,
				planModeReasoningEffort: protoApiConfiguration.planModeReasoningEffort as OpenaiReasoningEffort | undefined,
				actModeReasoningEffort: protoApiConfiguration.actModeReasoningEffort as OpenaiReasoningEffort | undefined,
			}

			const previousApiConfiguration = controller.stateManager.getApiConfiguration()
			const normalizedApiConfiguration = normalizeProviderSwitchModel(
				controller.getProviderConfigStore(),
				previousApiConfiguration,
				convertedApiConfigurationFromProto,
			)

			controller.stateManager.setApiConfiguration(normalizedApiConfiguration)

			if (controller.task) {
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
				const modelId = resolveActiveModelIdFromApiConfiguration(normalizedApiConfiguration, currentMode)
				controller.task.api = createTaskApiModelShim(modelId)
			}
			controller.handleApiConfigurationChanged(previousApiConfiguration, normalizedApiConfiguration)
		}

		// Update telemetry setting
		if (request.telemetrySetting) {
			await controller.updateTelemetrySetting(request.telemetrySetting as TelemetrySetting)
		}

		// Update plan/act separate models setting
		if (request.planActSeparateModelsSetting !== undefined) {
			controller.stateManager.setGlobalState("planActSeparateModelsSetting", request.planActSeparateModelsSetting)
		}

		// Update checkpoints setting
		if (request.enableCheckpointsSetting !== undefined) {
			controller.stateManager.setGlobalState("enableCheckpointsSetting", request.enableCheckpointsSetting)
		}

		// Update MCP responses collapsed setting
		if (request.mcpResponsesCollapsed !== undefined) {
			controller.stateManager.setGlobalState("mcpResponsesCollapsed", request.mcpResponsesCollapsed)
		}

		// Update MCP display mode setting
		if (request.mcpDisplayMode !== undefined) {
			// Convert proto enum to string type
			let displayMode: McpDisplayMode
			switch (request.mcpDisplayMode) {
				case ProtoMcpDisplayMode.RICH:
					displayMode = "rich"
					break
				case ProtoMcpDisplayMode.PLAIN:
					displayMode = "plain"
					break
				case ProtoMcpDisplayMode.MARKDOWN:
					displayMode = "markdown"
					break
				default:
					throw new Error(`Invalid MCP display mode value: ${request.mcpDisplayMode}`)
			}
			controller.stateManager.setGlobalState("mcpDisplayMode", displayMode)
		}

		if (request.mode !== undefined) {
			const mode = request.mode === PlanActMode.PLAN ? "plan" : "act"
			controller.stateManager.setGlobalState("mode", mode)
		}

		if (request.preferredLanguage !== undefined) {
			controller.stateManager.setGlobalState("preferredLanguage", request.preferredLanguage)
		}

		// Update terminal timeout setting
		if (request.shellIntegrationTimeout !== undefined) {
			controller.stateManager.setGlobalState("shellIntegrationTimeout", Number(request.shellIntegrationTimeout))
			controller.terminalManager?.setShellIntegrationTimeout(Number(request.shellIntegrationTimeout))
		}

		// Update terminal reuse setting
		if (request.terminalReuseEnabled !== undefined) {
			controller.stateManager.setGlobalState("terminalReuseEnabled", request.terminalReuseEnabled)
			controller.terminalManager?.setTerminalReuseEnabled(!!request.terminalReuseEnabled)
		}

		if (request.vscodeTerminalExecutionMode !== undefined && request.vscodeTerminalExecutionMode !== "") {
			controller.stateManager.setGlobalState(
				"vscodeTerminalExecutionMode",
				request.vscodeTerminalExecutionMode === "backgroundExec" ? "backgroundExec" : "vscodeTerminal",
			)
		}

		// Update max consecutive mistakes
		if (request.maxConsecutiveMistakes !== undefined) {
			controller.stateManager.setGlobalState("maxConsecutiveMistakes", Number(request.maxConsecutiveMistakes))
		}

		if (request.hooksEnabled !== undefined) {
			const wasEnabled = controller.stateManager.getGlobalSettingsKey("hooksEnabled") ?? true
			const isEnabled = !!request.hooksEnabled
			controller.stateManager.setGlobalState("hooksEnabled", isEnabled)
			if (controller.task && wasEnabled !== isEnabled) {
				telemetryService.captureFeatureToggle(controller.task.ulid, "hooks", isEnabled, controller.task.api.getModel().id)
			}
		}
		// Update yolo mode setting
		if (request.yoloModeToggled !== undefined) {
			if (controller.task) {
				telemetryService.captureYoloModeToggle(controller.task.ulid, request.yoloModeToggled)
			}
			controller.stateManager.setGlobalState("yoloModeToggled", request.yoloModeToggled)
		}

		// Update worktrees setting
		if (request.worktreesEnabled !== undefined) {
			controller.stateManager.setGlobalState("worktreesEnabled", request.worktreesEnabled)
		}

		// Update subagents setting
		if (request.subagentsEnabled !== undefined) {
			const wasEnabled = controller.stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
			const isEnabled = !!request.subagentsEnabled
			controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)

			// Capture telemetry when setting changes
			if (wasEnabled !== isEnabled) {
				telemetryService.captureSubagentToggle(isEnabled)
			}
		}

		// Update auto-condense setting
		if (request.useAutoCondense !== undefined) {
			if (controller.task) {
				telemetryService.captureAutoCondenseToggle(
					controller.task.ulid,
					request.useAutoCondense,
					controller.task.api.getModel().id,
				)
			}
			controller.stateManager.setGlobalState("useAutoCondense", request.useAutoCondense)
		}

		if (request.compactionStrategy !== undefined) {
			const strategy = request.compactionStrategy === "basic" ? "basic" : "agentic"
			controller.stateManager.setGlobalState("compactionStrategy", strategy)
		}

		// Agentario: chat theme
		if (request.chatTheme !== undefined) {
			controller.stateManager.setGlobalState("chatTheme", request.chatTheme === "cursor" ? "cursor" : "default")
		}

		if (request.compactionProviderId !== undefined) {
			const trimmed = request.compactionProviderId.trim()
			controller.stateManager.setGlobalState("compactionProviderId", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionModelId !== undefined) {
			const trimmed = request.compactionModelId.trim()
			controller.stateManager.setGlobalState("compactionModelId", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionBaseUrl !== undefined) {
			const trimmed = request.compactionBaseUrl.trim()
			controller.stateManager.setGlobalState("compactionBaseUrl", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionApiKey !== undefined) {
			const trimmed = request.compactionApiKey.trim()
			controller.stateManager.setGlobalState("compactionApiKey", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionChunkSize !== undefined) {
			controller.stateManager.setGlobalState("compactionChunkSize", request.compactionChunkSize)
		}
		if (request.compactionDoubleSummarization !== undefined) {
			controller.stateManager.setGlobalState("compactionDoubleSummarization", request.compactionDoubleSummarization)
		}
		if (request.compactionReserveTokens !== undefined) {
			controller.stateManager.setGlobalState("compactionReserveTokens", request.compactionReserveTokens)
		}
		if (request.compactionPromptTemplateBefore !== undefined) {
			const trimmed = request.compactionPromptTemplateBefore.trim()
			controller.stateManager.setGlobalState("compactionPromptTemplateBefore", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionPromptTemplateAfter !== undefined) {
			const trimmed = request.compactionPromptTemplateAfter.trim()
			controller.stateManager.setGlobalState("compactionPromptTemplateAfter", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.compactionPostProcessTags !== undefined) {
			const trimmed = request.compactionPostProcessTags.trim()
			controller.stateManager.setGlobalState("compactionPostProcessTags", trimmed.length > 0 ? trimmed : undefined)
		}

		if (request.modelProfilePresetsJson !== undefined) {
			try {
				const parsed = JSON.parse(request.modelProfilePresetsJson) as {
					presets?: ModelProfilePreset[]
					activePresetId?: string
				}
				if (Array.isArray(parsed.presets)) {
					saveModelProfilePresets(controller, parsed.presets, parsed.activePresetId)
				}
			} catch (error) {
				Logger.warn("[updateSettings] Failed to parse model_profile_presets_json:", error)
			}
		}

		let presetApplied = false
		if (request.applyModelProfilePresetId !== undefined && request.applyModelProfilePresetId.trim().length > 0) {
			await applyModelProfilePreset(controller, request.applyModelProfilePresetId.trim())
			presetApplied = true
		}

		if (request.captureModelProfilePresetName !== undefined && request.captureModelProfilePresetName.trim().length > 0) {
			const preset = buildModelProfilePresetFromCurrentSettings(
				controller,
				randomUUID(),
				request.captureModelProfilePresetName.trim(),
			)
			const presets = [...readModelProfilePresets(controller), preset]
			saveModelProfilePresets(controller, presets, preset.id)
		}

		if (request.codebaseIndexMode !== undefined && request.codebaseIndexMode.trim()) {
			const mode = request.codebaseIndexMode.trim()
			if (mode === "local" || mode === "local-ai" || mode === "remote-ai") {
				controller.stateManager.setGlobalState("codebaseIndexMode", mode)
			}
		}
		if (request.codebaseIndexAiBackend !== undefined && request.codebaseIndexAiBackend.trim()) {
			const backend = request.codebaseIndexAiBackend.trim()
			if (backend === "lmstudio" || backend === "ollama") {
				controller.stateManager.setGlobalState("codebaseIndexAiBackend", backend)
			}
		}
		if (request.codebaseIndexBaseUrl !== undefined) {
			const trimmed = request.codebaseIndexBaseUrl.trim()
			controller.stateManager.setGlobalState("codebaseIndexBaseUrl", trimmed.length > 0 ? trimmed : undefined)
		}
		if (request.codebaseIndexEmbeddingModelId !== undefined) {
			const trimmed = request.codebaseIndexEmbeddingModelId.trim()
			controller.stateManager.setGlobalState("codebaseIndexEmbeddingModelId", trimmed.length > 0 ? trimmed : undefined)
		}

		// Update custom prompt choice
		if (request.customPrompt !== undefined) {
			const value = request.customPrompt === "compact" ? "compact" : undefined
			controller.stateManager.setGlobalState("customPrompt", value)
		}

		// Update browser settings
		if (request.browserSettings !== undefined) {
			// Get current browser settings to preserve fields not in the request
			const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

			// Convert from protobuf format to shared format, merging with existing settings
			const newBrowserSettings: SharedBrowserSettings = {
				...currentSettings, // Start with existing settings (and defaults)
				viewport: {
					// Apply updates from request
					width: request.browserSettings.viewport?.width || currentSettings.viewport.width,
					height: request.browserSettings.viewport?.height || currentSettings.viewport.height,
				},
				// Explicitly handle optional boolean and string fields from the request
				remoteBrowserEnabled:
					request.browserSettings.remoteBrowserEnabled === undefined
						? currentSettings.remoteBrowserEnabled
						: request.browserSettings.remoteBrowserEnabled,
				remoteBrowserHost:
					request.browserSettings.remoteBrowserHost === undefined
						? currentSettings.remoteBrowserHost
						: request.browserSettings.remoteBrowserHost,
				chromeExecutablePath:
					// If chromeExecutablePath is explicitly in the request (even as ""), use it.
					// Otherwise, fall back to mergedWithDefaults.
					"chromeExecutablePath" in request.browserSettings
						? request.browserSettings.chromeExecutablePath
						: currentSettings.chromeExecutablePath,
				disableToolUse:
					request.browserSettings.disableToolUse === undefined
						? currentSettings.disableToolUse
						: request.browserSettings.disableToolUse,
				customArgs:
					"customArgs" in request.browserSettings ? request.browserSettings.customArgs : currentSettings.customArgs,
			}

			// Update global state with new settings
			controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)
		}

		// Update default terminal profile
		if (request.defaultTerminalProfile !== undefined) {
			controller.stateManager.setGlobalState("defaultTerminalProfile", request.defaultTerminalProfile)
			// Update the live terminal manager so new terminals use the new profile.
			// Existing terminals are left open — they're keyed by effective shell
			// and reused when compatible, or skipped when not.
			controller.terminalManager?.setDefaultTerminalProfile(request.defaultTerminalProfile)
		}

		if (request.backgroundEditEnabled !== undefined) {
			controller.stateManager.setGlobalState("backgroundEditEnabled", !!request.backgroundEditEnabled)
		}

		if (request.multiRootEnabled !== undefined) {
			controller.stateManager.setGlobalState("multiRootEnabled", !!request.multiRootEnabled)
		}

		if (request.optOutOfRemoteConfig !== undefined) {
			const hadOptedOut = controller.stateManager.getGlobalSettingsKey("optOutOfRemoteConfig")
			const isOptingOut = !!request.optOutOfRemoteConfig
			const isReenablingRemoteConfig = !isOptingOut && hadOptedOut

			// Update now so any subsequent function can access the updated value
			controller.stateManager.setGlobalState("optOutOfRemoteConfig", isOptingOut)

			if (isOptingOut && !hadOptedOut) {
				clearRemoteConfig()
			} else if (isReenablingRemoteConfig) {
				// Fire-and-forget: We don't need to await here
				// The function catches any errors and posts the updated state to the webview
				// The immediate state update below shows the user's intent (opted-in),
				// and we apply the actual config afterwards without blocking the settings update
				fetchRemoteConfig(controller)
			}
		}

		if (request.showFeatureTips !== undefined) {
			controller.stateManager.setGlobalState("showFeatureTips", request.showFeatureTips)
		}

		// Agentario: Context Protection — Tier 1: Smart Chunked Navigation
		if (request.smartChunkingEnabled !== undefined) {
			controller.stateManager.setGlobalState("smartChunkingEnabled", request.smartChunkingEnabled)
		}
		if (request.showFileOutline !== undefined) {
			controller.stateManager.setGlobalState("showFileOutline", request.showFileOutline)
		}
		if (request.maxOutlineEntries !== undefined) {
			controller.stateManager.setGlobalState("maxOutlineEntries", request.maxOutlineEntries)
		}
		// Agentario: Context Protection — Tier 2: Tool Result Truncation
		if (request.smartTruncationEnabled !== undefined) {
			controller.stateManager.setGlobalState("smartTruncationEnabled", request.smartTruncationEnabled)
		}
		if (request.smartTruncationThreshold !== undefined) {
			controller.stateManager.setGlobalState("smartTruncationThreshold", request.smartTruncationThreshold)
		}
		if (request.smartTruncationHead !== undefined) {
			controller.stateManager.setGlobalState("smartTruncationHead", request.smartTruncationHead)
		}
		if (request.smartTruncationTail !== undefined) {
			controller.stateManager.setGlobalState("smartTruncationTail", request.smartTruncationTail)
		}
		// Agentario: Context Protection — Tier 3: AST Navigator
		if (request.astNavigatorEnabled !== undefined) {
			controller.stateManager.setGlobalState("astNavigatorEnabled", request.astNavigatorEnabled)
		}

		// Agentario: Lab API Server settings
		if (request.labApiEnabled !== undefined) {
			controller.stateManager.setGlobalState("labApiEnabled", request.labApiEnabled)
		}
		if (request.labApiPort !== undefined) {
			controller.stateManager.setGlobalState("labApiPort", request.labApiPort)
		}
		if (request.labClineDir !== undefined) {
			const trimmed = request.labClineDir.trim()
			controller.stateManager.setGlobalState("labClineDir", trimmed.length > 0 ? trimmed : "")
		}

		// Post updated state to webview — skip if preset was applied since
		// applyModelProfilePreset already called postStateToWebview directly.
		if (!presetApplied) {
			await controller.postStateToWebview()
		}

		return Empty.create()
	} catch (error) {
		Logger.error("Failed to update settings:", error)
		throw error
	}
}
