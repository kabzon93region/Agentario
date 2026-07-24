import { EmptyRequest, String } from "@shared/proto/agentario/common"
import type { Controller } from ".."
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { Logger } from "@shared/services/Logger"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Перехватывает реальный контекст, отправляемый в модель (system prompt +
 * сообщения + инструменты), через эмуляцию отправки сообщения. SDK формирует
 * полный контекст, но beforeModel-хук перехватывает его и прерывает отправку
 * до вызова LLM. Результат сохраняется в файл и открывается в редакторе.
 */
export async function exportContextText(controller: Controller, _request: EmptyRequest): Promise<String> {
	Logger.log("[ExportContext] Starting model context capture...")

	const captured = await controller.captureModelContext()
	const lines: string[] = []
	const now = new Date()

	if (captured) {
		// Active session — export full model context
		Logger.log(
			`[ExportContext] Captured: systemPrompt=${captured.systemPrompt.length} chars, messages=${captured.messages.length}, tools=${captured.tools.length}`,
		)

		lines.push("=".repeat(80))
		lines.push("КОНТЕКСТ МОДЕЛИ — Agentario")
		lines.push(`Время: ${now.toISOString()}`)
		lines.push(`Провайдер/модель: ${controller.stateManager.getApiConfiguration().actModeApiProvider ?? "unknown"}`)
		lines.push("=".repeat(80))
		lines.push("")

		// ── 1. SYSTEM PROMPT ────────────────────────────────────────────────
		lines.push("█".repeat(80))
		lines.push("█ SYSTEM PROMPT")
		lines.push("█".repeat(80))
		lines.push("")
		lines.push(captured.systemPrompt || "(пусто)")
		lines.push("")

		// ── 2. TOOLS ────────────────────────────────────────────────────────
		lines.push("█".repeat(80))
		lines.push(`█ ИНСТРУМЕНТЫ (${captured.tools.length})`)
		lines.push("█".repeat(80))
		lines.push("")
		for (let i = 0; i < captured.tools.length; i++) {
			const tool = captured.tools[i] as ToolLike
			lines.push(`── ${i + 1}. ${tool?.name ?? "unknown"} ──`)
			const desc = tool?.description?.trim()
			if (desc) {
				lines.push(desc)
			}
			if (tool?.inputSchema) {
				lines.push("Схема входа:")
				lines.push(JSON.stringify(tool.inputSchema, null, 2))
			}
			lines.push("")
		}

		// ── 3. CONVERSATION MESSAGES ────────────────────────────────────────
		lines.push("█".repeat(80))
		lines.push(`█ СООБЩЕНИЯ КОНТЕКСТА (${captured.messages.length})`)
		lines.push("█".repeat(80))
		lines.push("")
		for (let i = 0; i < captured.messages.length; i++) {
			const msg = captured.messages[i] as CapturedMessage
			const role = msg?.role ?? "unknown"
			const roleLabel = role === "user" ? "ПОЛЬЗОВАТЕЛЬ" : role === "assistant" ? "АССИСТЕНТ" : role.toUpperCase()

			lines.push(`── сообщение ${i + 1}/${captured.messages.length} ──`)
			lines.push(`[${roleLabel}]`)

			if (Array.isArray(msg?.content)) {
				for (const part of msg.content) {
					formatMessagePart(part, lines)
				}
			} else if (typeof msg?.content === "string") {
				lines.push(msg.content)
			}
			lines.push("")
		}

		// ── 4. SUMMARY ──────────────────────────────────────────────────────
		lines.push("#".repeat(80))
		lines.push("# СВОДКА")
		lines.push("#".repeat(80))
		lines.push("")
		const sysChars = captured.systemPrompt.length
		const msgChars = countMessageChars(captured.messages)
		const toolChars = countToolChars(captured.tools)
		const totalChars = sysChars + msgChars + toolChars
		lines.push(`System prompt:  ${sysChars.toLocaleString()} симв. (~${Math.ceil(sysChars / 3).toLocaleString()} токенов)`)
		lines.push(`Сообщения:       ${captured.messages.length} шт., ${msgChars.toLocaleString()} симв. (~${Math.ceil(msgChars / 3).toLocaleString()} токенов)`)
		lines.push(`Инструменты:     ${captured.tools.length} шт., ${toolChars.toLocaleString()} симв. (~${Math.ceil(toolChars / 3).toLocaleString()} токенов)`)
		lines.push(`─`.repeat(40))
		lines.push(`ВСЕГО:           ${totalChars.toLocaleString()} симв. (~${Math.ceil(totalChars / 3).toLocaleString()} токенов)`)
		lines.push("")
	} else {
		// No active session — fallback: export display messages from current task
		Logger.log("[ExportContext] No active session — exporting display messages as fallback")
		const displayMessages = controller.task?.messageStateHandler?.getagentarioMessages() ?? []
		if (displayMessages.length === 0) {
			return { value: "" }
		}

		lines.push("=".repeat(80))
		lines.push("ИСТОРИЯ ЧАТА — Agentario (нет активной сессии)")
		lines.push(`Время: ${now.toISOString()}`)
		lines.push(`Сообщений: ${displayMessages.length}`)
		lines.push("=".repeat(80))
		lines.push("")

		for (const msg of displayMessages) {
			const roleLabel = msg.type === "ask" ? "ПОЛЬЗОВАТЕЛЬ" : msg.type === "say" ? "АССИСТЕНТ" : msg.type.toUpperCase()
			const sayLabel = msg.say ? ` (${msg.say})` : ""
			lines.push(`── [${roleLabel}${sayLabel}] ${new Date(msg.createdAtMs ?? msg.ts).toLocaleTimeString()} ──`)
			if (msg.text) {
				lines.push(msg.text.slice(0, 2000))
				if (msg.text.length > 2000) {
					lines.push(`... (обрезано, всего ${msg.text.length} симв.)`)
				}
			}
			lines.push("")
		}
	}

	// ── Write file ──────────────────────────────────────────────────────
	const exportsDir = path.join(os.homedir(), "Documents", "Agentario")
	await fs.mkdir(exportsDir, { recursive: true })

	const filename = `model_context_${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`
	const filePath = path.join(exportsDir, filename)

	await fs.writeFile(filePath, lines.join("\n"), "utf8")
	Logger.log(`[ExportContext] Wrote to: ${filePath}`)

	// ── Open in editor ──────────────────────────────────────────────────
	try {
		await HostProvider.window.showTextDocument({
			path: filePath,
			options: {},
		})
		Logger.log(`[ExportContext] File opened in editor: ${filePath}`)
	} catch (err) {
		Logger.error(`[ExportContext] Failed to open file: ${err}`)
	}

	return { value: filePath }
}

// ─── Helpers ────────────────────────────────────────────────────────────

interface ToolLike {
	name?: string
	description?: string
	inputSchema?: unknown
}

interface CapturedMessage {
	role?: string
	content?: unknown
}

interface MessagePart {
	type?: string
	text?: string
	input?: unknown
	output?: unknown
	name?: string
	toolCallId?: string
	isError?: boolean
}

function formatMessagePart(part: MessagePart, lines: string[]): void {
	if (!part || typeof part !== "object") {
		return
	}

	switch (part.type) {
		case "text":
			if (part.text) {
				lines.push(part.text)
			}
			break
		case "reasoning":
			if (part.text) {
				lines.push(`[РАССУЖДЕНИЕ] ${part.text}`)
			}
			break
		case "tool-call":
			lines.push(`[ВЫЗОВ ИНСТРУМЕНТА: ${part.name ?? "unknown"}]`)
			if (part.input !== undefined) {
				lines.push(JSON.stringify(part.input, null, 2))
			}
			break
		case "tool-result":
			lines.push(`[РЕЗУЛЬТАТ ИНСТРУМЕНТА${part.isError ? " (ОШИБКА)" : ""}]`)
			if (typeof part.output === "string") {
				lines.push(part.output)
			} else if (part.output !== undefined) {
				lines.push(JSON.stringify(part.output, null, 2))
			}
			break
		case "file":
			lines.push(`[ФАЙЛ: ${typeof part.text === "string" ? part.text.slice(0, 200) : "..."}]`)
			break
		default:
			// Unknown part type — dump as JSON for completeness
			lines.push(`[${part.type ?? "unknown"}]`)
			lines.push(JSON.stringify(part, null, 2))
	}
}

function countMessageChars(messages: readonly unknown[]): number {
	let total = 0
	for (const msg of messages) {
		const m = msg as CapturedMessage
		if (Array.isArray(m?.content)) {
			for (const part of m.content) {
				const p = part as MessagePart
				if (p?.type === "text" && typeof p.text === "string") {
					total += p.text.length
				} else if (p?.type === "tool-result") {
					if (typeof p.output === "string") total += p.output.length
					else total += JSON.stringify(p.output ?? "").length
				} else if (p?.type === "tool-call") {
					total += JSON.stringify(p.input ?? "").length
				}
			}
		} else if (typeof m?.content === "string") {
			total += m.content.length
		}
	}
	return total
}

function countToolChars(tools: readonly unknown[]): number {
	let total = 0
	for (const tool of tools) {
		const t = tool as ToolLike
		total += (t?.description ?? "").length
		total += JSON.stringify(t?.inputSchema ?? {}).length
	}
	return total
}
