import * as fs from "node:fs/promises"
import * as path from "node:path"
import { GLOBAL_RULES_EXCLUDED_FILENAMES } from "@/core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists } from "@/core/storage/disk"
import type { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { AGENTARIO_BUNDLED_DEFAULT_RULE_FILES } from "./agentario-data-helpers"
import { isAgentarioStandaloneMode } from "./agentario-standalone"

const BUNDLED_DEFAULT_FILES = AGENTARIO_BUNDLED_DEFAULT_RULE_FILES

/** True when the installed default rule still teaches shell directory listing. */
function needsBundledRulesRefresh(existingContent: string): boolean {
	return (
		/Get-ChildItem\s+-Recurse/i.test(existingContent) ||
		/Рекурсивный список файлов/i.test(existingContent) ||
		(/Get-ChildItem/i.test(existingContent) && /-Depth/i.test(existingContent))
	)
}

/**
 * Seed or refresh the bundled default rule. Missing files are created.
 * Existing files that still instruct Get-ChildItem directory listing are overwritten
 * so they stop fighting the shell bypass guard.
 */
async function syncBundledDefaultRule(bundledName: string, destDir: string): Promise<string | undefined> {
	const destPath = path.join(destDir, bundledName)
	const srcPath = path.join(HostProvider.get().extensionFsPath, bundledName)

	let existing: string | undefined
	try {
		existing = await fs.readFile(destPath, "utf8")
	} catch {
		existing = undefined
	}

	if (existing !== undefined && !needsBundledRulesRefresh(existing)) {
		return undefined
	}

	try {
		const content = await fs.readFile(srcPath, "utf8")
		await fs.writeFile(destPath, content, "utf8")
		Logger.log(
			existing === undefined
				? `[Agentario] Seeded default file: ${destPath}`
				: `[Agentario] Refreshed default rule (removed shell listing advice): ${destPath}`,
		)
		return destPath
	} catch (error) {
		Logger.warn(`[Agentario] Failed to seed ${bundledName}:`, error)
		return undefined
	}
}

function cleanupLegacySystemPromptRuleToggles(
	rulesDir: string,
	toggles: Record<string, boolean>,
): { toggles: Record<string, boolean>; changed: boolean } {
	const next = { ...toggles }
	let changed = false
	for (const togglePath of Object.keys(next)) {
		const baseName = path.basename(togglePath)
		if (GLOBAL_RULES_EXCLUDED_FILENAMES.has(baseName)) {
			delete next[togglePath]
			changed = true
		}
	}
	for (const excludedName of GLOBAL_RULES_EXCLUDED_FILENAMES) {
		const legacyPath = path.normalize(path.join(rulesDir, excludedName))
		if (legacyPath in next) {
			delete next[legacyPath]
			changed = true
		}
	}
	return { toggles: next, changed }
}

/** Ensures default global rules exist under Documents/Agentario/Rules (non-destructive). */
export async function seedAgentarioDefaults(stateManager: StateManager): Promise<void> {
	if (!isAgentarioStandaloneMode()) {
		return
	}

	const rulesDir = await ensureRulesDirectoryExists()
	const seededPaths: string[] = []

	for (const fileName of BUNDLED_DEFAULT_FILES) {
		const written = await syncBundledDefaultRule(fileName, rulesDir)
		if (written) {
			seededPaths.push(written)
		}
	}

	const toggles = { ...(stateManager.getGlobalSettingsKey("globalAgentarioRulesToggles") ?? {}) }
	const { toggles: cleanedToggles, changed: cleanupChanged } = cleanupLegacySystemPromptRuleToggles(rulesDir, toggles)
	let changed = cleanupChanged

	for (const filePath of seededPaths) {
		if (!(filePath in cleanedToggles)) {
			cleanedToggles[filePath] = true
			changed = true
		}
	}

	if (changed) {
		stateManager.setGlobalState("globalAgentarioRulesToggles", cleanedToggles)
	}
}
