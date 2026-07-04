import { CHARS_PER_TOKEN, estimateTokens } from "../llms/tokens"

/** Model context length (tokens). LM Studio n_ctx / evolution batch size. */
export const EMBEDDING_CONTEXT_TOKENS = 2048

/** Max total tokens per /embeddings request (LM Studio eval batch size). */
export const EMBEDDING_BATCH_TOKEN_BUDGET = 2048

/** Target chunk size in tokens (~50% of context for retrieval quality). */
export const CHUNK_TOKEN_TARGET = 1024

/** Chunk size in characters (conservative token estimate). */
export const CHUNK_CHARS = CHUNK_TOKEN_TARGET * CHARS_PER_TOKEN

/** Overlap between consecutive chunks: 17.5% (middle of 15–20%). */
export const CHUNK_OVERLAP_CHARS = Math.floor(CHUNK_CHARS * 0.175)

/** Step between chunk starts. */
export const CHUNK_STRIDE_CHARS = CHUNK_CHARS - CHUNK_OVERLAP_CHARS

export const MAX_CHARS_PER_EMBEDDING_INPUT = EMBEDDING_CONTEXT_TOKENS * CHARS_PER_TOKEN

export function chunkTextForEmbedding(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n")
	const chunks: string[] = []
	for (let start = 0; start < normalized.length; start += CHUNK_STRIDE_CHARS) {
		let slice = normalized.slice(start, start + CHUNK_CHARS).trim()
		if (!slice) {
			continue
		}
		if (estimateTokens(slice.length) > EMBEDDING_CONTEXT_TOKENS) {
			slice = slice.slice(0, MAX_CHARS_PER_EMBEDDING_INPUT).trim()
		}
		if (slice) {
			chunks.push(slice)
		}
		if (start + CHUNK_CHARS >= normalized.length) {
			break
		}
	}
	return chunks
}

/** Group chunks so each embedding request stays within the token batch budget. */
export function batchChunksForEmbedding(chunks: string[]): string[][] {
	const batches: string[][] = []
	let current: string[] = []
	let currentTokens = 0

	for (const chunk of chunks) {
		const tokens = estimateTokens(chunk.length)
		if (current.length > 0 && currentTokens + tokens > EMBEDDING_BATCH_TOKEN_BUDGET) {
			batches.push(current)
			current = []
			currentTokens = 0
		}
		current.push(chunk)
		currentTokens += tokens
	}

	if (current.length > 0) {
		batches.push(current)
	}
	return batches
}
