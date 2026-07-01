import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as vscode from "vscode"
import { LmStudioEmbeddingClient } from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234"
/** Max bytes read from disk per file (avoids loading huge files into memory). */
const MAX_READ_BYTES = 2 * 1024 * 1024
const CHUNK_CHARS = 2_000
const MAX_CHUNKS_PER_FILE = 12
const EMBEDDING_BATCH_SIZE = 16

const INCLUDE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
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
])

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
	error?: string
}

export interface CodebaseIndexState {
	workspacePath: string
	indexPath: string
	embeddingModel: string
	baseUrl: string
	updatedAtMs: number
	isIndexing: boolean
	lastError?: string
	files: IndexedFileRecord[]
}

type DiskIndex = Omit<CodebaseIndexState, "isIndexing" | "indexPath">

function getWorkspacePath(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

function getAgentarioDataDir(): string {
	return path.join(os.homedir(), ".agentario", "data")
}

function workspaceHash(workspacePath: string): string {
	return createHash("sha1").update(workspacePath.toLowerCase()).digest("hex").slice(0, 16)
}

function getIndexPath(workspacePath: string): string {
	return path.join(getAgentarioDataDir(), "indexes", `${workspaceHash(workspacePath)}.embeddings.json`)
}

function getBaseUrl(): string {
	try {
		return StateManager.get().getApiConfiguration().lmStudioBaseUrl?.trim() || DEFAULT_LM_STUDIO_BASE_URL
	} catch {
		return DEFAULT_LM_STUDIO_BASE_URL
	}
}

function getEmbeddingModel(): string {
	try {
		const configured = StateManager.get().getApiConfiguration().lmStudioEmbeddingModelId?.trim()
		return configured || DEFAULT_EMBEDDING_MODEL
	} catch {
		return DEFAULT_EMBEDDING_MODEL
	}
}

function toRelative(workspacePath: string, filePath: string): string {
	return path.relative(workspacePath, filePath).replace(/\\/g, "/")
}

function shouldIndexFile(relativePath: string): boolean {
	const segments = relativePath.split("/")
	if (segments.some((segment) => EXCLUDE_DIRS.has(segment))) {
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

function chunkText(text: string): { chunks: string[]; truncated: boolean } {
	const normalized = text.replace(/\r\n/g, "\n")
	const chunks: string[] = []
	for (let i = 0; i < normalized.length && chunks.length < MAX_CHUNKS_PER_FILE; i += CHUNK_CHARS) {
		const chunk = normalized.slice(i, i + CHUNK_CHARS).trim()
		if (chunk) {
			chunks.push(chunk)
		}
	}
	const truncated = normalized.length > MAX_CHUNKS_PER_FILE * CHUNK_CHARS
	return { chunks, truncated }
}

async function readTextForIndexing(filePath: string, fileSize: number): Promise<{ text: string; readTruncated: boolean }> {
	if (fileSize <= MAX_READ_BYTES) {
		return { text: await fs.readFile(filePath, "utf8"), readTruncated: false }
	}

	const handle = await fs.open(filePath, "r")
	try {
		const buffer = Buffer.alloc(MAX_READ_BYTES)
		const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0)
		let end = bytesRead
		// Avoid splitting a UTF-8 code point at the read boundary.
		while (end > 0 && (buffer[end - 1]! & 0xc0) === 0x80) {
			end--
		}
		return { text: buffer.subarray(0, end).toString("utf8"), readTruncated: true }
	} finally {
		await handle.close()
	}
}

function partialIndexNote(chunkCount: number, readTruncated: boolean, chunkTruncated: boolean): string {
	const approxKb = Math.round((chunkCount * CHUNK_CHARS) / 1024)
	const parts = [`Indexed first ${chunkCount} chunk(s) (~${approxKb} KB)`]
	if (readTruncated) {
		parts.push(`file read capped at ${Math.round(MAX_READ_BYTES / 1024)} KB`)
	}
	if (chunkTruncated && !readTruncated) {
		parts.push("remainder not embedded")
	}
	return parts.join("; ")
}

async function requestEmbeddings(client: LmStudioEmbeddingClient, inputs: string[]): Promise<number[][]> {
	const result = await client.embed(inputs)
	return result.embeddings
}

async function readIndex(workspacePath: string): Promise<DiskIndex | undefined> {
	try {
		const indexPath = getIndexPath(workspacePath)
		const raw = await fs.readFile(indexPath, "utf8")
		return JSON.parse(raw) as DiskIndex
	} catch {
		return undefined
	}
}

async function writeIndex(workspacePath: string, index: DiskIndex): Promise<void> {
	const indexPath = getIndexPath(workspacePath)
	await fs.mkdir(path.dirname(indexPath), { recursive: true })
	await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8")
}

async function deleteIndex(workspacePath: string): Promise<void> {
	await fs.rm(getIndexPath(workspacePath), { force: true })
}

function summarize(workspacePath: string, index: DiskIndex | undefined, isIndexing: boolean, lastError?: string): CodebaseIndexState {
	const baseUrl = index?.baseUrl ?? getBaseUrl()
	const embeddingModel = index?.embeddingModel ?? getEmbeddingModel()
	return {
		workspacePath,
		indexPath: getIndexPath(workspacePath),
		embeddingModel,
		baseUrl,
		updatedAtMs: index?.updatedAtMs ?? 0,
		isIndexing,
		lastError: lastError ?? index?.lastError,
		files: index?.files ?? [],
	}
}

class CodebaseIndexServiceImpl {
	private indexing = false
	private lastError: string | undefined

	async getStatus(): Promise<CodebaseIndexState> {
		const workspacePath = getWorkspacePath()
		return summarize(workspacePath, await readIndex(workspacePath), this.indexing, this.lastError)
	}

	async clear(): Promise<CodebaseIndexState> {
		const workspacePath = getWorkspacePath()
		await deleteIndex(workspacePath)
		this.lastError = undefined
		return summarize(workspacePath, undefined, this.indexing)
	}

	async rebuild(): Promise<CodebaseIndexState> {
		return this.build({ changedOnly: false })
	}

	async updateNew(): Promise<CodebaseIndexState> {
		return this.build({ changedOnly: true })
	}

	private async build(options: { changedOnly: boolean }): Promise<CodebaseIndexState> {
		if (this.indexing) {
			return this.getStatus()
		}
		const workspacePath = getWorkspacePath()
		const baseUrl = getBaseUrl()
		const configuredEmbeddingModel = getEmbeddingModel()
		const embeddingClient = new LmStudioEmbeddingClient(baseUrl, configuredEmbeddingModel, fetch)
		let embeddingModel = configuredEmbeddingModel
		try {
			const initialized = await embeddingClient.initialize()
			embeddingModel = initialized.modelId
			Logger.info(
				`[CodebaseIndex] Using LM Studio embeddings via ${initialized.endpoint} with model "${initialized.modelId}"`,
			)
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error)
			throw error
		}
		let existing = options.changedOnly ? await readIndex(workspacePath) : undefined
		if (existing && existing.embeddingModel !== embeddingModel) {
			existing = undefined
		}
		const existingByPath = new Map((existing?.files ?? []).map((file) => [file.path, file]))
		const files: IndexedFileRecord[] = []
		this.indexing = true
		this.lastError = undefined
		try {
			for (const filePath of await walkFiles(workspacePath)) {
				const stat = await fs.stat(filePath)
				const relativePath = toRelative(workspacePath, filePath)
				const previous = existingByPath.get(relativePath)
				if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
					files.push(previous)
					continue
				}
				try {
					const { text, readTruncated } = await readTextForIndexing(filePath, stat.size)
					const { chunks, truncated: chunkTruncated } = chunkText(text)
					const indexedChunks: IndexedChunk[] = []
					for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
						const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)
						const embeddings = await requestEmbeddings(embeddingClient, batch)
						indexedChunks.push(...batch.map((chunk, index) => ({ text: chunk, embedding: embeddings[index] ?? [] })))
					}
					const isPartial = indexedChunks.length > 0 && (readTruncated || chunkTruncated)
					files.push({
						path: relativePath,
						status: indexedChunks.length === 0 ? "skipped" : isPartial ? "partial" : "indexed",
						size: stat.size,
						mtimeMs: stat.mtimeMs,
						chunks: indexedChunks,
						error:
							indexedChunks.length === 0
								? "No indexable text content"
								: isPartial
									? partialIndexNote(indexedChunks.length, readTruncated, chunkTruncated)
									: undefined,
					})
				} catch (error) {
					files.push({
						path: relativePath,
						status: "error",
						size: stat.size,
						mtimeMs: stat.mtimeMs,
						chunks: [],
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
			const index: DiskIndex = {
				workspacePath,
				embeddingModel,
				baseUrl,
				updatedAtMs: Date.now(),
				files: files.sort((a, b) => a.path.localeCompare(b.path)),
			}
			await writeIndex(workspacePath, index)
			return summarize(workspacePath, index, false)
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error)
			Logger.error("[CodebaseIndex] Failed to build index:", error)
			return summarize(workspacePath, await readIndex(workspacePath), false, this.lastError)
		} finally {
			this.indexing = false
		}
	}
}

export const CodebaseIndexService = new CodebaseIndexServiceImpl()
