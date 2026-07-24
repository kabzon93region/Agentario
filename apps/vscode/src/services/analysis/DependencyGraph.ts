import * as fs from "node:fs/promises"
import type * as fsSync from "node:fs"
import * as path from "node:path"
import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportEntry {
	/** The raw import specifier as written in source code. */
	specifier: string
	/** Resolved absolute path if found on disk, otherwise null. */
	resolvedPath: string | null
	/** Import type for classification. */
	type: "relative" | "absolute" | "package" | "unknown"
}

export interface FileNode {
	/** Absolute file path. */
	filePath: string
	/** Relative path from workspace root. */
	relativePath: string
	/** List of imports found in this file. */
	imports: ImportEntry[]
	/** List of exports (named + default). */
	exports: string[]
}

export interface DependencyEdge {
	from: string
	to: string
}

export interface DependencyGraphData {
	nodes: Map<string, FileNode>
	/** Reverse map: file → files that import it. */
	reverseDeps: Map<string, string[]>
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

// Matches: import X from "...", import { X } from "...", import "..."
const IMPORT_PATTERNS = [
	// ES imports: import ... from "..."
	/import\s+(?:[\w\s{},*]+\s+from\s+)?["']([^"']+)["']/g,
	// CommonJS require: require("...")
	/require\s*\(\s*["']([^"']+)["']\s*\)/g,
	// Dynamic import: import("...")
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
]

// Matches: export const/async/function/class
const EXPORT_PATTERNS = [
	/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+)/g,
	/export\s+\{([^}]+)\}/g,
]

/** File extensions to scan for dependencies. */
const SCANNABLE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
	".vue", ".svelte", ".py", ".go", ".rs", ".java", ".kt",
])

/** Directories to skip during scanning. */
const SKIP_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "release",
	".next", ".nuxt", "__pycache__", ".cache", "target",
	".vscode-test", "coverage", ".turbo",
])

// ---------------------------------------------------------------------------
// DependencyGraph
// ---------------------------------------------------------------------------

export class DependencyGraph {
	private data: DependencyGraphData | null = null
	private workspaceRoot: string
	private buildTimeMs = 0

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	/**
	 * Scan the workspace and build the dependency graph.
	 * Returns the number of files scanned.
	 */
	async build(): Promise<number> {
		const start = Date.now()
		const nodes = new Map<string, FileNode>()
		const reverseDeps = new Map<string, string[]>()

		await this.scanDirectory(this.workspaceRoot, nodes, reverseDeps)

		this.data = { nodes, reverseDeps }
		this.buildTimeMs = Date.now() - start
		Logger.log(`[DependencyGraph] Built graph: ${nodes.size} files, ${this.countEdges(reverseDeps)} edges in ${this.buildTimeMs}ms`)
		return nodes.size
	}

	/** Returns true if the graph has been built. */
	isBuilt(): boolean {
		return this.data !== null
	}

	/** Get all files that depend on the given file (direct + transitive). */
	getDependents(filePath: string): string[] {
		if (!this.data) return []
		const normalized = this.normalizePath(filePath)
		const visited = new Set<string>()
		const result: string[] = []

		const collect = (current: string) => {
			const direct = this.data!.reverseDeps.get(current) ?? []
			for (const dep of direct) {
				if (!visited.has(dep)) {
					visited.add(dep)
					result.push(dep)
					collect(dep)
				}
			}
		}
		collect(normalized)
		return result
	}

	/** Get direct imports of a file. */
	getImports(filePath: string): ImportEntry[] {
		if (!this.data) return []
		const normalized = this.normalizePath(filePath)
		return this.data.nodes.get(normalized)?.imports ?? []
	}

	/** Get files that directly import the given file. */
	getDirectDependents(filePath: string): string[] {
		if (!this.data) return []
		const normalized = this.normalizePath(filePath)
		return this.data!.reverseDeps.get(normalized) ?? []
	}

	/** Get the full graph data (for advanced analysis). */
	getData(): DependencyGraphData | null {
		return this.data
	}

	/** Get build statistics. */
	getStats(): { files: number; edges: number; buildTimeMs: number } {
		if (!this.data) return { files: 0, edges: 0, buildTimeMs: 0 }
		return {
			files: this.data.nodes.size,
			edges: this.countEdges(this.data.reverseDeps),
			buildTimeMs: this.buildTimeMs,
		}
	}

	// ---------------------------------------------------------------------------
	// Internal methods
	// ---------------------------------------------------------------------------

	private async scanDirectory(
		dir: string,
		nodes: Map<string, FileNode>,
		reverseDeps: Map<string, string[]>,
	): Promise<void> {
		let entries: fsSync.Dirent[]
		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue
				await this.scanDirectory(fullPath, nodes, reverseDeps)
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name)
				if (!SCANNABLE_EXTENSIONS.has(ext)) continue

				const node = await this.parseFile(fullPath)
				if (node) {
					nodes.set(this.normalizePath(fullPath), node)

					// Build reverse deps
					for (const imp of node.imports) {
						if (imp.resolvedPath) {
							const normalizedTarget = this.normalizePath(imp.resolvedPath)
							const existing = reverseDeps.get(normalizedTarget) ?? []
							existing.push(this.normalizePath(fullPath))
							reverseDeps.set(normalizedTarget, existing)
						}
					}
				}
			}
		}
	}

	private async parseFile(fullPath: string): Promise<FileNode | null> {
		try {
			const content = await fs.readFile(fullPath, "utf-8")
			if (content.length > 512 * 1024) return null // skip very large files

			const imports = await this.extractImports(content, fullPath)
			const exports = this.extractExports(content)

			return {
				filePath: fullPath,
				relativePath: path.relative(this.workspaceRoot, fullPath),
				imports,
				exports,
			}
		} catch {
			return null
		}
	}

	private async extractImports(content: string, sourceFile: string): Promise<ImportEntry[]> {
		const results: ImportEntry[] = []
		const seen = new Set<string>()

		for (const pattern of IMPORT_PATTERNS) {
			pattern.lastIndex = 0
			let match: RegExpExecArray | null
			while ((match = pattern.exec(content)) !== null) {
				const specifier = match[1]
				if (seen.has(specifier)) continue
				seen.add(specifier)

				const type = this.classifyImport(specifier)
				const resolvedPath = type === "package" ? null : await this.resolveImport(specifier, sourceFile)

				results.push({ specifier, resolvedPath, type })
			}
		}

		return results
	}

	private extractExports(content: string): string[] {
		const results: string[] = []
		const seen = new Set<string>()

		for (const pattern of EXPORT_PATTERNS) {
			pattern.lastIndex = 0
			let match: RegExpExecArray | null
			while ((match = pattern.exec(content)) !== null) {
				if (match[1]) {
					// Named export list: { A, B, C }
					for (const name of match[1].split(",")) {
						const trimmed = name.trim().split(/\s+as\s+/)[0].trim()
						if (trimmed && !seen.has(trimmed)) {
							seen.add(trimmed)
							results.push(trimmed)
						}
					}
				}
			}
		}

		return results
	}

	private classifyImport(specifier: string): ImportEntry["type"] {
		if (specifier.startsWith(".") || specifier.startsWith("/")) {
			return specifier.startsWith(".") ? "relative" : "absolute"
		}
		// Check if it's a scoped package (@scope/name) or simple package (name)
		if (/^@?[\w-]+\/?[\w-]*/.test(specifier)) {
			return "package"
		}
		return "unknown"
	}

	private async resolveImport(specifier: string, sourceFile: string): Promise<string | null> {
		const sourceDir = path.dirname(sourceFile)

		// Try relative resolution
		const candidates = [
			specifier,
			`${specifier}.ts`,
			`${specifier}.tsx`,
			`${specifier}.js`,
			`${specifier}.jsx`,
			`${specifier}.mjs`,
			`${specifier}/index.ts`,
			`${specifier}/index.tsx`,
			`${specifier}/index.js`,
			`${specifier}/index.jsx`,
		]

		for (const candidate of candidates) {
			const resolved = path.resolve(sourceDir, candidate)
			try {
				const stat = await fs.stat(resolved)
				if (stat.isFile()) {
					return resolved
				}
			} catch {
				// File doesn't exist, try next candidate
			}
		}

		return null
	}

	private normalizePath(fullPath: string): string {
		return path.relative(this.workspaceRoot, fullPath).replace(/\\/g, "/")
	}

	private countEdges(reverseDeps: Map<string, string[]>): number {
		let count = 0
		for (const deps of reverseDeps.values()) {
			count += deps.length
		}
		return count
	}
}

// ---------------------------------------------------------------------------
// Singleton access
// ---------------------------------------------------------------------------

let graphInstance: DependencyGraph | null = null

export function getDependencyGraph(workspaceRoot: string): DependencyGraph {
	if (!graphInstance || graphInstance["workspaceRoot"] !== workspaceRoot) {
		graphInstance = new DependencyGraph(workspaceRoot)
	}
	return graphInstance
}

export function clearDependencyGraph(): void {
	graphInstance = null
}
