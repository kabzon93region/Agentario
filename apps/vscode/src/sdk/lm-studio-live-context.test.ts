import { describe, expect, it } from "vitest"
import { pickLmStudioChatContextWindow } from "./lm-studio-live-context"

describe("pickLmStudioChatContextWindow", () => {
	it("ignores embedding models even when they are loaded first", () => {
		const value = pickLmStudioChatContextWindow(
			[
				{
					id: "text-embedding-nomic-embed-text-v1.5",
					type: "embedding",
					state: "loaded",
					loaded_context_length: 2048,
					max_context_length: 2048,
				},
				{
					id: "qwen3.5-4b-mtp",
					type: "llm",
					state: "loaded",
					loaded_context_length: 56832,
					max_context_length: 131072,
				},
			],
			"qwen3.5-4b-mtp",
		)
		expect(value).toBe(56832)
	})

	it("prefers the selected chat model over another loaded LLM", () => {
		const value = pickLmStudioChatContextWindow(
			[
				{
					id: "small-llm",
					type: "llm",
					state: "loaded",
					loaded_context_length: 8192,
				},
				{
					id: "prism-ml/bonsai-27b",
					type: "llm",
					state: "loaded",
					loaded_context_length: 66256,
				},
			],
			"prism-ml/bonsai-27b",
		)
		expect(value).toBe(66256)
	})

	it("falls back to the largest loaded LLM context when no preferred id", () => {
		const value = pickLmStudioChatContextWindow([
			{
				id: "text-embedding-nomic-embed-text-v1.5",
				type: "embedding",
				state: "loaded",
				loaded_context_length: 2048,
			},
			{
				id: "a",
				type: "llm",
				state: "loaded",
				loaded_context_length: 8192,
			},
			{
				id: "b",
				type: "llm",
				state: "loaded",
				loaded_context_length: 32000,
			},
		])
		expect(value).toBe(32000)
	})

	it("detects embedding models by id when type is missing", () => {
		const value = pickLmStudioChatContextWindow([
			{
				id: "nomic-embed-text",
				state: "loaded",
				loaded_context_length: 2048,
			},
			{
				id: "chat-model",
				state: "loaded",
				loaded_context_length: 40960,
			},
		])
		expect(value).toBe(40960)
	})
})