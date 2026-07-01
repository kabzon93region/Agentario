import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
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
	"info",
	"checkpoint_created",
	"hook",
])

function isLowStakesTool(message: ClineMessage): boolean {
	if (message.say !== "tool" && message.ask !== "tool") {
		return false
	}
	try {
		const tool = JSON.parse(message.text || "{}") as ClineSayTool
		return LOW_STAKES_TOOLS.has(tool.tool)
	} catch {
		return false
	}
}

function parseTool(text: string | undefined): ClineSayTool {
	try {
		return JSON.parse(text || "{}") as ClineSayTool
	} catch {
		return {} as ClineSayTool
	}
}

function toolGroupSummary(tools: ClineSayTool[]): string {
	const counts = { read: 0, list: 0, search: 0, def: 0 }
	for (const tool of tools) {
		switch (tool.tool) {
			case "readFile":
				counts.read++
				break
			case "listFilesTopLevel":
			case "listFilesRecursive":
				counts.list++
				break
			case "searchFiles":
				counts.search++
				break
			case "listCodeDefinitionNames":
				counts.def++
				break
		}
	}
	const parts: string[] = []
	if (counts.read > 0) {
		parts.push(`${counts.read} file${counts.read > 1 ? "s" : ""}`)
	}
	if (counts.list > 0) {
		parts.push(`${counts.list} folder${counts.list > 1 ? "s" : ""}`)
	}
	if (counts.def > 0) {
		parts.push(`${counts.def} definition${counts.def > 1 ? "s" : ""}`)
	}
	if (counts.search > 0) {
		parts.push(`${counts.search} search${counts.search > 1 ? "es" : ""}`)
	}
	if (parts.length === 0) {
		return "Agentario updated context"
	}
	const action = counts.read > 0 || counts.list > 0 ? " read " : " "
	return `Agentario${action}${parts.join(", ")}`
}

function completedLowStakesTools(messages: ClineMessage[]): ClineSayTool[] {
	const result: ClineSayTool[] = []
	for (const message of messages) {
		if (message.say === "reasoning") {
			continue
		}
		if (!isLowStakesTool(message)) {
			continue
		}
		const parsed = parseTool(message.text)
		const previous = result.at(-1)
		if (
			parsed.tool === "readFile" &&
			parsed.path &&
			message.say === "tool" &&
			previous?.tool === "readFile" &&
			previous.path === parsed.path
		) {
			result[result.length - 1] = parsed
			continue
		}
		if (message.say === "tool") {
			result.push(parsed)
		}
	}
	return result
}

function appendBlock(lines: string[], heading: string, body: string, statsLine?: string): void {
	lines.push(`${heading}:`)
	if (body.trim()) {
		lines.push(body.trimEnd())
	}
	if (statsLine) {
		lines.push("")
		lines.push(statsLine)
	}
	lines.push("")
	lines.push("=======================")
	lines.push("")
}

function formatCommandBlock(message: ClineMessage): string {
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

function formatHighStakesTool(message: ClineMessage): string | undefined {
	const tool = parseTool(message.text)
	if (!tool.tool) {
		return message.text
	}
	if (tool.tool === "attempt_completion") {
		return undefined
	}
	const label = message.type === "ask" ? "Agentario wants to use tool" : "Agentario used tool"
	const parts = [label, tool.tool]
	if (tool.path) {
		parts.push(tool.path)
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

export function exportChatToMarkdown(messages: ClineMessage[], options: ExportChatMarkdownOptions = {}): string {
	const lines: string[] = []
	const exportedAt = options.exportedAt ?? new Date()

	if (options.title?.trim()) {
		lines.push(`# ${options.title.trim()}`, "")
	}
	lines.push(`Exported: ${exportedAt.toISOString()}`, "", "---", "")

	let pendingTools: ClineMessage[] = []

	const flushToolGroup = () => {
		if (pendingTools.length === 0) {
			return
		}
		const tools = completedLowStakesTools(pendingTools)
		if (tools.length === 0) {
			pendingTools = []
			return
		}
		lines.push(`${toolGroupSummary(tools)}:`, "")
		for (const tool of tools) {
			if (tool.path) {
				lines.push(tool.path)
			}
		}
		lines.push("")
		pendingTools = []
	}

	for (const message of messages) {
		if (message.partial) {
			continue
		}

		if (isLowStakesTool(message)) {
			pendingTools.push(message)
			continue
		}

		flushToolGroup()

		if (message.type === "say" && message.say && SKIP_SAY.has(message.say)) {
			continue
		}

		if (message.type === "say" && (message.say === "user_feedback" || message.say === "task")) {
			appendBlock(lines, "User", message.text ?? "")
			continue
		}

		if (message.type === "say" && message.say === "reasoning") {
			if (message.text?.trim()) {
				appendBlock(lines, "Thinking", message.text)
			}
			continue
		}

		if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
			appendBlock(lines, "Agent", message.text ?? "")
			continue
		}

		if (message.type === "say" && message.say === "command") {
			appendBlock(lines, "Agent", formatCommandBlock(message))
			continue
		}

		if (message.type === "say" && message.say === "tool") {
			const body = formatHighStakesTool(message)
			if (body) {
				appendBlock(lines, "Agent", body)
			}
			continue
		}

		if (message.type === "ask" && message.ask === "tool" && !isLowStakesTool(message)) {
			const body = formatHighStakesTool(message)
			if (body) {
				appendBlock(lines, "Agent", body)
			}
		}
	}

	flushToolGroup()

	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop()
	}

	return `${lines.join("\n")}\n`
}

/** Stats footer for export (optional extension). */
export function exportStatsFooter(info: Parameters<typeof formatMessageStatsLine>[0]): string | undefined {
	return formatMessageStatsLine(info)
}
