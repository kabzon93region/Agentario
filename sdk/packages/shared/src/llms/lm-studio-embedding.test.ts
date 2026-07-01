import { describe, expect, it } from "vitest"
import {
	buildEmbeddingRequestModelIds,
	formatLmStudioNonEmbeddingModelError,
	lmStudioApiUrl,
	lmStudioModelMatches,
	pickLmStudioEmbeddingCandidate,
	recordMatchesRequested,
	resolveLmStudioEmbeddingModelId,
} from "./lm-studio-embedding"

describe("lmStudioModelMatches", () => {
	it("matches exact id and quantization suffix", () => {
		expect(lmStudioModelMatches("text-embedding-qwen3@q8_0", "text-embedding-qwen3")).toBe(true)
		expect(lmStudioModelMatches("publisher/text-embedding-qwen3@q8_0", "text-embedding-qwen3")).toBe(true)
	})
})

describe("recordMatchesRequested", () => {
	it("matches loaded instance ids from the v1 catalog", () => {
		const record = {
			id: "lfm2.5-embedding-350m@q8_0",
			key: "lfm2.5-embedding-350m",
			type: "llm",
			state: "loaded",
			loadedInstanceIds: ["lfm2.5-embedding-350m@q8_0"],
			variants: ["lfm2.5-embedding-350m@q8_0"],
		}
		expect(recordMatchesRequested(record, "lfm2.5-embedding-350m")).toBe(true)
	})
})

describe("pickLmStudioEmbeddingCandidate", () => {
	it("prefers loaded llm models from the regular list", () => {
		const models = [
			{ id: "lfm2.5-embedding-350m", type: "embedding", state: "not-loaded", key: "lfm2.5-embedding-350m" },
			{
				id: "lfm2.5-embedding-350m@q8_0",
				type: "llm",
				state: "loaded",
				key: "lfm2.5-embedding-350m",
				loadedInstanceIds: ["lfm2.5-embedding-350m@q8_0"],
			},
		]
		expect(pickLmStudioEmbeddingCandidate(models, "lfm2.5-embedding-350m")?.id).toBe("lfm2.5-embedding-350m@q8_0")
	})

	it("prefers loaded embedding type when both exist", () => {
		const models = [
			{ id: "model@q4", type: "embeddings", state: "loaded", key: "model" },
			{ id: "model@q8", type: "llm", state: "loaded", key: "model" },
		]
		expect(pickLmStudioEmbeddingCandidate(models, "model")?.id).toBe("model@q4")
	})
})

describe("resolveLmStudioEmbeddingModelId", () => {
	it("uses loaded instance id from the general catalog", () => {
		const result = resolveLmStudioEmbeddingModelId(
			[
				{
					id: "lfm2.5-embedding-350m@q8_0",
					key: "lfm2.5-embedding-350m",
					type: "llm",
					state: "loaded",
					loadedInstanceIds: ["lfm2.5-embedding-350m@q8_0"],
				},
			],
			"lfm2.5-embedding-350m",
		)
		expect(result.modelId).toBe("lfm2.5-embedding-350m@q8_0")
	})
})

describe("buildEmbeddingRequestModelIds", () => {
	it("includes loaded instance ids before configured id", () => {
		const ids = buildEmbeddingRequestModelIds(
			{
				id: "lfm2.5-embedding-350m@q8_0",
				key: "lfm2.5-embedding-350m",
				loadedInstanceIds: ["lfm2.5-embedding-350m@q8_0"],
				variants: ["lfm2.5-embedding-350m@q8_0"],
			},
			"lfm2.5-embedding-350m",
		)
		expect(ids[0]).toBe("lfm2.5-embedding-350m@q8_0")
		expect(ids).toContain("lfm2.5-embedding-350m")
	})
})

describe("formatLmStudioNonEmbeddingModelError", () => {
	it("explains llm-loaded models cannot serve embeddings api", () => {
		const message = formatLmStudioNonEmbeddingModelError("lfm2.5-embedding-350m", [
			{ id: "lfm2.5-embedding-350m", type: "llm", state: "loaded", key: "lfm2.5-embedding-350m" },
			{ id: "text-embedding-qwen3-embedding-0.6b", type: "embeddings", state: "not-loaded", key: "text-embedding-qwen3-embedding-0.6b" },
		])
		expect(message).toContain("llm")
		expect(message).toContain("text-embedding-qwen3-embedding-0.6b")
	})
})
