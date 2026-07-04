import { describe, it } from "bun:test"
import { strict as assert } from "node:assert"
import type { ClineMessage } from "../ExtensionMessage"
import { getApiMetrics, getLastApiReqTotalTokens, getLastContextBudget } from "../getApiMetrics"

describe("getApiMetrics", () => {
	it("includes subagent_usage in aggregate totals", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 10,
					tokensOut: 20,
					cacheWrites: 3,
					cacheReads: 1,
					cost: 0.12,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({
					source: "subagents",
					tokensIn: 4,
					tokensOut: 8,
					cacheWrites: 2,
					cacheReads: 1,
					cost: 0.05,
				}),
			},
			{
				ts: 3,
				type: "say",
				say: "deleted_api_reqs",
				text: JSON.stringify({
					tokensIn: 6,
					tokensOut: 9,
					cacheWrites: 1,
					cacheReads: 0,
					cost: 0.03,
				}),
			},
		]

		const metrics = getApiMetrics(messages)

		assert.equal(metrics.totalTokensIn, 20)
		assert.equal(metrics.totalTokensOut, 37)
		assert.equal(metrics.totalCacheWrites, 6)
		assert.equal(metrics.totalCacheReads, 2)
		assert.ok(Math.abs(metrics.totalCost - 0.2) < 1e-9)
	})

	it("ignores malformed usage payloads", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "subagent_usage",
				text: "{not-json",
			},
		]

		const metrics = getApiMetrics(messages)
		assert.equal(metrics.totalTokensIn, 0)
		assert.equal(metrics.totalTokensOut, 0)
		assert.equal(metrics.totalCost, 0)
	})
})

describe("getLastApiReqTotalTokens", () => {
	it("uses only the latest api_req_started payload", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({
					source: "subagents",
					tokensIn: 100,
					tokensOut: 200,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 11,
					tokensOut: 7,
					cacheWrites: 2,
					cacheReads: 3,
				}),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 23)
	})

	it("falls back to contextBudget.totalEstimated when usage tokens are zero", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 0,
					tokensOut: 0,
					contextBudget: {
						contextWindow: 32_000,
						totalEstimated: 12_345,
						pinnedEstimated: 4_000,
						compressibleEstimated: 8_345,
						categories: { system: 1_000, rules: 500, tools: 2_500, chat: 8_345 },
					},
				}),
			},
		]

		assert.equal(getLastApiReqTotalTokens(messages), 12_345)
	})
})

describe("getLastContextBudget", () => {
	it("returns the latest valid contextBudget from api_req_started", () => {
		const budget = {
			contextWindow: 128_000,
			totalEstimated: 50_000,
			pinnedEstimated: 10_000,
			compressibleEstimated: 40_000,
			categories: { system: 2_000, rules: 3_000, tools: 5_000, chat: 40_000 },
			rulesDetail: [{ name: "agentario-global-rules.md", tokens: 3_000 }],
		}
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ contextBudget: budget }),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					contextBudget: {
						...budget,
						totalEstimated: 55_000,
						categories: { ...budget.categories, chat: 45_000 },
					},
				}),
			},
		]

		const latest = getLastContextBudget(messages)
		assert.equal(latest?.totalEstimated, 55_000)
		assert.equal(latest?.categories.chat, 45_000)
	})

	it("ignores malformed or incomplete contextBudget payloads", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ contextBudget: { totalEstimated: 100 } }),
			},
		]

		assert.equal(getLastContextBudget(messages), undefined)
	})
})
