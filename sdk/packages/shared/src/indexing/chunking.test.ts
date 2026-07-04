import { describe, expect, it } from "bun:test"
import {
	batchChunksForEmbedding,
	CHUNK_CHARS,
	CHUNK_OVERLAP_CHARS,
	CHUNK_STRIDE_CHARS,
	chunkTextForEmbedding,
	EMBEDDING_BATCH_TOKEN_BUDGET,
	EMBEDDING_CONTEXT_TOKENS,
} from "./chunking"
import { estimateTokens } from "../llms/tokens"

describe("chunkTextForEmbedding", () => {
	it("uses configured overlap between chunks", () => {
		const text = "a".repeat(CHUNK_CHARS * 3)
		const chunks = chunkTextForEmbedding(text)
		expect(chunks.length).toBeGreaterThan(1)
		expect(CHUNK_STRIDE_CHARS).toBe(CHUNK_CHARS - CHUNK_OVERLAP_CHARS)
		expect(CHUNK_OVERLAP_CHARS / CHUNK_CHARS).toBeGreaterThanOrEqual(0.15)
		expect(CHUNK_OVERLAP_CHARS / CHUNK_CHARS).toBeLessThanOrEqual(0.2)
	})

	it("keeps each chunk within embedding context", () => {
		const text = "word ".repeat(20_000)
		for (const chunk of chunkTextForEmbedding(text)) {
			expect(estimateTokens(chunk.length)).toBeLessThanOrEqual(EMBEDDING_CONTEXT_TOKENS)
		}
	})
})

describe("batchChunksForEmbedding", () => {
	it("respects LM Studio batch token budget", () => {
		const chunks = chunkTextForEmbedding("x".repeat(CHUNK_CHARS * 8))
		for (const batch of batchChunksForEmbedding(chunks)) {
			const tokens = batch.reduce((sum, chunk) => sum + estimateTokens(chunk.length), 0)
			expect(tokens).toBeLessThanOrEqual(EMBEDDING_BATCH_TOKEN_BUDGET)
		}
	})
})
