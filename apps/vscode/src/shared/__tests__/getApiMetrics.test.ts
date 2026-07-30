import { describe, it } from "bun:test"
import { strict as assert } from "node:assert"
import type { AgentarioMessage } from "../ExtensionMessage"
import { getApiMetrics, getContextWindowUsage, getLastApiReqTotalTokens, getLastContextBudget } from "../getApiMetrics"

describe("getApiMetrics", () => {
	it("includes subagent_usage in aggregate totals", () => {
		const messages: AgentarioMessage[] = [
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
		const messages: AgentarioMessage[] = [
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
		const messages: AgentarioMessage[] = [
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
		// Agentario: tokensOut не включается — это выходные токены, не занимающие контекст
		assert.equal(total, 16) // 11 + 2 + 3 (без tokensOut: 7)
	})

	it("falls back to contextBudget.totalEstimated when usage tokens are zero", () => {
		const messages: AgentarioMessage[] = [
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
		assert.equal(getContextWindowUsage(messages).approximate, true)
	})

	it("keeps last measured usage when a newer estimate-only api_req starts", () => {
		const messages: AgentarioMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 22_570,
					tokensOut: 112,
					contextBudget: {
						contextWindow: 65_536,
						totalEstimated: 13_110,
						pinnedEstimated: 10_106,
						compressibleEstimated: 3_004,
						categories: { system: 3_670, rules: 1_628, tools: 2_920, mcp: 1_888, skills: 0, chat: 3_004 },
					},
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					contextBudget: {
						contextWindow: 65_536,
						totalEstimated: 13_212,
						pinnedEstimated: 10_106,
						compressibleEstimated: 3_106,
						categories: { system: 3_670, rules: 1_628, tools: 2_920, mcp: 1_888, skills: 0, chat: 3_106 },
					},
				}),
			},
		]

		const usage = getContextWindowUsage(messages)
		assert.equal(usage.used, 22_570)
		assert.equal(usage.approximate, false)
	})

	it("prefers a higher newer estimate over stale measured usage", () => {
		const messages: AgentarioMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 20_000,
					tokensOut: 80,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					contextBudget: {
						contextWindow: 36_864,
						totalEstimated: 32_960,
						pinnedEstimated: 10_000,
						compressibleEstimated: 22_960,
						categories: { system: 3_000, rules: 2_000, tools: 3_000, mcp: 1_000, skills: 1_000, chat: 22_960 },
					},
				}),
			},
		]

		const usage = getContextWindowUsage(messages)
		assert.equal(usage.used, 32_960)
		assert.equal(usage.approximate, true)
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
		const messages: AgentarioMessage[] = [
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
		const messages: AgentarioMessage[] = [
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
