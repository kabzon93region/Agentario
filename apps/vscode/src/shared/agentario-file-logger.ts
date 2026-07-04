import * as fs from "node:fs/promises"
import * as path from "node:path"
import { resolveClineDataDir } from "@cline/shared/storage"

const LOG_SUBDIR = path.join("logs", "extension")

function formatLogLine(level: string, message: string, args: unknown[]): string {
	const timestamp = new Date().toISOString()
	const suffix =
		args.length > 0
			? ` ${args
					.map((arg) => {
						try {
							return typeof arg === "string" ? arg : JSON.stringify(arg)
						} catch {
							return String(arg)
						}
					})
					.join(" ")}`
			: ""
	return `[${timestamp}] ${level} ${message}${suffix}\n`
}

function dailyLogFileName(date = new Date()): string {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, "0")
	const d = String(date.getDate()).padStart(2, "0")
	return `agentario-${y}-${m}-${d}.log`
}

export async function resolveAgentarioExtensionLogsDirectory(): Promise<string> {
	const dir = path.join(resolveClineDataDir(), LOG_SUBDIR)
	await fs.mkdir(dir, { recursive: true })
	return dir
}

/** Корневая папка логов Agentario (extension + ui + readme для tasks). */
export async function resolveAgentarioLogsRootDirectory(): Promise<string> {
	const root = path.join(resolveClineDataDir(), "logs")
	const extensionDir = path.join(root, "extension")
	const uiDir = path.join(root, "ui")
	await fs.mkdir(extensionDir, { recursive: true })
	await fs.mkdir(uiDir, { recursive: true })

	const tasksDir = path.join(resolveClineDataDir(), "tasks")
	const readmePath = path.join(root, "README.txt")
	try {
		await fs.access(readmePath)
	} catch {
		await fs.writeFile(
			readmePath,
			[
				"Agentario logs",
				"",
				"extension/  — лог расширения (кнопки UI, ошибки, gRPC)",
				"ui/         — события webview (экраны, клики)",
				"",
				`tasks/      — логи чатов: ${tasksDir}`,
				"            (в каждой подпапке: ui_messages.json, api_conversation_history.json)",
				"",
			].join("\r\n"),
			"utf8",
		)
	}

	return root
}

export async function appendAgentarioExtensionLog(level: string, message: string, args: unknown[] = []): Promise<void> {
	try {
		const dir = await resolveAgentarioExtensionLogsDirectory()
		const filePath = path.join(dir, dailyLogFileName())
		await fs.appendFile(filePath, formatLogLine(level, message, args), "utf8")
	} catch {
		// logging must never break the extension
	}
}

export async function appendAgentarioExtensionRawLine(line: string): Promise<void> {
	try {
		const dir = await resolveAgentarioExtensionLogsDirectory()
		const filePath = path.join(dir, dailyLogFileName())
		const timestamp = new Date().toISOString()
		await fs.appendFile(filePath, `[${timestamp}] ${line}\n`, "utf8")
	} catch {
		// ignore
	}
}

export async function appendAgentarioUiLog(payload: Record<string, unknown>): Promise<void> {
	try {
		const dir = path.join(resolveClineDataDir(), "logs", "ui")
		await fs.mkdir(dir, { recursive: true })
		const filePath = path.join(dir, dailyLogFileName())
		const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n"
		await fs.appendFile(filePath, line, "utf8")
	} catch {
		// ignore
	}
}
