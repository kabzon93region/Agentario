import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolveLegacyMcpSettingsPath, resolveMcpSettingsPath } from "@agentario/shared/storage"
import { ensureSettingsDirectoryExists, GlobalFileNames } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { updateMcpSettingsFile } from "@/services/mcp/settingsLock"
import { Logger } from "@/shared/services/Logger"
import type { StateManager } from "@/core/storage/StateManager"
import { isAgentarioStandaloneMode } from "./agentario-standalone"

const execFileAsync = promisify(execFile)

export const AGENTARIO_BUNDLED_DEFAULT_RULE_FILES = ["agentario-global-rules.md"] as const

export const AGENTARIO_RECOMMENDED_MCP_FILENAME = "agentario-recommended-mcp.json"

export const AGENTARIO_MCP_TEMPLATE_VERSION = 3

type McpSettingsFile = {
	mcpServers: Record<string, Record<string, unknown>>
}

async function findWindowsNpxPath(): Promise<string | undefined> {
	if (process.platform !== "win32") {
		return undefined
	}

	const candidates = [
		process.env.NPX_PATH,
		path.join(process.env.ProgramFiles ?? "", "nodejs", "npx.cmd"),
		path.join(process.env["ProgramFiles(x86)"] ?? "", "nodejs", "npx.cmd"),
		path.join(process.env.LOCALAPPDATA ?? "", "Programs", "node", "npx.cmd"),
	].filter(Boolean) as string[]

	for (const candidate of candidates) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {
			// try next
		}
	}

	try {
		const { stdout } = await execFileAsync("where", ["npx"], { windowsHide: true })
		const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim()
		return first || undefined
	} catch {
		return undefined
	}
}

function normalizeWindowsPathEnv(nodeDir: string, existing?: string): string {
	const parts = (existing ?? "")
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.filter((part) => part.toLowerCase() !== nodeDir.toLowerCase())
	return [nodeDir, ...parts].join(";")
}

function patchTransportForWindows(
	transport: Record<string, unknown> | undefined,
	npxPath: string | undefined,
): Record<string, unknown> | undefined {
	if (!transport || transport.type !== "stdio" || !npxPath) {
		return transport
	}

	const command = typeof transport.command === "string" ? transport.command : undefined
	const needsNpxPatch = command === "npx" || command === "npx.cmd"
	const nodeDir = path.dirname(npxPath)
	const env = { ...(transport.env as Record<string, string> | undefined) }
	const nextCommand = needsNpxPatch ? npxPath : command
	const nextPath = normalizeWindowsPathEnv(nodeDir, env.PATH)
	const commandChanged = nextCommand !== command
	const pathChanged = nextPath !== env.PATH

	if (!needsNpxPatch && !pathChanged) {
		return transport
	}

	env.PATH = nextPath

	return {
		...transport,
		...(needsNpxPatch ? { command: npxPath } : {}),
		env,
	}
}

export function patchMcpSettingsForPlatform(settings: McpSettingsFile, npxPath?: string): McpSettingsFile {
	const patchedServers: Record<string, Record<string, unknown>> = {}
	for (const [name, server] of Object.entries(settings.mcpServers ?? {})) {
		const next = { ...server }
		if (next.transport && typeof next.transport === "object") {
			next.transport = patchTransportForWindows(next.transport as Record<string, unknown>, npxPath)
		} else if ((next.command === "npx" || next.command === "npx.cmd") && npxPath) {
			next.command = npxPath
			const env = { ...(next.env as Record<string, string> | undefined) }
			env.PATH = normalizeWindowsPathEnv(path.dirname(npxPath), env.PATH)
			next.env = env
		} else if (typeof next.command === "string" && npxPath && next.env && typeof next.env === "object") {
			const env = { ...(next.env as Record<string, string>) }
			const nextPath = normalizeWindowsPathEnv(path.dirname(npxPath), env.PATH)
			if (nextPath !== env.PATH) {
				env.PATH = nextPath
				next.env = env
			}
		}
		patchedServers[name] = next
	}
	return { mcpServers: patchedServers }
}

/** Returns server names whose transport/command/env changed after platform patch. */
export function diffRepairedMcpServers(before: McpSettingsFile, after: McpSettingsFile): string[] {
	const repaired: string[] = []
	for (const name of Object.keys(after.mcpServers ?? {})) {
		if (JSON.stringify(before.mcpServers?.[name] ?? null) !== JSON.stringify(after.mcpServers[name] ?? null)) {
			repaired.push(name)
		}
	}
	return repaired
}

export async function readRecommendedMcpTemplate(): Promise<McpSettingsFile> {
	const templatePath = path.join(HostProvider.get().extensionFsPath, AGENTARIO_RECOMMENDED_MCP_FILENAME)
	const raw = await fs.readFile(templatePath, "utf8")
	const parsed = JSON.parse(raw) as McpSettingsFile
	const npxPath = await findWindowsNpxPath()
	return patchMcpSettingsForPlatform(parsed, npxPath)
}

export function mergeRecommendedMcpSettings(
	existing: McpSettingsFile | undefined,
	incoming: McpSettingsFile,
): { settings: McpSettingsFile; added: string[] } {
	if (!existing?.mcpServers) {
		return { settings: incoming, added: Object.keys(incoming.mcpServers ?? {}) }
	}

	const merged: McpSettingsFile = { mcpServers: { ...existing.mcpServers } }
	const added: string[] = []
	for (const [name, config] of Object.entries(incoming.mcpServers ?? {})) {
		if (!(name in merged.mcpServers)) {
			merged.mcpServers[name] = config
			added.push(name)
		}
	}
	return { settings: merged, added }
}

async function readMcpSettingsFileSafe(filePath: string): Promise<McpSettingsFile | undefined> {
	try {
		const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as McpSettingsFile
		if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") {
			return { mcpServers: {} }
		}
		return parsed
	} catch {
		return undefined
	}
}

/** Перенос MCP из legacy-пути VS Code globalStorage в ~/.agentario/data/settings/. */
export async function migrateLegacyVsCodeMcpSettingsToCanonical(): Promise<string[]> {
	if (!isAgentarioStandaloneMode()) {
		return []
	}

	const canonicalPath = resolveMcpSettingsPath()
	const legacyDir = await ensureSettingsDirectoryExists()
	const legacyPath = path.join(legacyDir, GlobalFileNames.mcpSettings)
	const clineLegacyPath = resolveLegacyMcpSettingsPath()

	let canonical = (await readMcpSettingsFileSafe(canonicalPath)) ?? { mcpServers: {} }
	const sources: Array<{ path: string; label: string }> = [
		{ path: legacyPath, label: "VS Code storage" },
		{ path: clineLegacyPath, label: "legacy cline_mcp_settings" },
	]

	const added: string[] = []
	for (const source of sources) {
		if (path.resolve(source.path) === path.resolve(canonicalPath)) {
			continue
		}
		const legacy = await readMcpSettingsFileSafe(source.path)
		if (!legacy?.mcpServers || Object.keys(legacy.mcpServers).length === 0) {
			continue
		}
		// Empty primary (created by eager getMcpSettingsFilePath) must not shadow
		// a populated legacy file — merge add-only into canonical.
		const mergeResult = mergeRecommendedMcpSettings(canonical, legacy)
		if (mergeResult.added.length === 0) {
			continue
		}
		canonical = mergeResult.settings
		added.push(...mergeResult.added)
		for (const name of mergeResult.added) {
			Logger.log(`[Agentario MCP] Migrated from ${source.label}: ${name}`)
		}
	}

	if (added.length === 0) {
		return []
	}

	await fs.mkdir(path.dirname(canonicalPath), { recursive: true })
	await updateMcpSettingsFile(canonicalPath, (current) => {
		current.mcpServers = canonical.mcpServers
		return current
	})
	return [...new Set(added)]
}

export async function writeAgentarioMcpSettings(
	settings: McpSettingsFile,
	options: { overwrite?: boolean } = {},
): Promise<{ path: string; added: string[]; repaired: string[] }> {
	const settingsPath = resolveMcpSettingsPath()
	await fs.mkdir(path.dirname(settingsPath), { recursive: true })
	const npxPath = await findWindowsNpxPath()
	let added: string[] = []
	let repaired: string[] = []

	await updateMcpSettingsFile(settingsPath, (current) => {
		const existing: McpSettingsFile = {
			mcpServers:
				current.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers)
					? (current.mcpServers as Record<string, Record<string, unknown>>)
					: {},
		}

		let next: McpSettingsFile
		if (!options.overwrite) {
			const mergeResult = mergeRecommendedMcpSettings(existing, settings)
			next = mergeResult.settings
			added = mergeResult.added
			for (const name of mergeResult.added) {
				Logger.log(`[Agentario MCP] Added server from template: ${name}`)
			}
		} else {
			next = settings
			added = Object.keys(settings.mcpServers ?? {})
		}

		const patched = patchMcpSettingsForPlatform(next, npxPath)
		repaired = diffRepairedMcpServers(next, patched)
		for (const name of repaired) {
			Logger.log(`[Agentario MCP] Repaired transport/PATH for: ${name}`)
		}
		current.mcpServers = patched.mcpServers
		return current
	})

	return { path: settingsPath, added, repaired }
}

export async function restoreBundledDefaultRules(rulesDir: string): Promise<string[]> {
	const restored: string[] = []
	for (const fileName of AGENTARIO_BUNDLED_DEFAULT_RULE_FILES) {
		const destPath = path.join(rulesDir, fileName)
		const srcPath = path.join(HostProvider.get().extensionFsPath, fileName)
		try {
			const content = await fs.readFile(srcPath, "utf8")
			await fs.writeFile(destPath, content, "utf8")
			restored.push(destPath)
			Logger.log(`[Agentario] Restored bundled rule: ${destPath}`)
		} catch (error) {
			Logger.warn(`[Agentario] Failed to restore bundled rule ${fileName}:`, error)
		}
	}
	return restored
}

/** Добавляет рекомендуемые MCP-серверы при первом запуске (не перезаписывает существующие). */
export type SeedAgentarioMcpResult = {
	added: string[]
	repaired: string[]
	templateUpgraded: boolean
}

export async function seedAgentarioMcpSettings(stateManager?: StateManager): Promise<SeedAgentarioMcpResult> {
	if (!isAgentarioStandaloneMode()) {
		return { added: [], repaired: [], templateUpgraded: false }
	}

	try {
		const migrated = await migrateLegacyVsCodeMcpSettingsToCanonical()
		const template = await readRecommendedMcpTemplate()
		const { path: settingsPath, added: templateAdded, repaired } = await writeAgentarioMcpSettings(template)
		const storedVersion = stateManager?.getGlobalStateKey("agentarioMcpTemplateVersion") ?? 0
		const templateUpgraded = storedVersion < AGENTARIO_MCP_TEMPLATE_VERSION
		const added = [...new Set([...migrated, ...templateAdded])]

		if (stateManager && templateUpgraded) {
			stateManager.setGlobalState("agentarioMcpTemplateVersion", AGENTARIO_MCP_TEMPLATE_VERSION)
			Logger.log(
				`[Agentario] MCP template upgraded v${storedVersion} → v${AGENTARIO_MCP_TEMPLATE_VERSION}: ${settingsPath} (+${added.length} servers, repaired ${repaired.length})`,
			)
		} else {
			Logger.log(
				`[Agentario] Seeded recommended MCP settings: ${settingsPath} (+${added.length} servers, repaired ${repaired.length})`,
			)
		}

		return { added, repaired, templateUpgraded }
	} catch (error) {
		Logger.warn("[Agentario] Failed to seed MCP settings:", error)
		return { added: [], repaired: [], templateUpgraded: false }
	}
}
