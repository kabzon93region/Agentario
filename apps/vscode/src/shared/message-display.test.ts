import { describe, expect, it } from "vitest"
import type { ClineMessage } from "./ExtensionMessage"
import { findFollowingApiStats, formatMessageStatsLine, isApiReqComplete } from "./message-display"

describe("isApiReqComplete", () => {
	it("treats tokensIn as completion for local providers", () => {
		expect(isApiReqComplete({ tokensIn: 100, tokensOut: 50 })).toBe(true)
		expect(isApiReqComplete({})).toBe(false)
	})
})

describe("findFollowingApiStats", () => {
	it("returns usage after a user message", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "user_feedback", text: "hi" },
			{ ts: 2, type: "say", say: "text", text: "hello" },
			{
				ts: 3,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 10, tokensOut: 5, durationMs: 2000, tokensPerSecond: 2.5 }),
			},
		]
		const stats = findFollowingApiStats(messages, 1)
		expect(stats?.tokensIn).toBe(10)
		expect(stats?.durationMs).toBe(2000)
	})
})

describe("formatMessageStatsLine", () => {
	it("formats token and timing stats", () => {
		expect(
			formatMessageStatsLine({
				tokensIn: 100,
				tokensOut: 40,
				durationMs: 1500,
				generationDurationMs: 500,
				tokensPerSecond: 80,
			}),
		).toBe("in: 100 · out: 40 · total: 140 · time: 1.5s · gen: 0.5s · 80 tok/s")
	})
})
