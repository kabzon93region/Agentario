from pathlib import Path

p = Path(r"Z:\T\Agentario\apps\vscode\src\services\indexing\CodebaseIndexService.ts")
text = p.read_text(encoding="utf-8")

old1 = '''const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234"
/** Max bytes read from disk per file for binary/structured formats (JSON, SQL). */
const MAX_READ_BYTES = 2 * 1024 * 1024

/** Text/code formats: read entire file without size limit. */
const UNLIMITED_READ_EXTENSIONS = new Set([
'''

new1 = '''const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"
const DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234"

/** Text/code formats eligible for indexing (full file, no size cap). */
const INCLUDE_EXTENSIONS = new Set([
'''

if old1 not in text:
    raise SystemExit("block1 not found")
text = text.replace(old1, new1, 1)

old2 = '''const INCLUDE_EXTENSIONS = new Set([
	...UNLIMITED_READ_EXTENSIONS,
])

const EXCLUDE_DIRS'''

new2 = "const EXCLUDE_DIRS"

if old2 not in text:
    raise SystemExit("block2 not found")
text = text.replace(old2, new2, 1)

old3 = '''async function readTextForIndexing(filePath: string, fileSize: number): Promise<{ text: string; readTruncated: boolean }> {
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
'''

new3 = '''async function readTextForIndexing(filePath: string): Promise<string> {
	// Indexable files are read fully — no per-file byte cap.
	return fs.readFile(filePath, "utf8")
}
'''

if old3 not in text:
    raise SystemExit("block3 not found")
text = text.replace(old3, new3, 1)

old4 = '''const { text, readTruncated } = await readTextForIndexing(filePath, stat.size)
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
					}'''

new4 = '''const text = await readTextForIndexing(filePath)
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
						record = {
							path: relativePath,
							status: indexedChunks.length === 0 ? "skipped" : "indexed",
							size: stat.size,
							mtimeMs: stat.mtimeMs,
							chunks: indexedChunks,
							error: indexedChunks.length === 0 ? "No indexable text content" : undefined,
						}
					}'''

if old4 not in text:
    raise SystemExit("block4 not found")
text = text.replace(old4, new4, 1)

# Drop unused CHUNK_CHARS import if only used by partialIndexNote
# CHUNK_CHARS may still be used elsewhere — check later

p.write_text(text, encoding="utf-8")
print("updated", p)
