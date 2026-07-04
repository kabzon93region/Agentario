import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	AGENTARIO_HOME_DIR_NAME,
	LEGACY_CLINE_HOME_DIR_NAME,
	resolveClineDataDir,
} from "../storage/paths"

export const INDEX_STORE_VERSION = 2

export type IndexedFileStatus = "pending" | "indexed" | "partial" | "skipped" | "error"

export interface IndexedChunk {
	text: string
	embedding: number[]
}

export interface IndexedFileRecord {
	path: string
	status: IndexedFileStatus
	size: number
	mtimeMs: number
	chunks: IndexedChunk[]
	chunkCount?: number
	embeddingCount?: number
	error?: string
}

export interface IndexFileManifestEntry {
	path: string
	status: IndexedFileStatus
	size: number
	mtimeMs: number
	chunkCount: number
	embeddingCount: number
	error?: string
	fileKey: string
}

export interface IndexMeta {
	version: number
	workspacePath: string
	embeddingModel: string
	baseUrl: string
	updatedAtMs: number
	lastError?: string
	files: IndexFileManifestEntry[]
}

export interface SemanticSearchIndex {
	embeddingModel: string
	baseUrl: string
	files: Array<{
		path: string
		status: string
		chunks: IndexedChunk[]
	}>
}

function getAgentarioDataDir(): string {
	return resolveClineDataDir()
}

function getIndexesRoots(): string[] {
	const primary = path.join(getAgentarioDataDir(), "indexes")
	const candidates = [
		primary,
		path.join(os.homedir(), AGENTARIO_HOME_DIR_NAME, "data", "indexes"),
		path.join(os.homedir(), LEGACY_CLINE_HOME_DIR_NAME, "data", "indexes"),
	]
	const seen = new Set<string>()
	return candidates.filter((candidate) => {
		const key = normalizeWorkspacePath(candidate)
		if (seen.has(key)) {
			return false
		}
		seen.add(key)
		return true
	})
}

export function normalizeWorkspacePath(workspacePath: string): string {
	let normalized = path.normalize(workspacePath.trim()).replace(/\\/g, "/").toLowerCase()
	if (normalized.length > 1 && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

export function workspaceIndexHash(workspacePath: string): string {
	return createHash("sha1").update(workspacePath.toLowerCase()).digest("hex").slice(0, 16)
}

function workspaceIndexHashCandidates(workspacePath: string): string[] {
	const hashes = new Set<string>()
	hashes.add(workspaceIndexHash(workspacePath))
	hashes.add(
		createHash("sha1").update(normalizeWorkspacePath(workspacePath)).digest("hex").slice(0, 16),
	)
	return [...hashes]
}

async function buildWorkspacePathVariants(workspacePath: string): Promise<Set<string>> {
	const variants = new Set<string>()
	const add = (value: string) => {
		const trimmed = value.trim()
		if (!trimmed) {
			return
		}
		variants.add(normalizeWorkspacePath(trimmed))
		variants.add(normalizeWorkspacePath(path.normalize(trimmed)))
	}
	add(workspacePath)
	try {
		add(await fs.realpath(workspacePath))
	} catch {
		// workspace path may be unavailable
	}
	return variants
}

function workspacePathMatches(metaPath: string, targetVariants: Set<string>): boolean {
	const normalized = normalizeWorkspacePath(metaPath)
	if (targetVariants.has(normalized)) {
		return true
	}
	return targetVariants.has(normalizeWorkspacePath(path.normalize(metaPath)))
}

export function getIndexDir(workspacePath: string): string {
	return path.join(getAgentarioDataDir(), "indexes", workspaceIndexHash(workspacePath))
}

export function getLegacyIndexFilePath(workspacePath: string): string {
	return path.join(getAgentarioDataDir(), "indexes", `${workspaceIndexHash(workspacePath)}.embeddings.json`)
}

export function getIndexMetaPath(workspacePath: string): string {
	return path.join(getIndexDir(workspacePath), "meta.json")
}

export function getIndexFilesDirForHash(hash: string): string {
	return path.join(getAgentarioDataDir(), "indexes", hash, "files")
}

async function findShardedIndexForWorkspace(
	workspacePath: string,
): Promise<{ hash: string; meta: IndexMeta; indexesRoot: string } | undefined> {
	const targetVariants = await buildWorkspacePathVariants(workspacePath)

	for (const indexesRoot of getIndexesRoots()) {
		for (const primaryHash of workspaceIndexHashCandidates(workspacePath)) {
			try {
				const meta = JSON.parse(
					await fs.readFile(path.join(indexesRoot, primaryHash, "meta.json"), "utf8"),
				) as IndexMeta
				return { hash: primaryHash, meta, indexesRoot }
			} catch {
				// try next hash/root
			}
		}

		try {
			const entries = await fs.readdir(indexesRoot, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue
				}
				try {
					const meta = JSON.parse(
						await fs.readFile(path.join(indexesRoot, entry.name, "meta.json"), "utf8"),
					) as IndexMeta
					if (workspacePathMatches(meta.workspacePath, targetVariants)) {
						return { hash: entry.name, meta, indexesRoot }
					}
				} catch {
					// not an index directory
				}
			}
		} catch {
			// indexes root missing
		}
	}
	return undefined
}

async function findLegacyIndexForWorkspace(workspacePath: string): Promise<{
	hash: string
	data: NonNullable<Awaited<ReturnType<typeof readLegacyIndexFile>>>
	indexesRoot: string
} | undefined> {
	const targetVariants = await buildWorkspacePathVariants(workspacePath)

	for (const indexesRoot of getIndexesRoots()) {
		for (const primaryHash of workspaceIndexHashCandidates(workspacePath)) {
			try {
				const raw = await fs.readFile(path.join(indexesRoot, `${primaryHash}.embeddings.json`), "utf8")
				const data = JSON.parse(raw) as NonNullable<Awaited<ReturnType<typeof readLegacyIndexFile>>>
				return { hash: primaryHash, data, indexesRoot }
			} catch {
				// try next hash/root
			}
		}

		try {
			const entries = await fs.readdir(indexesRoot, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isFile() || !entry.name.endsWith(".embeddings.json")) {
					continue
				}
				try {
					const raw = await fs.readFile(path.join(indexesRoot, entry.name), "utf8")
					const parsed = JSON.parse(raw) as {
						workspacePath?: string
					}
					if (parsed.workspacePath && workspacePathMatches(parsed.workspacePath, targetVariants)) {
						const hash = entry.name.replace(/\.embeddings\.json$/, "")
						const data = JSON.parse(raw) as NonNullable<Awaited<ReturnType<typeof readLegacyIndexFile>>>
						return { hash, data, indexesRoot }
					}
				} catch {
					// skip
				}
			}
		} catch {
			// indexes root missing
		}
	}

	return undefined
}

export function fileKeyForPath(relativePath: string): string {
	return createHash("sha1").update(relativePath).digest("hex").slice(0, 16)
}

function manifestFromRecord(record: IndexedFileRecord): IndexFileManifestEntry {
	return {
		path: record.path,
		status: record.status,
		size: record.size,
		mtimeMs: record.mtimeMs,
		chunkCount: record.chunks.length,
		embeddingCount: record.chunks.filter((chunk) => chunk.embedding.length > 0).length,
		error: record.error,
		fileKey: fileKeyForPath(record.path),
	}
}

function summaryFromManifest(entry: IndexFileManifestEntry): IndexedFileRecord {
	return {
		path: entry.path,
		status: entry.status,
		size: entry.size,
		mtimeMs: entry.mtimeMs,
		chunks: [],
		chunkCount: entry.chunkCount,
		embeddingCount: entry.embeddingCount,
		error: entry.error,
	}
}

export async function getIndexDiskSizeBytes(workspacePath: string): Promise<number> {
	let total = 0
	const sharded = await findShardedIndexForWorkspace(workspacePath)
	if (sharded) {
		const indexDir = path.join(sharded.indexesRoot, sharded.hash)
		try {
			const walk = async (dir: string): Promise<void> => {
				const entries = await fs.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name)
					if (entry.isDirectory()) {
						await walk(fullPath)
					} else if (entry.isFile()) {
						const stat = await fs.stat(fullPath)
						total += stat.size
					}
				}
			}
			await walk(indexDir)
		} catch {
			// missing index dir
		}
		return total
	}

	const legacyMatch = await findLegacyIndexForWorkspace(workspacePath)
	if (legacyMatch) {
		try {
			const stat = await fs.stat(
				path.join(legacyMatch.indexesRoot, `${legacyMatch.hash}.embeddings.json`),
			)
			return stat.size
		} catch {
			return 0
		}
	}
	return 0
}

export async function readIndexMeta(workspacePath: string): Promise<IndexMeta | undefined> {
	try {
		const raw = await fs.readFile(getIndexMetaPath(workspacePath), "utf8")
		return JSON.parse(raw) as IndexMeta
	} catch {
		return undefined
	}
}

async function readLegacyIndexFile(workspacePath: string): Promise<{
	workspacePath: string
	embeddingModel: string
	baseUrl: string
	updatedAtMs: number
	lastError?: string
	files: IndexedFileRecord[]
} | undefined> {
	try {
		const raw = await fs.readFile(getLegacyIndexFilePath(workspacePath), "utf8")
		return JSON.parse(raw) as {
			workspacePath: string
			embeddingModel: string
			baseUrl: string
			updatedAtMs: number
			lastError?: string
			files: IndexedFileRecord[]
		}
	} catch {
		return undefined
	}
}

export async function writeIndexMeta(workspacePath: string, meta: IndexMeta): Promise<void> {
	const indexDir = getIndexDir(workspacePath)
	await fs.mkdir(indexDir, { recursive: true })
	await fs.writeFile(getIndexMetaPath(workspacePath), JSON.stringify(meta), "utf8")
}

export async function writeFileRecord(workspacePath: string, record: IndexedFileRecord): Promise<void> {
	const filesDir = getIndexFilesDir(workspacePath)
	await fs.mkdir(filesDir, { recursive: true })
	const fileKey = fileKeyForPath(record.path)
	await fs.writeFile(path.join(filesDir, `${fileKey}.json`), JSON.stringify(record), "utf8")
}

export function getIndexFilesDir(workspacePath: string): string {
	return path.join(getIndexDir(workspacePath), "files")
}

export async function readFileRecordForHash(
	hash: string,
	fileKey: string,
): Promise<IndexedFileRecord | undefined> {
	try {
		const raw = await fs.readFile(path.join(getIndexFilesDirForHash(hash), `${fileKey}.json`), "utf8")
		return JSON.parse(raw) as IndexedFileRecord
	} catch {
		return undefined
	}
}

export async function readFileRecord(workspacePath: string, fileKey: string): Promise<IndexedFileRecord | undefined> {
	const sharded = await findShardedIndexForWorkspace(workspacePath)
	const hash = sharded?.hash ?? workspaceIndexHash(workspacePath)
	return readFileRecordForHash(hash, fileKey)
}

export async function readIndexSummaries(workspacePath: string): Promise<{
	meta: IndexMeta
	files: IndexedFileRecord[]
} | undefined> {
	const sharded = await findShardedIndexForWorkspace(workspacePath)
	if (sharded) {
		return {
			meta: sharded.meta,
			files: sharded.meta.files.map(summaryFromManifest),
		}
	}

	const legacyMatch = await findLegacyIndexForWorkspace(workspacePath)
	if (!legacyMatch) {
		return undefined
	}
	const legacy = legacyMatch.data
	const legacyMeta: IndexMeta = {
		version: 1,
		workspacePath: legacy.workspacePath,
		embeddingModel: legacy.embeddingModel,
		baseUrl: legacy.baseUrl,
		updatedAtMs: legacy.updatedAtMs,
		lastError: legacy.lastError,
		files: (legacy.files ?? []).map(manifestFromRecord),
	}
	return {
		meta: legacyMeta,
		files: (legacy.files ?? []).map((file) => ({
			path: file.path,
			status: file.status,
			size: file.size,
			mtimeMs: file.mtimeMs,
			chunks: [],
			chunkCount: file.chunks.length,
			embeddingCount: file.chunks.filter((chunk) => chunk.embedding.length > 0).length,
			error: file.error,
		})),
	}
}

export async function deleteIndex(workspacePath: string): Promise<void> {
	await deleteAllIndexesForWorkspace(workspacePath)
}

/** Removes sharded + legacy index files for a workspace (matches by path, not hash only). */
export async function deleteAllIndexesForWorkspace(workspacePath: string): Promise<void> {
	const targetVariants = await buildWorkspacePathVariants(workspacePath)
	const stored = await readIndexSummaries(workspacePath)
	if (stored?.meta.workspacePath) {
		targetVariants.add(normalizeWorkspacePath(stored.meta.workspacePath))
		targetVariants.add(normalizeWorkspacePath(path.normalize(stored.meta.workspacePath)))
	}

	const sharded = await findShardedIndexForWorkspace(workspacePath)
	const legacy = await findLegacyIndexForWorkspace(workspacePath)

	const removeHashFromRoot = async (indexesRoot: string, hash: string) => {
		await fs.rm(path.join(indexesRoot, hash), { force: true, recursive: true })
		await fs.rm(path.join(indexesRoot, `${hash}.embeddings.json`), { force: true })
	}

	for (const indexesRoot of getIndexesRoots()) {
		const hashesToRemove = new Set<string>()
		for (const hash of workspaceIndexHashCandidates(workspacePath)) {
			hashesToRemove.add(hash)
		}
		if (sharded?.indexesRoot === indexesRoot) {
			hashesToRemove.add(sharded.hash)
		}
		if (legacy?.indexesRoot === indexesRoot) {
			hashesToRemove.add(legacy.hash)
		}

		const queueHash = (hash: string) => {
			if (hash && /^[a-f0-9]{16}$/.test(hash)) {
				hashesToRemove.add(hash)
			}
		}

		try {
			const entries = await fs.readdir(indexesRoot, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory()) {
					try {
						const metaRaw = await fs.readFile(path.join(indexesRoot, entry.name, "meta.json"), "utf8")
						const meta = JSON.parse(metaRaw) as IndexMeta
						if (workspacePathMatches(meta.workspacePath, targetVariants)) {
							queueHash(entry.name)
						}
					} catch {
						// not a sharded index dir
					}
					continue
				}
				if (!entry.isFile() || !entry.name.endsWith(".embeddings.json")) {
					continue
				}
				try {
					const parsed = JSON.parse(await fs.readFile(path.join(indexesRoot, entry.name), "utf8")) as {
						workspacePath?: string
					}
					if (parsed.workspacePath && workspacePathMatches(parsed.workspacePath, targetVariants)) {
						queueHash(entry.name.replace(/\.embeddings\.json$/, ""))
					}
				} catch {
					// corrupt legacy file — still try primary hash below
				}
			}
		} catch {
			// indexes root may not exist yet
		}

		for (const hash of hashesToRemove) {
			await removeHashFromRoot(indexesRoot, hash)
		}
	}

	const stillSharded = await findShardedIndexForWorkspace(workspacePath)
	if (stillSharded) {
		await removeHashFromRoot(stillSharded.indexesRoot, stillSharded.hash)
	}
	const stillLegacy = await findLegacyIndexForWorkspace(workspacePath)
	if (stillLegacy) {
		await removeHashFromRoot(stillLegacy.indexesRoot, stillLegacy.hash)
	}
}

export async function removeStaleFileRecords(workspacePath: string, activePaths: Set<string>): Promise<void> {
	const meta = await readIndexMeta(workspacePath)
	if (!meta) {
		return
	}
	const filesDir = getIndexFilesDir(workspacePath)
	for (const entry of meta.files) {
		if (!activePaths.has(entry.path)) {
			await fs.rm(path.join(filesDir, `${entry.fileKey}.json`), { force: true })
		}
	}
}

export async function loadSemanticSearchIndex(workspacePath: string): Promise<SemanticSearchIndex | undefined> {
	const sharded = await findShardedIndexForWorkspace(workspacePath)
	if (sharded) {
		const files: SemanticSearchIndex["files"] = []
		for (const entry of sharded.meta.files) {
			if (entry.status !== "indexed" && entry.status !== "partial") {
				continue
			}
			const record = await readFileRecordForHash(sharded.hash, entry.fileKey)
			if (!record) {
				continue
			}
			files.push({
				path: record.path,
				status: record.status,
				chunks: record.chunks,
			})
		}
		if (files.length === 0 && sharded.meta.files.length === 0) {
			return undefined
		}
		return {
			embeddingModel: sharded.meta.embeddingModel,
			baseUrl: sharded.meta.baseUrl,
			files,
		}
	}

	const legacyMatch = await findLegacyIndexForWorkspace(workspacePath)
	if (!legacyMatch?.data.files?.length) {
		return undefined
	}
	const legacy = legacyMatch.data
	return {
		embeddingModel: legacy.embeddingModel,
		baseUrl: legacy.baseUrl,
		files: legacy.files.map((file) => ({
			path: file.path,
			status: file.status,
			chunks: file.chunks,
		})),
	}
}
