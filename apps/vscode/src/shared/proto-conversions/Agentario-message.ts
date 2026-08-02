import { AgentarioAsk as AppAgentarioAsk, AgentarioMessage as AppAgentarioMessage, AgentarioSay as AppAgentarioSay } from "@shared/ExtensionMessage"
import { AgentarioAsk, AgentarioMessageType, AgentarioSay, AgentarioMessage as ProtoAgentarioMessage } from "@shared/proto/agentario/ui"

// Helper function to convert AgentarioAsk string to enum
function convertAgentarioAskToProtoEnum(ask: AppAgentarioAsk | undefined): AgentarioAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppAgentarioAsk, AgentarioAsk> = {
		followup: AgentarioAsk.FOLLOWUP,
		plan_mode_respond: AgentarioAsk.PLAN_MODE_RESPOND,
		act_mode_respond: AgentarioAsk.ACT_MODE_RESPOND,
		command: AgentarioAsk.COMMAND,
		command_output: AgentarioAsk.COMMAND_OUTPUT,
		completion_result: AgentarioAsk.COMPLETION_RESULT,
		tool: AgentarioAsk.TOOL,
		api_req_failed: AgentarioAsk.API_REQ_FAILED,
		resume_task: AgentarioAsk.RESUME_TASK,
		resume_completed_task: AgentarioAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: AgentarioAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: AgentarioAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: AgentarioAsk.USE_MCP_SERVER,
		new_task: AgentarioAsk.NEW_TASK,
		condense: AgentarioAsk.CONDENSE,
		summarize_task: AgentarioAsk.SUMMARIZE_TASK,
		report_bug: AgentarioAsk.REPORT_BUG,
		use_subagents: AgentarioAsk.USE_SUBAGENTS,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert AgentarioAsk enum to string
function convertProtoEnumToAgentarioAsk(ask: AgentarioAsk): AppAgentarioAsk | undefined {
	if (ask === AgentarioAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<AgentarioAsk, AgentarioAsk.UNRECOGNIZED>, AppAgentarioAsk> = {
		[AgentarioAsk.FOLLOWUP]: "followup",
		[AgentarioAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[AgentarioAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[AgentarioAsk.COMMAND]: "command",
		[AgentarioAsk.COMMAND_OUTPUT]: "command_output",
		[AgentarioAsk.COMPLETION_RESULT]: "completion_result",
		[AgentarioAsk.TOOL]: "tool",
		[AgentarioAsk.API_REQ_FAILED]: "api_req_failed",
		[AgentarioAsk.RESUME_TASK]: "resume_task",
		[AgentarioAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[AgentarioAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[AgentarioAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[AgentarioAsk.USE_MCP_SERVER]: "use_mcp_server",
		[AgentarioAsk.NEW_TASK]: "new_task",
		[AgentarioAsk.CONDENSE]: "condense",
		[AgentarioAsk.SUMMARIZE_TASK]: "summarize_task",
		[AgentarioAsk.REPORT_BUG]: "report_bug",
		[AgentarioAsk.USE_SUBAGENTS]: "use_subagents",
	}

	return mapping[ask]
}

// Helper function to convert AgentarioSay string to enum
function convertAgentarioSayToProtoEnum(say: AppAgentarioSay | undefined): AgentarioSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppAgentarioSay, AgentarioSay> = {
		task: AgentarioSay.TASK,
		error: AgentarioSay.ERROR,
		api_req_started: AgentarioSay.API_REQ_STARTED,
		api_req_finished: AgentarioSay.API_REQ_FINISHED,
		text: AgentarioSay.TEXT,
		reasoning: AgentarioSay.REASONING,
		completion_result: AgentarioSay.COMPLETION_RESULT_SAY,
		user_feedback: AgentarioSay.USER_FEEDBACK,
		user_feedback_diff: AgentarioSay.USER_FEEDBACK_DIFF,
		api_req_retried: AgentarioSay.API_REQ_RETRIED,
		command: AgentarioSay.COMMAND_SAY,
		command_output: AgentarioSay.COMMAND_OUTPUT_SAY,
		tool: AgentarioSay.TOOL_SAY,
		shell_integration_warning: AgentarioSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: AgentarioSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: AgentarioSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: AgentarioSay.BROWSER_ACTION,
		browser_action_result: AgentarioSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: AgentarioSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: AgentarioSay.MCP_SERVER_RESPONSE,
		mcp_notification: AgentarioSay.MCP_NOTIFICATION,
		use_mcp_server: AgentarioSay.USE_MCP_SERVER_SAY,
		diff_error: AgentarioSay.DIFF_ERROR,
		deleted_api_reqs: AgentarioSay.DELETED_API_REQS,
		clineignore_error: AgentarioSay.CLINEIGNORE_ERROR,
		command_permission_denied: AgentarioSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: AgentarioSay.CHECKPOINT_CREATED,
		load_mcp_documentation: AgentarioSay.LOAD_MCP_DOCUMENTATION,
		info: AgentarioSay.INFO,
		task_progress: AgentarioSay.TASK_PROGRESS,
		error_retry: AgentarioSay.ERROR_RETRY,
		hook_status: AgentarioSay.HOOK_STATUS,
		hook_output_stream: AgentarioSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: AgentarioSay.CONDITIONAL_RULES_APPLIED,
		subagent: AgentarioSay.SUBAGENT_STATUS,
		use_subagents: AgentarioSay.USE_SUBAGENTS_SAY,
		subagent_usage: AgentarioSay.SUBAGENT_USAGE,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert AgentarioSay enum to string
function convertProtoEnumToAgentarioSay(say: AgentarioSay): AppAgentarioSay | undefined {
	if (say === AgentarioSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<AgentarioSay, AgentarioSay.UNRECOGNIZED>, AppAgentarioSay> = {
		[AgentarioSay.TASK]: "task",
		[AgentarioSay.ERROR]: "error",
		[AgentarioSay.API_REQ_STARTED]: "api_req_started",
		[AgentarioSay.API_REQ_FINISHED]: "api_req_finished",
		[AgentarioSay.TEXT]: "text",
		[AgentarioSay.REASONING]: "reasoning",
		[AgentarioSay.COMPLETION_RESULT_SAY]: "completion_result",
		[AgentarioSay.USER_FEEDBACK]: "user_feedback",
		[AgentarioSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[AgentarioSay.API_REQ_RETRIED]: "api_req_retried",
		[AgentarioSay.COMMAND_SAY]: "command",
		[AgentarioSay.COMMAND_OUTPUT_SAY]: "command_output",
		[AgentarioSay.TOOL_SAY]: "tool",
		[AgentarioSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[AgentarioSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[AgentarioSay.BROWSER_ACTION]: "browser_action",
		[AgentarioSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[AgentarioSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[AgentarioSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[AgentarioSay.MCP_NOTIFICATION]: "mcp_notification",
		[AgentarioSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[AgentarioSay.DIFF_ERROR]: "diff_error",
		[AgentarioSay.DELETED_API_REQS]: "deleted_api_reqs",
		[AgentarioSay.CLINEIGNORE_ERROR]: "clineignore_error",
		[AgentarioSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[AgentarioSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[AgentarioSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[AgentarioSay.INFO]: "info",
		[AgentarioSay.TASK_PROGRESS]: "task_progress",
		[AgentarioSay.ERROR_RETRY]: "error_retry",
		[AgentarioSay.HOOK_STATUS]: "hook_status",
		[AgentarioSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[AgentarioSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[AgentarioSay.SUBAGENT_STATUS]: "subagent",
		[AgentarioSay.USE_SUBAGENTS_SAY]: "use_subagents",
		[AgentarioSay.SUBAGENT_USAGE]: "subagent_usage",
	}

	return mapping[say]
}

/**
 * Convert application AgentarioMessage to proto AgentarioMessage
 */
export function convertAgentarioMessageToProto(message: AppAgentarioMessage): ProtoAgentarioMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertAgentarioAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertAgentarioSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: AgentarioAsk = AgentarioAsk.FOLLOWUP // Proto default
	let finalSayEnum: AgentarioSay = AgentarioSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? AgentarioAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? AgentarioSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoAgentarioMessage = {
		ts: message.ts,
		type: message.type === "ask" ? AgentarioMessageType.ASK : AgentarioMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		// Convergent-replica fields (default 0 = unstamped, e.g. classic/legacy path).
		seq: message.seq ?? 0,
		epoch: message.epoch ?? 0,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		modelInfo: message.modelInfo ?? undefined,
	}

	return protoMessage
}

/**
 * Convert proto AgentarioMessage to application AgentarioMessage
 */
export function convertProtoToAgentarioMessage(protoMessage: ProtoAgentarioMessage): AppAgentarioMessage {
	const message: AppAgentarioMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === AgentarioMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === AgentarioMessageType.ASK) {
		const ask = convertProtoEnumToAgentarioAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === AgentarioMessageType.SAY) {
		const say = convertProtoEnumToAgentarioSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	// Convergent-replica fields. 0 means unstamped (classic/legacy path) — leave undefined so
	// the webview reducer treats such messages as always-applicable rather than epoch 0.
	if (protoMessage.seq && protoMessage.seq !== 0) {
		message.seq = protoMessage.seq
	}
	if (protoMessage.epoch && protoMessage.epoch !== 0) {
		message.epoch = protoMessage.epoch
	}

	return message
}
