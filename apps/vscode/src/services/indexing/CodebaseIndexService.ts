import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import * as vscode from "vscode"
import {
	batchChunksForEmbedding,
	CHUNK_CHARS,
	CHUNK_OVERLAP_CHARS,
	CHUNK_STRIDE_CHARS,
	chunkTextForEmbedding,
	deleteAllIndexesForWorkspace,
	EMBEDDING_BATCH_TOKEN_BUDGET,
	EMBEDDING_CONTEXT_TOKENS,
	fileKeyForPath,
	getIndexDir,
	getIndexDiskSizeBytes,
	IndexMeta,
	IndexedChunk,
	IndexedFileRecord,
	INDEX_STORE_VERSION,
	LmStudioEmbeddingClient,
	readIndexMeta,
	readIndexSummaries,
	removeStaleFileRecords,
	writeFileRecord,
	writeIndexMeta,
} from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234"
/** Max bytes read from disk per file for binary/structured formats (JSON, SQL). */
const MAX_READ_BYTES = 2 * 1024 * 1024

/** Text/code formats: read entire file without size limit. */
const UNLIMITED_READ_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".md",
	".mdx",
	".css",
	".scss",
	".html",
	".py",
	".ps1",
	".sh",
	".yml",
	".yaml",
	".toml",
	".go",
	".rs",
	".java",
	".kt",
])

const INCLUDE_EXTENSIONS = new Set([
	...UNLIMITED_READ_EXTENSIONS,
	".json",
	".sql",
])

const EXCLUDE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".next",
	".turbo",
	".cache",
	"target",
	"release",
	"venv",
	".venv",
	"env",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".tox",
	"site-packages",
	".gradle",
	".cxx",
	"Pods",
	"DerivedData",
	".dart_tool",
	"xcuserdata",
	"vendor",
])

const EXCLUDE_BASENAMES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"poetry.lock",
	"Pipfile.lock",
	"Gemfile.lock",
	"Podfile.lock",
	"composer.lock",
])

export type IndexedFileStatus = IndexedFileRecord["status"]

export interface CodebaseIndexState {
	workspacePath: string
	indexPath: string
	embeddingModel: string
	baseUrl: string
	updatedAtMs: number
	isIndexing: boolean
	lastError?: string
	indexSizeBytes: number
	progressCurrent: number
	progressTotal: number
	progressPath?: string
	files: IndexedFileRecord[]
}

function getWorkspacePath(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

type CodebaseIndexMode = "local" | "local-ai" | "remote-ai"
type CodebaseIndexAiBackend = "lmstudio" | "ollama"

function getCodebaseIndexSettings(): {
	mode: CodebaseIndexMode
	backend: CodebaseIndexAiBackend
	baseUrl: string
	embeddingModel: string
} {
	try {
		const sm = StateManager.get()
		const mode = (sm.getGlobalSettingsKey("codebaseIndexMode") ?? "local") as CodebaseIndexMode
		const backend = (sm.getGlobalSettingsKey("codebaseIndexAiBackend") ?? "lmstudio") as CodebaseIndexAiBackend
		const customBaseUrl = sm.getGlobalSettingsKey("codebaseIndexBaseUrl")?.trim()
		const embeddingModel =
			sm.getGlobalSettingsKey("codebaseIndexEmbeddingModelId")?.trim() ||
			sm.getApiConfiguration().lmStudioEmbeddingModelId?.trim() ||
			DEFAULT_EMBEDDING_MODEL
		const defaultLocalLm = sm.getApiConfiguration().lmStudioBaseUrl?.trim() || DEFAULT_LM_STUDIO_BASE_URL
		const defaultOllama = "http://127.0.0.1:11434"

		if (mode === "local") {
			return { mode, backend, baseUrl: "local", embeddingModel: "none" }
		}

		let baseUrl = defaultLocalLm
		if (mode === "local-ai") {
			baseUrl = backend === "ollama" ? customBaseUrl || defaultOllama : customBaseUrl || defaultLocalLm
		} else {
			baseUrl = customBaseUrl || (backend === "ollama" ? defaultOllama : defaultLocalLm)
		}
		return { mode, backend, baseUrl, embeddingModel }
	} catch {
		return { mode: "local", backend: "lmstudio", baseUrl: "local", embeddingModel: DEFAULT_EMBEDDING_MODEL }
	}
}

function getBaseUrl(): string {
	return getCodebaseIndexSettings().baseUrl
}

function getEmbeddingModel(): string {
	return getCodebaseIndexSettings().embeddingModel
}

async function requestOllamaEmbeddings(baseUrl: string, model: string, inputs: string[]): Promise<number[][]> {
	const endpoint = `${baseUrl.replace(/\/$/, "")}/api/embeddings`
	const body =
		inputs.length === 1
			? JSON.stringify({ model, prompt: inputs[0] })
			: JSON.stringify({ model, input: inputs })
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	})
	if (!response.ok) {
		throw new Error(`Ollama embeddings failed (${response.status})`)
	}
	const payload = (await response.json()) as { embedding?: number[]; embeddings?: number[][]; data?: Array<{ embedding: number[] }> }
	if (Array.isArray(payload.embeddings)) {
		return payload.embeddings
	}
	if (Array.isArray(payload.data)) {
		return payload.data.map((entry) => entry.embedding)
	}
	if (Array.isArray(payload.embedding)) {
		return [payload.embedding]
	}
	throw new Error("Ollama embeddings response missing vectors")
}

function toRelative(workspacePath: string, filePath: string): string {
	return path.relative(workspacePath, filePath).replace(/\\/g, "/")
}

function shouldIndexFile(relativePath: string): boolean {
	const segments = relativePath.split("/")
	if (segments.some((segment) => EXCLUDE_DIRS.has(segment))) {
		return false
	}
	const basename = path.posix.basename(relativePath)
	if (EXCLUDE_BASENAMES.has(basename)) {
		return false
	}
	return INCLUDE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

async function walkFiles(workspacePath: string, dir = workspacePath, result: string[] = []): Promise<string[]> {
	let entries: Dirent[]
	try {
		entries = await fs.readdir(dir, { withFileTypes: true })
	} catch {
		return result
	}
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (!EXCLUDE_DIRS.has(entry.name)) {
				await walkFiles(workspacePath, fullPath, result)
			}
			continue
		}
		if (entry.isFile()) {
			const relativePath = toRelative(workspacePath, fullPath)
			if (shouldIndexFile(relativePath)) {
				result.push(fullPath)
			}
		}
	}
	return result
}

async function readTextForIndexing(filePath: string, fileSize: number): Promise<{ text: string; readTruncated: boolean }> {
	const ext = path.extname(filePath).toLowerCase()
	const isUnlimited = UNLIMITED_READ_EXTENSIONS.has(ext)

	// Text/code formats: read entire file
	if (isUnlimited) {
		return { text: await fs.readFile(filePath, "utf8"), readTruncated: false }
	}

	// Binary/structured formats (JSON, SQL): apply size limit
	if (fileSize <= MAX_READ_BYTES) {
		return { text: await fs.readFile(filePath, "utf8"), readTruncated: false }
	}

	const handle = await fs.open(filePath, "r")
	try {
		const buffer = Buffer.alloc(MAX_READ_BYTES)
		const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0)
		let end = bytesRead
		while (end > 0 && (buffer[end - 1]! & 0xc0) === 0x80) {
			end--
		}
		return { text: buffer.subarray(0, end).toString("utf8"), readTruncated: true }
	} finally {
		await handle.close()
	}
}

function partialIndexNote(chunkCount: number, readTruncated: boolean): string {
	const approxKb = Math.round((chunkCount * CHUNK_CHARS) / 1024)
	const parts = [`Indexed ${chunkCount} chunk(s) (~${approxKb} KB)`]
	if (readTruncated) {
		parts.push(`file read capped at ${Math.round(MAX_READ_BYTES / 1024)} KB`)
	}
	return parts.join("; ")
}

async function requestEmbeddings(client: LmStudioEmbeddingClient, inputs: string[]): Promise<number[][]> {
	const result = await client.embed(inputs)
	return result.embeddings
}

function manifestFromRecord(record: IndexedFileRecord) {
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

function summarize(
	workspacePath: string,
	meta: IndexMeta | undefined,
	files: IndexedFileRecord[],
	isIndexing: boolean,
	progress: { current: number; total: number; path?: string; indexSizeBytes: number },
	lastError?: string,
): CodebaseIndexState {
	const baseUrl = meta?.baseUrl ?? getBaseUrl()
	const embeddingModel = meta?.embeddingModel ?? getEmbeddingModel()
	return {
		workspacePath,
		indexPath: getIndexDir(workspacePath),
		embeddingModel,
		baseUrl,
		updatedAtMs: meta?.updatedAtMs ?? 0,
		isIndexing,
		lastError: lastError ?? meta?.lastError,
		indexSizeBytes: progress.indexSizeBytes,
		progressCurrent: progress.current,
		progressTotal: progress.total,
		progressPath: progress.path,
		files,
	}
}

class CodebaseIndexServiceImpl {
	private indexing = false
	private abortRequested = false
	private lastError: string | undefined
	private progress = { current: 0, total: 0, path: undefined as string | undefined, indexSizeBytes: 0 }

	private async waitForIndexingToStop(timeoutMs = 30_000): Promise<void> {
		const deadline = Date.now() + timeoutMs
		while (this.indexing && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	async getStatus(): Promise<CodebaseIndexState> {
		const workspacePath = getWorkspacePath()
		const stored = await readIndexSummaries(workspacePath)
		const indexSizeBytes = this.indexing ? this.progress.indexSizeBytes : await getIndexDiskSizeBytes(workspacePath)
		return summarize(
			workspacePath,
			stored?.meta,
			stored?.files ?? [],
			this.indexing,
			{
				current: this.progress.current,
				total: this.progress.total,
				path: this.progress.path,
				indexSizeBytes,
			},
			this.lastError,
		)
	}

	async clear(): Promise<CodebaseIndexState> {
		const workspacePath = getWorkspacePath()
		Logger.info(`[CodebaseIndex] Clearing index for workspace: ${workspacePath}`)
		this.abortRequested = true
		await this.waitForIndexingToStop()
		Logger.info(`[CodebaseIndex] Indexing stopped, deleting files...`)

		const stored = await readIndexSummaries(workspacePath)
		const pathsToClear = new Set<string>([workspacePath])
		if (stored?.meta.workspacePath) {
			pathsToClear.add(stored.meta.workspacePath)
		}
		for (const workspace of pathsToClear) {
			await deleteAllIndexesForWorkspace(workspace)
		}

		const remaining = await readIndexSummaries(workspacePath)
		if (remaining) {
			Logger.error(
				`[CodebaseIndex] Index still present after clear for ${workspacePath} (files=${remaining.files.length})`,
			)
		} else {
			Logger.info(`[CodebaseIndex] Index files deleted`)
		}

		this.lastError = undefined
		this.abortRequested = false
		this.progress = { current: 0, total: 0, path: undefined, indexSizeBytes: 0 }
		Logger.info(`[CodebaseIndex] Cleared index for workspace ${workspacePath}`)
		return summarize(workspacePath, undefined, [], false, this.progress)
	}

	async rebuild(): Promise<CodebaseIndexState> {
		return this.build({ changedOnly: false })
	}

	async updateNew(): Promise<CodebaseIndexState> {
		return this.build({ changedOnly: true })
	}

	private async persistFileAndMeta(
		workspacePath: string,
		meta: IndexMeta,
		record: IndexedFileRecord,
	): Promise<void> {
		await writeFileRecord(workspacePath, record)
		const existingIndex = meta.files.findIndex((entry) => entry.path === record.path)
		const manifestEntry = manifestFromRecord(record)
		if (existingIndex >= 0) {
			meta.files[existingIndex] = manifestEntry
		} else {
			meta.files.push(manifestEntry)
		}
		meta.updatedAtMs = Date.now()
		await writeIndexMeta(workspacePath, meta)
	}

	private async build(options: { changedOnly: boolean }): Promise<CodebaseIndexState> {
		if (this.indexing) {
			return this.getStatus()
		}
		const workspacePath = getWorkspacePath()
		const indexSettings = getCodebaseIndexSettings()
		const baseUrl = indexSettings.baseUrl
		const configuredEmbeddingModel = indexSettings.embeddingModel
		const useLocalManifestOnly = indexSettings.mode === "local"

		let embeddingModel = configuredEmbeddingModel
		let embeddingClient: LmStudioEmbeddingClient | undefined
		let requestEmbeddingsFn: (inputs: string[]) => Promise<number[][]>

		if (useLocalManifestOnly) {
			requestEmbeddingsFn = async () => []
		} else if (indexSettings.backend === "ollama") {
			requestEmbeddingsFn = async (inputs) => requestOllamaEmbeddings(baseUrl, configuredEmbeddingModel, inputs)
			Logger.info(`[CodebaseIndex] Using Ollama embeddings at ${baseUrl} with model "${configuredEmbeddingModel}"`)
		} else {
			embeddingClient = new LmStudioEmbeddingClient(baseUrl, configuredEmbeddingModel, fetch)
			try {
				const initialized = await embeddingClient.initialize()
				embeddingModel = initialized.modelId
				Logger.info(
					`[CodebaseIndex] Using LM Studio embeddings via ${initialized.endpoint} with model "${initialized.modelId}" ` +
						`(context ${EMBEDDING_CONTEXT_TOKENS} tok, batch ${EMBEDDING_BATCH_TOKEN_BUDGET} tok, ` +
						`chunk ${CHUNK_CHARS} chars / overlap ${CHUNK_OVERLAP_CHARS} / stride ${CHUNK_STRIDE_CHARS})`,
				)
			} catch (error) {
				this.lastError = error instanceof Error ? error.message : String(error)
				throw error
			}
			requestEmbeddingsFn = async (inputs) => requestEmbeddings(embeddingClient!, inputs)
		}

		let existingMeta = options.changedOnly ? await readIndexMeta(workspacePath) : undefined
		if (existingMeta && existingMeta.embeddingModel !== embeddingModel) {
			existingMeta = undefined
		}
		if (!options.changedOnly) {
			await deleteAllIndexesForWorkspace(workspacePath)
		}

		const existingByPath = new Map((existingMeta?.files ?? []).map((file) => [file.path, file]))
		const allFilePaths = await walkFiles(workspacePath)
		const activePaths = new Set<string>()

		const meta: IndexMeta = existingMeta ?? {
			version: INDEX_STORE_VERSION,
			workspacePath,
			embeddingModel,
			baseUrl,
			updatedAtMs: Date.now(),
			files: [],
		}
		meta.embeddingModel = embeddingModel
		meta.baseUrl = baseUrl
		meta.lastError = undefined

		this.indexing = true
		this.abortRequested = false
		this.lastError = undefined
		this.progress = {
			current: 0,
			total: allFilePaths.length,
			path: undefined,
			indexSizeBytes: await getIndexDiskSizeBytes(workspacePath),
		}

		const resultFiles: IndexedFileRecord[] = []

		try {
			for (const filePath of allFilePaths) {
				if (this.abortRequested) {
					break
				}
				const stat = await fs.stat(filePath)
				const relativePath = toRelative(workspacePath, filePath)
				activePaths.add(relativePath)
				this.progress.path = relativePath

				const previousManifest = existingByPath.get(relativePath)
				if (
					previousManifest &&
					previousManifest.mtimeMs === stat.mtimeMs &&
					previousManifest.size === stat.size
				) {
					resultFiles.push({
						path: relativePath,
						status: previousManifest.status,
						size: stat.size,
						mtimeMs: stat.mtimeMs,
						chunks: [],
						chunkCount: previousManifest.chunkCount,
						embeddingCount: previousManifest.embeddingCount,
						error: previousManifest.error,
					})
					this.progress.current++
					continue
				}

				let record: IndexedFileRecord
				try {
					const { text, readTruncated } = await readTextForIndexing(filePath, stat.size)
					if (useLocalManifestOnly) {
						record = {
							path: relativePath,
							status: text.trim().length > 0 ? "indexed" : "skipped",
							size: stat.size,
							mtimeMs: stat.mtimeMs,
							chunks: [],
							error: text.trim().length > 0 ? undefined : "No indexable text content",
						}
					} else {
						const chunks = chunkTextForEmbedding(text)
						const indexedChunks: IndexedChunk[] = []
						for (const batch of batchChunksForEmbedding(chunks)) {
							const embeddings = await requestEmbeddingsFn(batch)
							indexedChunks.push(
								...batch.map((chunk, index) => ({ text: chunk, embedding: embeddings[index] ?? [] })),
							)
						}
						const isPartial = indexedChunks.length > 0 && readTruncated
						record = {
							path: relativePath,
							status: indexedChunks.length === 0 ? "skipped" : isPartial ? "partial" : "indexed",
							size: stat.size,
							mtimeMs: stat.mtimeMs,
							chunks: indexedChunks,
							error:
								indexedChunks.length === 0
									? "No indexable text content"
									: isPartial
										? partialIndexNote(indexedChunks.length, readTruncated)
										: undefined,
						}
					}
				} catch (error) {
					record = {
						path: relativePath,
						status: "error",
						size: stat.size,
						mtimeMs: stat.mtimeMs,
						chunks: [],
						error: error instanceof Error ? error.message : String(error),
					}
				}

				await this.persistFileAndMeta(workspacePath, meta, record)
				resultFiles.push({
					...record,
					chunks: [],
					chunkCount: record.chunks.length,
					embeddingCount: record.chunks.filter((chunk) => chunk.embedding.length > 0).length,
				})
				this.progress.current++
				this.progress.indexSizeBytes = await getIndexDiskSizeBytes(workspacePath)
			}

			if (this.abortRequested) {
				await deleteAllIndexesForWorkspace(workspacePath)
				return summarize(workspacePath, undefined, [], false, {
					...this.progress,
					indexSizeBytes: 0,
				})
			}

			meta.files = meta.files.filter((entry) => activePaths.has(entry.path))
			meta.files.sort((a, b) => a.path.localeCompare(b.path))
			meta.updatedAtMs = Date.now()
			await writeIndexMeta(workspacePath, meta)
			await removeStaleFileRecords(workspacePath, activePaths)

			Logger.info(
				`[CodebaseIndex] Index complete: ${meta.files.length} file(s), ${Math.round(this.progress.indexSizeBytes / (1024 * 1024))} MB on disk`,
			)

			return summarize(workspacePath, meta, resultFiles.sort((a, b) => a.path.localeCompare(b.path)), false, this.progress)
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error)
			Logger.error(`[CodebaseIndex] Failed to build index: ${this.lastError}`)
			const stored = await readIndexSummaries(workspacePath)
			return summarize(
				workspacePath,
				stored?.meta,
				stored?.files ?? [],
				false,
				{ ...this.progress, indexSizeBytes: await getIndexDiskSizeBytes(workspacePath) },
				this.lastError,
			)
		} finally {
			this.indexing = false
			this.progress.path = undefined
		}
	}
}

export const CodebaseIndexService = new CodebaseIndexServiceImpl()
