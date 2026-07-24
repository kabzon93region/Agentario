/**
 * Semantic Search Executor for VS Code Extension
 *
 * Bridges the SDK's semantic_search tool with the extension's indexing system.
 * Reads the embeddings index from disk and performs similarity search.
 */

import { performSemanticSearch, type SemanticSearchConfig } from "@agentario/core"
import { readIndexMeta } from "@agentario/shared"
import { Logger } from "@/shared/services/Logger"

export interface CreateSemanticSearchExecutorOptions {
	workspacePath: string
}

/**
 * Creates a semantic search executor bound to the current workspace.
 * Returns undefined if the index doesn't exist or has no embeddings.
 */
export async function createSemanticSearchExecutor(
	options: CreateSemanticSearchExecutorOptions,
): Promise<((query: string, limit: number) => Promise<string>) | undefined> {
	const { workspacePath } = options

	// Check if index exists
	const meta = await readIndexMeta(workspacePath)
	if (!meta || meta.files.length === 0) {
		Logger.log("[SemanticSearchExecutor] No index found for workspace, skipping")
		return undefined
	}

	const totalEmbeddings = meta.files.reduce((sum, f) => sum + (f.embeddingCount ?? 0), 0)
	if (totalEmbeddings === 0) {
		Logger.log("[SemanticSearchExecutor] Index has no embeddings, skipping")
		return undefined
	}

	// Get embedding model settings from index meta (stored during indexing)
	const baseUrl = meta.baseUrl || "http://localhost:1234"
	const embeddingModel = meta.embeddingModel || "text-embedding-qwen3-embedding-0.6b"
	const backend = baseUrl.includes("ollama") ? "ollama" : "lmstudio"

	Logger.log(
		`[SemanticSearchExecutor] Initialized: ${meta.files.length} files, ${totalEmbeddings} chunks, ` +
		`model="${embeddingModel}", backend="${backend}", baseUrl="${baseUrl}"`,
	)

	const config: SemanticSearchConfig = {
		workspacePath,
		baseUrl,
		embeddingModel,
		backend: backend as "lmstudio" | "ollama",
	}

	return async (query: string, limit: number): Promise<string> => {
		const result = await performSemanticSearch(config, query, limit)

		if (result.results.length === 0) {
			return `No semantic matches found for: "${query}" (${result.totalChunksSearched} chunks in ${result.indexedFiles} files searched)`
		}

		// Format results for the agent
		const lines: string[] = [
			`Semantic search results for: "${query}"`,
			`Found ${result.results.length} matches in ${result.totalChunksSearched} chunks across ${result.indexedFiles} indexed files:\n`,
		]

		for (let i = 0; i < result.results.length; i++) {
			const r = result.results[i]
			lines.push(`--- Result ${i + 1} (score: ${r.score}) ---`)
			lines.push(`File: ${r.file}`)
			lines.push(`Chunk:`)
			lines.push(r.chunk)
			lines.push("")
		}

		return lines.join("\n")
	}
}
