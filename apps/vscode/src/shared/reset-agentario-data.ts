import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
	AGENTARIO_HOME_DIR_NAME,
	LEGACY_CLINE_HOME_DIR_NAME,
	resolveAgentarioDataDir,
	resolveProviderSettingsPath,
} from "@agentario/shared/storage"
import { GLOBAL_RULES_EXCLUDED_FILENAMES } from "@/core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists } from "@/core/storage/disk"
import type { StateManager } from "@/core/storage/StateManager"
import { resetGlobalState, resetWorkspaceState } from "@/core/storage/utils/state-helpers"
import { migrateStandaloneProviderSettings } from "@/shared/agentario-standalone"
import { Logger } from "@/shared/services/Logger"
import {
	AGENTARIO_BUNDLED_DEFAULT_RULE_FILES,
	readRecommendedMcpTemplate,
	restoreBundledDefaultRules,
	writeAgentarioMcpSettings,
} from "./agentario-data-helpers"
import { seedAgentarioDefaults } from "./seed-agentario-defaults"

async function removeDirectoryContents(dirPath: string): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		await Promise.all(
			entries.map((entry) => fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true })),
		)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
}

function getIndexesRoots(): string[] {
	const primary = path.join(resolveAgentarioDataDir(), "indexes")
	const candidates = [
		primary,
		path.join(os.homedir(), AGENTARIO_HOME_DIR_NAME, "data", "indexes"),
		path.join(os.homedir(), LEGACY_CLINE_HOME_DIR_NAME, "data", "indexes"),
	]
	const seen = new Set<string>()
	return candidates.filter((candidate) => {
		const key = path.normalize(candidate).toLowerCase()
		if (seen.has(key)) {
			return false
		}
		seen.add(key)
		return true
	})
}

async function clearAllCodebaseIndexes(): Promise<void> {
	for (const indexesRoot of getIndexesRoots()) {
		await removeDirectoryContents(indexesRoot)
	}
}

async function resetGlobalRuleToggles(stateManager: StateManager, rulesDir: string): Promise<void> {
	const bundledNames = new Set<string>(AGENTARIO_BUNDLED_DEFAULT_RULE_FILES)
	const toggles: Record<string, boolean> = {}

	for (const fileName of AGENTARIO_BUNDLED_DEFAULT_RULE_FILES) {
		toggles[path.normalize(path.join(rulesDir, fileName))] = true
	}

	let entries: Awaited<ReturnType<typeof fs.readdir>>
	try {
		entries = await fs.readdir(rulesDir, { withFileTypes: true })
	} catch {
		stateManager.setGlobalState("globalAgentarioRulesToggles", toggles)
		return
	}

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue
		}
		if (bundledNames.has(entry.name) || GLOBAL_RULES_EXCLUDED_FILENAMES.has(entry.name)) {
			continue
		}
		toggles[path.normalize(path.join(rulesDir, entry.name))] = true
	}

	stateManager.setGlobalState("globalAgentarioRulesToggles", toggles)
}

/** Полный сброс данных Agentario: настройки, кеш, индекс, MCP, пресеты; пользовательские правила сохраняются. */
export async function resetAgentarioData(stateManager: StateManager): Promise<void> {
	const dataDir = resolveAgentarioDataDir()

	await resetGlobalState()
	await resetWorkspaceState()

	await Promise.all([
		removeDirectoryContents(path.join(dataDir, "tasks")),
		removeDirectoryContents(path.join(dataDir, "cache")),
		clearAllCodebaseIndexes(),
	])

	const providersPath = resolveProviderSettingsPath()
	await fs.rm(providersPath, { force: true })

	await writeAgentarioMcpSettings(await readRecommendedMcpTemplate(), { overwrite: true })

	const rulesDir = await ensureRulesDirectoryExists()
	await restoreBundledDefaultRules(rulesDir)
	await resetGlobalRuleToggles(stateManager, rulesDir)

	migrateStandaloneProviderSettings(stateManager)
	await seedAgentarioDefaults(stateManager)

	Logger.log("[Agentario] Full data reset completed")
}

/** Путь к каталогу логов чатов (папки задач). */
export async function resolveAgentarioChatLogsDirectory(): Promise<string> {
	const dataDir = resolveAgentarioDataDir()
	const tasksDir = path.join(dataDir, "tasks")
	await fs.mkdir(tasksDir, { recursive: true })
	return tasksDir
}
