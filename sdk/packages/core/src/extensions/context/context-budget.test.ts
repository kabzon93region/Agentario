import { describe, expect, it } from "vitest";
import { estimateContextBudget } from "./context-budget";

describe("estimateContextBudget", () => {
	it("splits pinned categories from chat messages", () => {
		const breakdown = estimateContextBudget({
			contextWindow: 32_768,
			systemPromptBase: "You are Agentario.",
			rules: [{ name: "global-rules.md", content: "## Rules\nBe concise." }],
			tools: [
				{
					name: "read_files",
					description: "Read files from disk",
					inputSchema: { type: "object", properties: { paths: { type: "array" } } },
				},
			],
			messages: [
				{ role: "user", content: "Fix the README please." },
				{ role: "assistant", content: "I'll read the file first." },
			],
		});

		expect(breakdown.categories.system).toBeGreaterThan(0);
		expect(breakdown.categories.rules).toBeGreaterThan(0);
		expect(breakdown.categories.tools).toBeGreaterThan(0);
		expect(breakdown.categories.chat).toBeGreaterThan(0);
		expect(breakdown.pinnedEstimated).toBe(
			breakdown.categories.system +
				breakdown.categories.rules +
				breakdown.categories.tools,
		);
		expect(breakdown.compressibleEstimated).toBe(breakdown.categories.chat);
		expect(breakdown.totalEstimated).toBe(
			breakdown.pinnedEstimated + breakdown.compressibleEstimated,
		);
		expect(breakdown.rulesDetail?.[0]?.name).toBe("global-rules.md");
	});
});
