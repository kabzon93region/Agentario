import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type { AgentarioMessage, AgentarioSayTool, AgentarioApiReqInfo } from "@shared/ExtensionMessage"
import { formatMessageStatsLine } from "@shared/message-display"

const LOW_STAKES_TOOLS = new Set([
	"readFile",
	"listFilesTopLevel",
	"listFilesRecursive",
	"listCodeDefinitionNames",
	"searchFiles",
])

const SKIP_SAY = new Set([
	"api_req_started",
	"api_req_finished",
	"api_req_retried",
	"mcp_server_request_started",
	"shell_integration_warning",
	"shell_integration_warning_with_suggestion",
	"load_mcp_documentation",
	"checkpoint_created",
	"hook",
])

function isLowStakesTool(message: AgentarioMessage): boolean {
	if (message.say !== "tool" && message.ask !== "tool") {
		return false
	}
	try {
		const tool = JSON.parse(message.text || "{}") as AgentarioSayTool
		return LOW_STAKES_TOOLS.has(tool.tool)
	} catch {
		return false
	}
}

function parseTool(text: string | undefined): AgentarioSayTool {
	try {
		return JSON.parse(text || "{}") as AgentarioSayTool
	} catch {
		return {} as AgentarioSayTool
	}
}

/**
 * Build a map from message index to stats line for all api_req_started messages.
 * Returns a Map<messageIndex, statsLine>.
 */
function buildStatsMap(messages: AgentarioMessage[]): Map<number, string> {
	const statsMap = new Map<number, string>()
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text) as AgentarioApiReqInfo
				const line = formatMessageStatsLine(info)
				if (line) {
					statsMap.set(i, line)
				}
			} catch {}
		}
	}
	return statsMap
}

/**
 * Find the stats line for a given message index by searching backward
 * for the nearest api_req_started with stats. This correctly associates
 * stats with the API call that produced the message.
 */
function findStatsForMessage(statsMap: Map<number, string>, messageIndex: number): string | undefined {
	const indices = Array.from(statsMap.keys()).sort((a, b) => b - a)
	for (const idx of indices) {
		if (idx < messageIndex) {
			return statsMap.get(idx)
		}
	}
	return undefined
}

function formatTs(ts: number | undefined): string {
	// AgentarioMessage.ts is often a MessageIdMinter counter, not wall-clock ms.
	if (!ts || !Number.isFinite(ts) || ts < 1_000_000_000_000) {
		return ""
	}
	try {
		return new Date(ts).toLocaleString("ru-RU")
	} catch {
		return ""
	}
}

function appendBlock(lines: string[], heading: string, body: string, ts?: number): void {
	const when = formatTs(ts)
	lines.push(when ? `${heading} (${when}):` : `${heading}:`)
	if (body.trim()) {
		lines.push(body.trimEnd())
	}
	lines.push("")
	lines.push("=======================")
	lines.push("")
}

function formatCommandBlock(message: AgentarioMessage): string {
	const raw = message.text ?? ""
	const [commandPart, ...outputParts] = raw.split(COMMAND_OUTPUT_STRING)
	const command = commandPart.trim()
	const output = outputParts.join(COMMAND_OUTPUT_STRING).trim()
	const status = message.commandCompleted ? "Completed" : "Running"
	const lines = [`Agentario wants to execute this command:`, "", status, ""]
	if (command) {
		lines.push("```shell", command, "```", "")
	}
	if (output) {
		lines.push("```shell", output, "```")
	}
	return lines.join("\n").trimEnd()
}

function formatToolLine(message: AgentarioMessage): string {
	const tool = parseTool(message.text)
	if (!tool.tool) {
		return message.text ?? ""
	}
	const label = message.type === "ask" ? "Agentario wants to use tool" : "Agentario used tool"
	const parts = [label, tool.tool]
	if (tool.path) {
		parts.push(tool.path)
	}
	if (tool.regex) {
		parts.push(tool.regex)
	}
	if (tool.content?.trim()) {
		parts.push("", tool.content.trim())
	}
	return parts.join("\n")
}

export interface ExportChatMarkdownOptions {
	title?: string
	exportedAt?: Date
}

/**
 * Export chat in chronological message order (by `ts`).
 * Low-stakes tools are listed individually so nothing “jumps” to the end.
 */
export function exportChatToMarkdown(messages: AgentarioMessage[], options: ExportChatMarkdownOptions = {}): string {
	const lines: string[] = []
	const exportedAt = options.exportedAt ?? new Date()

	if (options.title?.trim()) {
		lines.push(`# ${options.title.trim()}`, "")
	}
	lines.push(`Exported: ${exportedAt.toLocaleString("ru-RU")}`, "", "---", "")

	// Agentario: pin task message(s) to the beginning, then sort rest by ts.
	// Task messages use Date.now() while SDK messages use minter.nextId() (1,2,3...),
	// so naive ts-sort puts task at the end.
	const taskMessages = messages.filter(m => m.say === "task")
	const otherMessages = messages.filter(m => m.say !== "task")
	const ordered = [
		...taskMessages.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)),
		...otherMessages.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)),
	]

	// Build stats map for all api_req_started messages
	const statsMap = buildStatsMap(ordered)

	for (let msgIdx = 0; msgIdx < ordered.length; msgIdx++) {
		const message = ordered[msgIdx]
		if (message.partial) {
			continue
		}

		if (message.type === "say" && message.say && SKIP_SAY.has(message.say)) {
			continue
		}

		if (message.type === "say" && message.say === "info") {
			const text = (message.text ?? "").trim()
			if (text) {
				appendBlock(lines, "System", text, message.ts)
			}
			continue
		}

		if (message.type === "say" && (message.say === "user_feedback" || message.say === "task")) {
			appendBlock(lines, "User", message.text ?? "", message.ts)
			continue
		}

		if (message.type === "say" && message.say === "reasoning") {
			if (message.text?.trim()) {
				appendBlock(lines, "Thinking", message.text, message.ts)
				// Append stats after Thinking block
				const stats = findStatsForMessage(statsMap, msgIdx)
				if (stats) {
					lines.push(`  ${stats}`, "")
				}
			}
			continue
		}

		if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
			appendBlock(lines, "Agent", message.text ?? "", message.ts)
			// Append stats after Agent text/completion block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}

		if (message.type === "say" && message.say === "command") {
			appendBlock(lines, "Agent", formatCommandBlock(message), message.ts)
			// Append stats after command block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}

		if (message.type === "say" && message.say === "tool") {
			if (parseTool(message.text).tool === "attempt_completion") {
				continue
			}
			appendBlock(lines, "Tool", formatToolLine(message), message.ts)
			// Append stats after tool block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}

		if (message.type === "ask" && message.ask === "tool") {
			if (parseTool(message.text).tool === "attempt_completion") {
				continue
			}
			appendBlock(lines, "Tool", formatToolLine(message), message.ts)
			// Append stats after tool block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
		}
	}

	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop()
	}

	return `${lines.join("\n")}\n`
}

/** Stats footer for export (optional extension). */
export function exportStatsFooter(info: Parameters<typeof formatMessageStatsLine>[0]): string | undefined {
	return formatMessageStatsLine(info)
}

// Keep helper exported for tests that may still reference grouping.
export function __testOnly_isLowStakesTool(message: AgentarioMessage): boolean {
	return isLowStakesTool(message)
}
