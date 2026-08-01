// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { WorkspaceRoot } from "@shared/multi-root/types"
import { RemoteConfigFields } from "@shared/storage/state-keys"
import type { Environment } from "../config"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { AgentarioFeatureSetting } from "./AgentarioFeatureSetting"
import { BannerCardData } from "./agentario/banner"
import { AgentarioRulesToggles } from "./agentario-rules"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { AgentarioMessageModelInfo } from "./messages"
import { OnboardingModelGroup } from "./proto/agentario/state"
import { Mode } from "./storage/types"
import { TelemetrySetting } from "./TelemetrySetting"
import { UserInfo } from "./UserInfo"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" | "lab_api_response"
	grpc_response?: GrpcResponse
	lab_api_response?: LabApiResponse
}

export type LabApiResponse = {
	request_id: string
	data?: any
	error?: string
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__agentario_command_cancel__"
export interface ExtensionState {
	isNewUser: boolean
	welcomeViewCompleted: boolean
	onboardingModels: OnboardingModelGroup | undefined
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	mode: Mode
	agentarioMessages: AgentarioMessage[]
	checkpointRestoreInput?: {
		text: string
		images?: string[]
		files?: string[]
		sessionId: string
	}
	/**
	 * The single authoritative UI mode for the current turn, owned by the extension. The webview
	 * renders the footer/buttons/thinking indicator from this, NOT from the tail of agentarioMessages.
	 * Optional for classic/legacy (absent => webview falls back to legacy tail heuristics).
	 */
	turnState?: TurnState
	/**
	 * Follow-up prompts submitted while the active agent turn is still running.
	 * These are owned by the SDK pending-prompt queue and are sent after the
	 * current turn reaches a safe continuation point.
	 */
	queuedPrompts?: QueuedPrompt[]
	/**
	 * Monotonic version of this state snapshot. The webview applies a snapshot only if its
	 * stateVersion is newer than the last applied, so stale/out-of-order state pushes are
	 * ignored. Stamped by the extension. Optional for classic/legacy.
	 */
	stateVersion?: number
	/**
	 * Conversation/replica fence for this snapshot (see AgentarioMessage.epoch). A snapshot with a
	 * newer epoch replaces the webview transcript; an older one is dropped; an equal one merges.
	 * Optional for classic/legacy.
	 */
	epoch?: number
	currentTaskItem?: HistoryItem
	mcpMarketplaceEnabled?: boolean
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	shouldShowAnnouncement: boolean
	taskHistory: HistoryItem[]
	telemetrySetting: TelemetrySetting
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	maxConsecutiveMistakes: number
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	lastCompletedCommandTs?: number
	userInfo?: UserInfo
	version: string
	distinctId: string
	globalAgentarioRulesToggles: AgentarioRulesToggles
	localAgentarioRulesToggles: AgentarioRulesToggles
	localWorkflowToggles: AgentarioRulesToggles
	globalWorkflowToggles: AgentarioRulesToggles
	localCursorRulesToggles: AgentarioRulesToggles
	localWindsurfRulesToggles: AgentarioRulesToggles
	remoteRulesToggles?: AgentarioRulesToggles
	remoteWorkflowToggles?: AgentarioRulesToggles
	localAgentsRulesToggles: AgentarioRulesToggles
	mcpResponsesCollapsed?: boolean
	yoloModeToggled?: boolean
	useAutoCondense?: boolean
	compactionStrategy?: "basic" | "agentic"
	compactionProviderId?: string
	compactionModelId?: string
	compactionBaseUrl?: string
	compactionApiKey?: string
	compactionChunkSize?: number
	compactionDoubleSummarization?: boolean
	/** Agentario: reserve tokens for model output РІР‚вЂќ auto-condense trigger threshold */
	compactionReserveTokens?: number
	/** Agentario: max input tokens override for compaction trigger (0 = auto-detect) */
	compactionMaxInputTokens?: number
	compactionPromptTemplateBefore?: string
	compactionPromptTemplateAfter?: string
	/** Agentario: post-processing tag mappings (JSON) */
	compactionPostProcessTags?: string
	modelProfilePresets?: import("./model-profile-presets").ModelProfilePreset[]
	activeModelProfilePresetId?: string
	codebaseIndexMode?: "local" | "local-ai" | "remote-ai"
	codebaseIndexAiBackend?: "lmstudio" | "ollama"
	codebaseIndexBaseUrl?: string
	codebaseIndexEmbeddingModelId?: string
	subagentsEnabled?: boolean
	worktreesEnabled?: AgentarioFeatureSetting
	customPrompt?: string
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: AgentarioFeatureSetting
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>
	hooksEnabled?: boolean
	remoteConfigSettings?: Partial<RemoteConfigFields>
	globalSkillsToggles?: Record<string, boolean>
	localSkillsToggles?: Record<string, boolean>
	backgroundEditEnabled?: boolean
	optOutOfRemoteConfig?: boolean
	showFeatureTips?: boolean
	banners?: BannerCardData[]
	welcomeBanners?: BannerCardData[]
	openAiCodexIsAuthenticated?: boolean
	/** Agentario: chat UI theme - "default" or "cursor" (compact Cursor-style) */
	chatTheme?: "default" | "cursor"
	// Agentario: Context Protection РІР‚вЂќ Smart Chunked Navigation (Tier 1)
	smartChunkingEnabled?: boolean
	showFileOutline?: boolean
	maxOutlineEntries?: number
	// Agentario: Context Protection РІР‚вЂќ Tool Result Truncation (Tier 2)
	smartTruncationEnabled?: boolean
	smartTruncationThreshold?: number
	smartTruncationHead?: number
	smartTruncationTail?: number
	// Agentario: Context Protection РІР‚вЂќ AST Navigator (Tier 3)
	astNavigatorEnabled?: boolean
	// Agentario: Lab API Server settings
	labApiEnabled?: boolean
	labApiPort?: number
	labClineDir?: string
}

/**
 * The authoritative UI mode for the current agent turn, owned by the extension. The webview reads
 * this instead of inferring mode from the tail of agentarioMessages.
 */
export type TurnPhase =
	| "idle" // no active turn; input enabled, no buttons
	| "streaming" // model producing content / tool running; Thinking + Cancel
	| "awaiting_approval" // a tool/command/mcp/subagent approval is pending
	| "awaiting_followup" // ask_question / plan_mode_respond / done-without-completion
	| "completed" // attempt_completion done; Start New Task
	| "error" // api_req_failed / fatal; Retry / recovery
	| "resumable" // task cancelled / interrupted; Resume Task

export interface TurnState {
	phase: TurnPhase
	/** ts of the AgentarioMessage this phase is "about" (e.g. the pending approval/ask). */
	anchorTs?: number
	/** Monotonic; the webview keeps the highest-seq TurnState and ignores older ones. */
	seq: number
}

export interface QueuedPrompt {
	id: string
	prompt: string
	delivery: "queue" | "steer"
	attachmentCount: number
}

export interface AgentarioMessage {
	ts: number
	type: "ask" | "say"
	ask?: AgentarioAsk
	say?: AgentarioSay
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	/**
	 * Freshness counter for convergent-replica merging on the webview side. Monotonically
	 * increasing per process; a higher `seq` means a newer copy of the SAME `ts` (identity).
	 * Stamped by the extension as the message flows to the webview. Optional for classic/legacy.
	 */
	seq?: number
	/**
	 * Conversation/replica fence. Messages from an older epoch (a previous task or a previous
	 * render of the same task) are dropped by the webview. Stamped by the extension. Optional
	 * for classic/legacy.
	 */
	epoch?: number
	commandCompleted?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
	modelInfo?: AgentarioMessageModelInfo
	/** Wall-clock time when the message was created (ms since epoch). */
	createdAtMs?: number
}

export type AgentarioAsk =
	| "followup"
	| "plan_mode_respond"
	| "act_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"
	| "use_subagents"

export type AgentarioSay =
	| "task"
	| "error"
	| "error_retry"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "clineignore_error"
	| "command_permission_denied"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "info" // Added for general informational messages like retry status
	| "task_progress"
	| "hook_status"
	| "hook_output_stream"
	| "subagent"
	| "use_subagents"
	| "subagent_usage"
	| "conditional_rules_applied"

export interface AgentarioSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "fileDeleted"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "webFetch"
		| "webSearch"
		| "summarizeTask"
		| "useSkill"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	/** Starting line numbers in the original file where each SEARCH block matched */
	startLineNumbers?: number[]
	/** Inclusive line range actually returned by read_file (for UI summaries). */
	readLineStart?: number
	readLineEnd?: number
}

// must keep in sync with system prompt
const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface AgentarioSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export type SubagentExecutionStatus = "pending" | "running" | "completed" | "failed"

export interface SubagentStatusItem {
	index: number
	prompt: string
	status: SubagentExecutionStatus
	toolCalls: number
	inputTokens: number
	outputTokens: number
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
	latestToolCall?: string
	result?: string
	error?: string
}

export interface AgentarioSaySubagentStatus {
	status: "running" | "completed" | "failed"
	total: number
	completed: number
	successes: number
	failures: number
	toolCalls: number
	inputTokens: number
	outputTokens: number
	contextWindow: number
	maxContextTokens: number
	maxContextUsagePercentage: number
	items: SubagentStatusItem[]
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface AgentarioAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
}

export interface AgentarioAskUseSubagents {
	prompts: string[]
}

export interface AgentarioPlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface AgentarioAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface AgentarioApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: AgentarioApiReqCancelReason
	streamingFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec: number
		errorSnippet?: string
	}
	/** Elapsed time for the full API request (ms), including prompt/prefill. */
	durationMs?: number
	/** Elapsed time for output generation only (ms), excluding prompt/prefill. */
	generationDurationMs?: number
	/** Output tokens per second during generation (matches LM Studio eval speed). */
	tokensPerSecond?: number
	/** Estimated context budget breakdown (system / rules / tools / chat). */
	contextBudget?: import("@agentario/shared").ContextBudgetBreakdown
}

export interface ClineSubagentUsageInfo {
	source: "subagents"
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost: number
}

type AgentarioApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
