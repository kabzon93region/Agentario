/**
 * Semantic Search Tool
 *
 * Searches the codebase using embeddings-based semantic similarity.
 * Uses the existing index created by the indexing feature.
 */

import {
	type IndexedChunk,
	readIndexMeta,
	readFileRecord,
	fileKeyForPath,
} from "@agentario/shared"

// =============================================================================
// Types
// =============================================================================

export interface SemanticSearchConfig {
	workspacePath: string
	baseUrl: string
	embeddingModel: string
	backend?: "lmstudio" | "ollama"
}

export interface SemanticSearchResult {
	file: string
	chunk: string
	score: number
	line?: number
}

export interface SemanticSearchResponse {
	results: SemanticSearchResult[]
	query: string
	totalChunksSearched: number
	indexedFiles: number
}

// =============================================================================
// Cosine Similarity
// =============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0
	let dot = 0
	let normA = 0
	let normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}

// =============================================================================
// Embedding
// =============================================================================

async function embedQuery(
	baseUrl: string,
	model: string,
	query: string,
	backend: "lmstudio" | "ollama" = "lmstudio",
): Promise<number[]> {
	const endpoint = backend === "ollama"
		? `${baseUrl.replace(/\/$/, "")}/api/embeddings`
		: `${baseUrl.replace(/\/$/, "")}/v1/embeddings`

	const body = backend === "ollama"
		? JSON.stringify({ model, prompt: query })
		: JSON.stringify({ model, input: query })

	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	})

	if (!response.ok) {
		throw new Error(`Embedding request failed (${response.status}): ${await response.text().catch(() => "")}`)
	}

	const payload = await response.json() as {
		embedding?: number[]
		embeddings?: number[][]

		data?: Array<{ embedding: number[] }>
	}

	if (Array.isArray(payload.data) && payload.data[0]?.embedding) {
		return payload.data[0].embedding
	}
	if (Array.isArray(payload.embeddings) && payload.embeddings[0]) {
		return payload.embeddings[0]
	}
	if (Array.isArray(payload.embedding)) {
		return payload.embedding
	}

	throw new Error("Embedding response missing vector")
}

// =============================================================================
// Index Loading
// =============================================================================

interface LoadedChunk {
	file: string
	chunk: IndexedChunk
}

async function loadAllChunks(workspacePath: string): Promise<LoadedChunk[]> {
	const meta = await readIndexMeta(workspacePath)
	if (!meta || meta.files.length === 0) {
		return []
	}

	const chunks: LoadedChunk[] = []
	for (const fileEntry of meta.files) {
		if (fileEntry.status !== "indexed" || fileEntry.embeddingCount === 0) {
			continue
		}
		const fileKey = fileKeyForPath(fileEntry.path)
		const record = await readFileRecord(workspacePath, fileKey)
		if (!record || !record.chunks) {
			continue
		}
		for (const chunk of record.chunks) {
			if (chunk.embedding && chunk.embedding.length > 0) {
				chunks.push({ file: fileEntry.path, chunk })
			}
		}
	}

	return chunks
}

// =============================================================================
// Search
// =============================================================================

export async function performSemanticSearch(
	config: SemanticSearchConfig,
	query: string,
	limit: number = 10,
): Promise<SemanticSearchResponse> {
	// 1. Load all chunks from index
	const allChunks = await loadAllChunks(config.workspacePath)
	if (allChunks.length === 0) {
		return {
			results: [],
			query,
			totalChunksSearched: 0,
			indexedFiles: 0,
		}
	}

	// 2. Embed the query
	const queryEmbedding = await embedQuery(
		config.baseUrl,
		config.embeddingModel,
		query,
		config.backend ?? "lmstudio",
	)

	// 3. Compute similarities
	const scored: Array<{ file: string; chunk: IndexedChunk; score: number }> = []
	for (const { file, chunk } of allChunks) {
		const score = cosineSimilarity(queryEmbedding, chunk.embedding)
		scored.push({ file, chunk, score })
	}

	// 4. Sort by score descending, take top-k
	scored.sort((a, b) => b.score - a.score)
	const topK = scored.slice(0, limit)

	// 5. Estimate line numbers from chunk text
	const results: SemanticSearchResult[] = topK.map(({ file, chunk, score }) => ({
		file,
		chunk: chunk.text,
		score: Math.round(score * 1000) / 1000,
	}))

	// Count unique files
	const uniqueFiles = new Set(allChunks.map((c) => c.file))

	return {
		results,
		query,
		totalChunksSearched: allChunks.length,
		indexedFiles: uniqueFiles.size,
	}
}
