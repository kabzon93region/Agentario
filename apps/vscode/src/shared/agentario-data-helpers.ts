import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolveEffectiveMcpSettingsPath } from "@agentario/shared/storage"
import { ensureSettingsDirectoryExists, GlobalFileNames } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
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

function patchTransportForWindows(
	transport: Record<string, unknown> | undefined,
	npxPath: string | undefined,
): Record<string, unknown> | undefined {
	if (!transport || transport.type !== "stdio" || transport.command !== "npx" || !npxPath) {
		return transport
	}

	const nodeDir = path.dirname(npxPath)
	const env = { ...(transport.env as Record<string, string> | undefined) }
	env.PATH = nodeDir

	return {
		...transport,
		command: npxPath,
		env,
	}
}

export function patchMcpSettingsForPlatform(settings: McpSettingsFile, npxPath?: string): McpSettingsFile {
	const patchedServers: Record<string, Record<string, unknown>> = {}
	for (const [name, server] of Object.entries(settings.mcpServers ?? {})) {
		const next = { ...server }
		if (next.transport && typeof next.transport === "object") {
			next.transport = patchTransportForWindows(next.transport as Record<string, unknown>, npxPath)
		} else if (next.command === "npx" && npxPath) {
			next.command = npxPath
			const env = { ...(next.env as Record<string, string> | undefined) }
			env.PATH = path.dirname(npxPath)
			next.env = env
		}
		patchedServers[name] = next
	}
	return { mcpServers: patchedServers }
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

/** Перенос MCP из legacy-пути VS Code globalStorage в ~/.agentario/data/settings/. */
export async function migrateLegacyVsCodeMcpSettingsToCanonical(): Promise<string[]> {
	if (!isAgentarioStandaloneMode()) {
		return []
	}

	const canonicalPath = resolveEffectiveMcpSettingsPath()
	const legacyDir = await ensureSettingsDirectoryExists()
	const legacyPath = path.join(legacyDir, GlobalFileNames.mcpSettings)

	if (path.resolve(legacyPath) === path.resolve(canonicalPath)) {
		return []
	}

	let canonical: McpSettingsFile = { mcpServers: {} }
	try {
		canonical = JSON.parse(await fs.readFile(canonicalPath, "utf8")) as McpSettingsFile
	} catch {
		// новый файл
	}

	try {
		const legacy = JSON.parse(await fs.readFile(legacyPath, "utf8")) as McpSettingsFile
		const mergeResult = mergeRecommendedMcpSettings(canonical, legacy)
		if (mergeResult.added.length === 0) {
			return []
		}
		await fs.mkdir(path.dirname(canonicalPath), { recursive: true })
		await fs.writeFile(canonicalPath, JSON.stringify(mergeResult.settings, null, 2), "utf8")
		for (const name of mergeResult.added) {
			Logger.log(`[Agentario MCP] Migrated from VS Code storage: ${name}`)
		}
		return mergeResult.added
	} catch {
		return []
	}
}

export async function writeAgentarioMcpSettings(
	settings: McpSettingsFile,
	options: { overwrite?: boolean } = {},
): Promise<{ path: string; added: string[] }> {
	const settingsPath = resolveEffectiveMcpSettingsPath()
	await fs.mkdir(path.dirname(settingsPath), { recursive: true })
	let added: string[] = []

	if (!options.overwrite) {
		try {
			const existingRaw = await fs.readFile(settingsPath, "utf8")
			const existing = JSON.parse(existingRaw) as McpSettingsFile
			const mergeResult = mergeRecommendedMcpSettings(existing, settings)
			settings = mergeResult.settings
			added = mergeResult.added
			for (const name of mergeResult.added) {
				Logger.log(`[Agentario MCP] Added server from template: ${name}`)
			}
		} catch {
			added = Object.keys(settings.mcpServers ?? {})
		}
	} else {
		added = Object.keys(settings.mcpServers ?? {})
	}

	await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8")
	return { path: settingsPath, added }
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
	templateUpgraded: boolean
}

export async function seedAgentarioMcpSettings(stateManager?: StateManager): Promise<SeedAgentarioMcpResult> {
	if (!isAgentarioStandaloneMode()) {
		return { added: [], templateUpgraded: false }
	}

	try {
		const migrated = await migrateLegacyVsCodeMcpSettingsToCanonical()
		const template = await readRecommendedMcpTemplate()
		const { path: settingsPath, added: templateAdded } = await writeAgentarioMcpSettings(template)
		const storedVersion = stateManager?.getGlobalStateKey("agentarioMcpTemplateVersion") ?? 0
		const templateUpgraded = storedVersion < AGENTARIO_MCP_TEMPLATE_VERSION
		const added = [...new Set([...migrated, ...templateAdded])]

		if (stateManager && templateUpgraded) {
			stateManager.setGlobalState("agentarioMcpTemplateVersion", AGENTARIO_MCP_TEMPLATE_VERSION)
			Logger.log(
				`[Agentario] MCP template upgraded v${storedVersion} → v${AGENTARIO_MCP_TEMPLATE_VERSION}: ${settingsPath} (+${added.length} servers)`,
			)
		} else {
			Logger.log(`[Agentario] Seeded recommended MCP settings: ${settingsPath} (+${added.length} servers)`)
		}

		return { added, templateUpgraded }
	} catch (error) {
		Logger.warn("[Agentario] Failed to seed MCP settings:", error)
		return { added: [], templateUpgraded: false }
	}
}
