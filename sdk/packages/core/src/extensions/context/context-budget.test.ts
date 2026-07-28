import { describe, expect, it } from "vitest";
import {
	estimateContextBudget,
	scaleContextBudgetBreakdown,
	updateContextBudgetProviderScale,
} from "./context-budget";
import { createTokenEstimator } from "./compaction-shared";

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
				breakdown.categories.tools +
				breakdown.categories.mcp +
				breakdown.categories.skills,
		);
		expect(breakdown.compressibleEstimated).toBe(breakdown.categories.chat);
		expect(breakdown.totalEstimated).toBe(
			breakdown.pinnedEstimated + breakdown.compressibleEstimated,
		);
		expect(breakdown.rulesDetail?.[0]?.name).toBe("global-rules.md");
	});

	it("provider estimator counts full tool_result (not compaction 2k cap)", () => {
		const long = "x".repeat(6_000);
		const message = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "t1",
					content: long,
				},
			],
		};
		const compaction = createTokenEstimator("compaction")(message);
		const provider = createTokenEstimator("provider")(message);
		expect(provider).toBeGreaterThan(compaction);
		expect(provider).toBeGreaterThanOrEqual(Math.ceil(6_000 / 3));
	});

	it("scales breakdown toward provider tokenizer via EMA", () => {
		const base = estimateContextBudget({
			contextWindow: 65_536,
			systemPromptBase: "sys",
			rules: [],
			tools: [],
			messages: [{ role: "user", content: "hello" }],
		});
		const scaled = scaleContextBudgetBreakdown(base, 1.5);
		expect(scaled.totalEstimated).toBeGreaterThan(base.totalEstimated);
		expect(scaled.totalEstimated).toBeCloseTo(base.totalEstimated * 1.5, -1);
		const next = updateContextBudgetProviderScale(1, 20_000, 10_000);
		expect(next).toBeGreaterThan(1);
		expect(next).toBeLessThanOrEqual(2.2);
	});
});
