import { describe, expect, it } from "vitest"
import type { AgentarioMessage } from "./ExtensionMessage"
import {
	findFollowingApiStats,
	formatMessageStatsLine,
	hasFollowingAssistantText,
	isApiReqComplete,
} from "./message-display"

describe("isApiReqComplete", () => {
	it("treats tokensIn as completion for local providers", () => {
		expect(isApiReqComplete({ tokensIn: 100, tokensOut: 50 })).toBe(true)
		expect(isApiReqComplete({})).toBe(false)
	})
})

describe("findFollowingApiStats", () => {
	it("returns usage after a user message", () => {
		const messages: AgentarioMessage[] = [
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

describe("hasFollowingAssistantText", () => {
	it("detects text after reasoning before the next user message", () => {
		const messages: AgentarioMessage[] = [
			{ ts: 1, type: "say", say: "reasoning", text: "think" },
			{ ts: 2, type: "say", say: "text", text: "answer" },
			{ ts: 3, type: "say", say: "user_feedback", text: "next" },
		]
		expect(hasFollowingAssistantText(messages, 1)).toBe(true)
		expect(hasFollowingAssistantText(messages, 2)).toBe(false)
	})

	it("ignores empty text and stops at user messages", () => {
		const messages: AgentarioMessage[] = [
			{ ts: 1, type: "say", say: "reasoning", text: "think" },
			{ ts: 2, type: "say", say: "text", text: "   " },
			{ ts: 3, type: "say", say: "user_feedback", text: "next" },
			{ ts: 4, type: "say", say: "text", text: "later" },
		]
		expect(hasFollowingAssistantText(messages, 1)).toBe(false)
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
