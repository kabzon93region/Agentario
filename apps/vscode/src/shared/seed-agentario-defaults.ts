import * as fs from "node:fs/promises"
import * as path from "node:path"
import { ensureRulesDirectoryExists } from "@/core/storage/disk"
import type { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { isAgentarioStandaloneMode } from "./agentario-standalone"

const BUNDLED_DEFAULT_FILES = ["agentario-global-rules.md", "agentario-system-prompt.md"] as const

async function copyBundledFileIfMissing(bundledName: string, destDir: string): Promise<string | undefined> {
	const destPath = path.join(destDir, bundledName)
	try {
		await fs.access(destPath)
		return undefined
	} catch {
		// missing
	}

	const srcPath = path.join(HostProvider.get().extensionFsPath, bundledName)
	try {
		const content = await fs.readFile(srcPath, "utf8")
		await fs.writeFile(destPath, content, "utf8")
		Logger.log(`[Agentario] Seeded default file: ${destPath}`)
		return destPath
	} catch (error) {
		Logger.warn(`[Agentario] Failed to seed ${bundledName}:`, error)
		return undefined
	}
}

/** Ensures default global rules/prompt files exist under Documents/Agentario/Rules (non-destructive). */
export async function seedAgentarioDefaults(stateManager: StateManager): Promise<void> {
	if (!isAgentarioStandaloneMode()) {
		return
	}

	const rulesDir = await ensureRulesDirectoryExists()
	const seededPaths: string[] = []

	for (const fileName of BUNDLED_DEFAULT_FILES) {
		const written = await copyBundledFileIfMissing(fileName, rulesDir)
		if (written) {
			seededPaths.push(written)
		}
	}

	if (seededPaths.length === 0) {
		return
	}

	const toggles = { ...(stateManager.getGlobalSettingsKey("globalClineRulesToggles") ?? {}) }
	let changed = false
	for (const filePath of seededPaths) {
		if (!(filePath in toggles)) {
			toggles[filePath] = true
			changed = true
		}
	}
	if (changed) {
		stateManager.setGlobalState("globalClineRulesToggles", toggles)
	}
}
