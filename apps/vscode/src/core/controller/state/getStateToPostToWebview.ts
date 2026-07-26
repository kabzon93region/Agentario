// Extracted from classic src/core/controller/index.ts (see origin/main)
//
// Standalone function to build ExtensionState from a Controller instance.
// This allows the SdkController to reuse the classic state-building logic
// without inheriting the entire classic Controller implementation.

import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import type { ExtensionState, Platform } from "@shared/ExtensionMessage"
import { ClineEnv } from "@/config"
import { ExtensionRegistryInfo } from "@/registry"
import { BannerService } from "@/services/banner/BannerService"
import { featureFlagsService } from "@/services/feature-flags"
import { getDistinctId } from "@/services/logging/distinctId"
import { getLatestAnnouncementId } from "@/utils/announcements"
import type { StateManager } from "@/core/storage/StateManager"
import { getAgentarioOnboardingModels } from "../models/getAgentarioOnboardingModels"

/**
 * Minimal controller surface needed to build ExtensionState for the webview.
 */
export type StatePostController = {
	task?: {
		taskId?: string
		messageStateHandler?: {
			getagentarioMessages?: () => unknown[]
			getClineMessages?: () => unknown[]
		}
		api?: {
			getModel?: () => { id?: string; info?: { contextWindow?: number } }
		}
	}
	stateManager: StateManager
	mcpHub?: { getServers?: () => unknown[] }
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	workspaceManager?: {
		getRoots?: () => unknown[]
		getPrimaryIndex?: () => number
	}
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]
}

/**
 * Builds the ExtensionState object to push to the webview.
 */
export async function getStateToPostToWebview(controller: StatePostController): Promise<ExtensionState> {
	const stateManager = controller.stateManager

	// Get API configuration from cache for immediate access
	const onboardingModels = getAgentarioOnboardingModels()
	const apiConfiguration = stateManager.getApiConfiguration()
	const lastShownAnnouncementId = stateManager.getGlobalStateKey("lastShownAnnouncementId")
	const taskHistory = stateManager.getGlobalStateKey("taskHistory")
	const autoApprovalSettings = stateManager.getGlobalSettingsKey("autoApprovalSettings")
	const browserSettings = stateManager.getGlobalSettingsKey("browserSettings")
	const preferredLanguage = stateManager.getGlobalSettingsKey("preferredLanguage")
	const mode = stateManager.getGlobalSettingsKey("mode")
	const yoloModeToggled = stateManager.getGlobalSettingsKey("yoloModeToggled")
	const useAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense")
	const compactionStrategy = stateManager.getGlobalSettingsKey("compactionStrategy")
	const compactionSummarizerProviderId = stateManager.getGlobalSettingsKey("compactionProviderId")
	const compactionSummarizerModelId = stateManager.getGlobalSettingsKey("compactionModelId")
	const compactionBaseUrl = stateManager.getGlobalSettingsKey("compactionBaseUrl")
	const compactionApiKey = stateManager.getGlobalSettingsKey("compactionApiKey")
	const compactionChunkSize = stateManager.getGlobalSettingsKey("compactionChunkSize")
	const compactionDoubleSummarization = stateManager.getGlobalSettingsKey("compactionDoubleSummarization")
	const compactionPromptTemplateBefore = stateManager.getGlobalSettingsKey("compactionPromptTemplateBefore")
	const compactionPromptTemplateAfter = stateManager.getGlobalSettingsKey("compactionPromptTemplateAfter")
	const compactionPostProcessTags = stateManager.getGlobalSettingsKey("compactionPostProcessTags")
	const chatTheme = stateManager.getGlobalSettingsKey("chatTheme")
	const modelProfilePresets = stateManager.getGlobalSettingsKey("modelProfilePresets") ?? []
	const activeModelProfilePresetId = stateManager.getGlobalSettingsKey("activeModelProfilePresetId")
	const codebaseIndexMode = stateManager.getGlobalSettingsKey("codebaseIndexMode") ?? "local"
	const codebaseIndexAiBackend = stateManager.getGlobalSettingsKey("codebaseIndexAiBackend") ?? "lmstudio"
	const codebaseIndexBaseUrl = stateManager.getGlobalSettingsKey("codebaseIndexBaseUrl")
	const codebaseIndexEmbeddingModelId = stateManager.getGlobalSettingsKey("codebaseIndexEmbeddingModelId")
	const subagentsEnabled = stateManager.getGlobalSettingsKey("subagentsEnabled")
	const userInfo = stateManager.getGlobalStateKey("userInfo")
	const mcpMarketplaceEnabled = stateManager.getGlobalStateKey("mcpMarketplaceEnabled")
	const mcpDisplayMode = stateManager.getGlobalStateKey("mcpDisplayMode")
	const telemetrySetting = stateManager.getGlobalSettingsKey("telemetrySetting")
	const planActSeparateModelsSetting = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
	const enableCheckpointsSetting = stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
	const globalAgentarioRulesToggles = stateManager.getGlobalSettingsKey("globalAgentarioRulesToggles")
	const globalWorkflowToggles = stateManager.getGlobalSettingsKey("globalWorkflowToggles")
	const globalSkillsToggles = stateManager.getGlobalSettingsKey("globalSkillsToggles")
	const localSkillsToggles = stateManager.getWorkspaceStateKey("localSkillsToggles")
	const remoteRulesToggles = stateManager.getGlobalStateKey("remoteRulesToggles")
	const remoteWorkflowToggles = stateManager.getGlobalStateKey("remoteWorkflowToggles")
	const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
	const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
	const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
	const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")
	const isNewUser = stateManager.getGlobalStateKey("isNewUser")
	const welcomeViewCompleted = !!stateManager.getGlobalStateKey("welcomeViewCompleted")

	const customPrompt = stateManager.getGlobalSettingsKey("customPrompt")
	const mcpResponsesCollapsed = stateManager.getGlobalStateKey("mcpResponsesCollapsed")
	const maxConsecutiveMistakes = stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
	const favoritedModelIds = stateManager.getGlobalStateKey("favoritedModelIds")
	const lastDismissedInfoBannerVersion = stateManager.getGlobalStateKey("lastDismissedInfoBannerVersion") || 0
	const lastDismissedModelBannerVersion = stateManager.getGlobalStateKey("lastDismissedModelBannerVersion") || 0
	const lastDismissedCliBannerVersion = stateManager.getGlobalStateKey("lastDismissedCliBannerVersion") || 0
	const dismissedBanners = stateManager.getGlobalStateKey("dismissedBanners")
	const showFeatureTips = stateManager.getGlobalSettingsKey("showFeatureTips")

	// Agentario: Context Protection — Tier 1/2/3
	const smartChunkingEnabled = stateManager.getGlobalSettingsKey("smartChunkingEnabled")
	const showFileOutline = stateManager.getGlobalSettingsKey("showFileOutline")
	const maxOutlineEntries = stateManager.getGlobalSettingsKey("maxOutlineEntries")
	const smartTruncationEnabled = stateManager.getGlobalSettingsKey("smartTruncationEnabled")
	const smartTruncationThreshold = stateManager.getGlobalSettingsKey("smartTruncationThreshold")
	const smartTruncationHead = stateManager.getGlobalSettingsKey("smartTruncationHead")
	const smartTruncationTail = stateManager.getGlobalSettingsKey("smartTruncationTail")
	const astNavigatorEnabled = stateManager.getGlobalSettingsKey("astNavigatorEnabled")

	const localAgentarioRulesToggles = stateManager.getWorkspaceStateKey("localAgentarioRulesToggles")
	const localWindsurfRulesToggles = stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
	const localCursorRulesToggles = stateManager.getWorkspaceStateKey("localCursorRulesToggles")
	const localAgentsRulesToggles = stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
	const workflowToggles = stateManager.getWorkspaceStateKey("workflowToggles")

	const currentTaskItem = controller.task?.taskId
		? (taskHistory || []).find((item: { id?: string; ts?: number; [key: string]: unknown }) => item.id === controller.task?.taskId)
		: undefined
	const agentarioMessages = [...(controller.task?.messageStateHandler?.getagentarioMessages?.() || [])]
	const checkpointRestoreInput = controller.checkpointRestoreInput

	const processedTaskHistory = (taskHistory || [])
		.filter((item: { id?: string; ts?: number; [key: string]: unknown }) => item.ts && item.task)
		.sort((a: any, b: any) => b.ts - a.ts)
		.slice(0, 100)

	const latestAnnouncementId = getLatestAnnouncementId()
	const shouldShowAnnouncement = lastShownAnnouncementId !== latestAnnouncementId
	const platform = process.platform as Platform
	const distinctId = getDistinctId()
	const version = ExtensionRegistryInfo.version
	const clineConfig = ClineEnv.config()
	const environment = clineConfig.environment
	const banners = BannerService.get().getActiveBanners() ?? []
	const welcomeBanners = BannerService.get().getWelcomeBanners() ?? []

	// Check OpenAI Codex authentication status
	let openAiCodexIsAuthenticated = false
	try {
		const { openAiCodexOAuthManager } = await import("@/integrations/openai-codex/oauth")
		openAiCodexIsAuthenticated = await openAiCodexOAuthManager.isAuthenticated()
	} catch {
		// Codex OAuth not available
	}

	return {
		version,
		apiConfiguration,
		currentTaskItem,
		agentarioMessages,
		checkpointRestoreInput,
		autoApprovalSettings,
		browserSettings,
		preferredLanguage,
		mode,
		yoloModeToggled,
		useAutoCondense,
		compactionStrategy,
		compactionProviderId: compactionSummarizerProviderId,
		compactionModelId: compactionSummarizerModelId,
		compactionBaseUrl,
		compactionApiKey,
		compactionChunkSize,
		compactionDoubleSummarization,
		compactionReserveTokens: stateManager.getGlobalSettingsKey("compactionReserveTokens"),
		compactionPromptTemplateBefore,
		compactionPromptTemplateAfter,
		compactionPostProcessTags,
		chatTheme,
		modelProfilePresets,
		activeModelProfilePresetId,
		codebaseIndexMode,
		codebaseIndexAiBackend,
		codebaseIndexBaseUrl,
		codebaseIndexEmbeddingModelId,
		subagentsEnabled,
		userInfo,
		mcpMarketplaceEnabled,
		mcpDisplayMode,
		telemetrySetting,
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSetting ?? true,
		platform,
		environment,
		distinctId,
		globalAgentarioRulesToggles: globalAgentarioRulesToggles || {},
		localAgentarioRulesToggles: localAgentarioRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localAgentsRulesToggles: localAgentsRulesToggles || {},
		localWorkflowToggles: workflowToggles || {},
		globalWorkflowToggles: globalWorkflowToggles || {},
		globalSkillsToggles: globalSkillsToggles || {},
		localSkillsToggles: localSkillsToggles || {},
		remoteRulesToggles,
		remoteWorkflowToggles,
		shellIntegrationTimeout,
		terminalReuseEnabled,
		vscodeTerminalExecutionMode,
		defaultTerminalProfile,
		isNewUser,
		welcomeViewCompleted,
		onboardingModels,
		mcpResponsesCollapsed,
		maxConsecutiveMistakes,
		customPrompt,
		taskHistory: processedTaskHistory,
		shouldShowAnnouncement,
		favoritedModelIds,
		backgroundCommandRunning: controller.backgroundCommandRunning ?? false,
		backgroundCommandTaskId: controller.backgroundCommandTaskId,
		workspaceRoots: controller.workspaceManager?.getRoots?.() ?? [],
		primaryRootIndex: controller.workspaceManager?.getPrimaryIndex?.() ?? 0,
		isMultiRootWorkspace: (controller.workspaceManager?.getRoots?.()?.length ?? 0) > 1,
		multiRootSetting: {
			user: stateManager.getGlobalStateKey("multiRootEnabled"),
			featureFlag: true,
		},
		worktreesEnabled: {
			user: stateManager.getGlobalSettingsKey("worktreesEnabled"),
			featureFlag: featureFlagsService.getWorktreesEnabled(),
		},
		hooksEnabled: getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled")),
		lastDismissedInfoBannerVersion,
		lastDismissedModelBannerVersion,
		remoteConfigSettings: stateManager.getRemoteConfigSettings?.(),
		lastDismissedCliBannerVersion,
		dismissedBanners,
		backgroundEditEnabled: stateManager.getGlobalSettingsKey("backgroundEditEnabled"),
		optOutOfRemoteConfig: stateManager.getGlobalSettingsKey("optOutOfRemoteConfig"),
		showFeatureTips,
		smartChunkingEnabled,
		showFileOutline,
		maxOutlineEntries,
		smartTruncationEnabled,
		smartTruncationThreshold,
		smartTruncationHead,
		smartTruncationTail,
		astNavigatorEnabled,
		banners,
		welcomeBanners,
		openAiCodexIsAuthenticated,
	} as ExtensionState
}
