/**
 * Standalone export utilities for the debug harness.
 *
 * Replicates the logic of `exportChatToMarkdown` from the extension,
 * operating on raw `ui_messages.json` objects (no extension imports needed).
 */

import fs from "node:fs"
import path from "node:path"

// ── Constants (mirrored from extension) ──

const COMMAND_OUTPUT_STRING = "Output:"

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

const SKIP_ASK_TOOL = new Set(["attempt_completion"])

interface SayTool {
	tool?: string
	path?: string
	regex?: string
	content?: string
}

// ── Helpers ──

function formatTs(ts: number | undefined): string {
	if (!ts || !Number.isFinite(ts) || ts <= 0) return ""
	try {
		return new Date(ts).toISOString()
	} catch {
		return ""
	}
}

function appendBlock(lines: string[], heading: string, body: string, ts?: number): void {
	const when = formatTs(ts)
	lines.push(when ? `${heading} (${when}):` : `${heading}:`)
	if (body.trim()) lines.push(body.trimEnd())
	lines.push("", "=======================", "")
}

function parseTool(text: string | undefined): SayTool {
	try {
		return JSON.parse(text || "{}")
	} catch {
		return {}
	}
}

function formatCommandBlock(msg: any): string {
	const raw = msg.text ?? ""
	const [commandPart, ...outputParts] = raw.split(COMMAND_OUTPUT_STRING)
	const command = commandPart.trim()
	const output = outputParts.join(COMMAND_OUTPUT_STRING).trim()
	const status = msg.commandCompleted ? "Completed" : "Running"
	const lines = ["Agentario wants to execute this command:", "", status, ""]
	if (command) lines.push("```shell", command, "```", "")
	if (output) lines.push("```shell", output, "```")
	return lines.join("\n").trimEnd()
}

function formatToolLine(msg: any): string {
	const tool = parseTool(msg.text)
	if (!tool.tool) return msg.text ?? ""
	const label = msg.type === "ask" ? "Agentario wants to use tool" : "Agentario used tool"
	const parts: string[] = [label, tool.tool]
	if (tool.path) parts.push(tool.path)
	if (tool.regex) parts.push(tool.regex)
	if (tool.content?.trim()) parts.push("", tool.content.trim())
	return parts.join("\n")
}

// ── Main export ──

/**
 * Export messages from `ui_messages.json` to full markdown.
 * Replicates the extension's `exportChatToMarkdown` logic.
 */
export function exportMessagesToMarkdown(messages: any[], options: { title?: string } = {}): string {
	const lines: string[] = []

	if (options.title?.trim()) {
		lines.push(`# ${options.title.trim()}`, "")
	}
	lines.push(`Exported: ${new Date().toISOString()}`, "", "---", "")

	// Pin task messages first, then sort rest by ts
	const taskMessages = messages.filter((m: any) => m.say === "task")
	const otherMessages = messages.filter((m: any) => m.say !== "task")
	const ordered = [
		...taskMessages.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0)),
		...otherMessages.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0)),
	]

	for (const msg of ordered) {
		if (msg.partial) continue
		if (msg.type === "say" && msg.say && SKIP_SAY.has(msg.say)) continue
		if (msg.type === "ask" && msg.ask === "tool" && SKIP_ASK_TOOL.has(parseTool(msg.text).tool ?? "")) continue
		if (msg.type === "say" && msg.say === "tool" && SKIP_ASK_TOOL.has(parseTool(msg.text).tool ?? "")) continue

		// info
		if (msg.type === "say" && msg.say === "info") {
			const text = (msg.text ?? "").trim()
			if (text) appendBlock(lines, "System", text, msg.ts)
			continue
		}

		// user
		if (msg.type === "say" && (msg.say === "user_feedback" || msg.say === "task")) {
			appendBlock(lines, "User", msg.text ?? "", msg.ts)
			continue
		}

		// thinking
		if (msg.type === "say" && msg.say === "reasoning") {
			if (msg.text?.trim()) appendBlock(lines, "Thinking", msg.text, msg.ts)
			continue
		}

		// agent text / completion
		if (msg.type === "say" && (msg.say === "text" || msg.say === "completion_result")) {
			appendBlock(lines, "Agent", msg.text ?? "", msg.ts)
			continue
		}

		// command
		if (msg.type === "say" && msg.say === "command") {
			appendBlock(lines, "Agent", formatCommandBlock(msg), msg.ts)
			continue
		}

		// tool (say)
		if (msg.type === "say" && msg.say === "tool") {
			appendBlock(lines, "Tool", formatToolLine(msg), msg.ts)
			continue
		}

		// tool (ask)
		if (msg.type === "ask" && msg.ask === "tool") {
			appendBlock(lines, "Tool", formatToolLine(msg), msg.ts)
			continue
		}
	}

	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
	return `${lines.join("\n")}\n`
}

// ── Context export ──

/**
 * Build a context export from `api_conversation_history.json`.
 * This replicates what the "Export context to file" button does:
 * system prompt + tools + conversation messages.
 */
export function exportContextFromApiHistory(historyPath: string, outputPath: string): boolean {
	if (!fs.existsSync(historyPath)) return false

	try {
		const raw = fs.readFileSync(historyPath, "utf-8")
		const history = JSON.parse(raw)
		if (!Array.isArray(history) || history.length === 0) return false

		const lines: string[] = []
		lines.push("# Agentario Lab — Context Export")
		lines.push(`Exported: ${new Date().toISOString()}`, "", "---", "")

		// Find the last request (most recent context sent to model)
		// api_conversation_history entries have: { role, content, ... }
		// Look for system message, then tool definitions, then conversation
		let systemPrompt = ""
		const toolDefs: string[] = []
		const conversationMsgs: any[] = []

		for (const entry of history) {
			if (entry.role === "system") {
				systemPrompt = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content, null, 2)
			} else if (entry.role === "assistant" && entry.tool_calls) {
				// Tool definitions are embedded in the request, not in history
				conversationMsgs.push(entry)
			} else {
				conversationMsgs.push(entry)
			}
		}

		if (systemPrompt) {
			lines.push("## SYSTEM PROMPT", "")
			lines.push(systemPrompt, "")
		}

		lines.push("## CONVERSATION MESSAGES", "")
		for (const msg of conversationMsgs) {
			const role = msg.role ?? "unknown"
			lines.push(`### ${role.toUpperCase()}`)
			if (typeof msg.content === "string") {
				lines.push(msg.content.substring(0, 5000))
			} else if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "text" && part.text) {
						lines.push(part.text.substring(0, 5000))
					} else if (part.type === "tool_use") {
						lines.push(`[Tool: ${part.name}]`, JSON.stringify(part.input, null, 2).substring(0, 2000))
					} else if (part.type === "tool_result") {
						lines.push(`[Tool Result: ${part.tool_use_id}]`, JSON.stringify(part.content, null, 2).substring(0, 2000))
					}
				}
			}
			lines.push("")
		}

		// Summary
		lines.push("## SUMMARY", "")
		lines.push(`Total API messages: ${history.length}`)
		lines.push(`System prompt length: ${systemPrompt.length} chars`)
		lines.push(`Conversation messages: ${conversationMsgs.length}`)

		fs.mkdirSync(path.dirname(outputPath), { recursive: true })
		fs.writeFileSync(outputPath, lines.join("\n"), "utf-8")
		return true
	} catch {
		return false
	}
}
