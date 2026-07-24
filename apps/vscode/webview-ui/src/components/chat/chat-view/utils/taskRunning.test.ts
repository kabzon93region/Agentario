import type { AgentarioMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { isAgentTaskRunning } from "./taskRunning"

describe("isAgentTaskRunning", () => {
	it("returns true for streaming turnState", () => {
		expect(isAgentTaskRunning({ phase: "streaming", seq: 1 }, undefined)).toBe(true)
	})

	it("returns true for awaiting_approval turnState", () => {
		expect(isAgentTaskRunning({ phase: "awaiting_approval", seq: 1, anchorTs: 10 }, undefined)).toBe(true)
	})

	it("returns false for completed turnState", () => {
		expect(isAgentTaskRunning({ phase: "completed", seq: 1 }, undefined)).toBe(false)
	})

	it("falls back to partial last message when turnState is missing", () => {
		const lastMessage = { partial: true } as AgentarioMessage
		expect(isAgentTaskRunning(undefined, lastMessage)).toBe(true)
	})

	it("falls back to active api_req_started when turnState is missing", () => {
		const lastMessage = {
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({}),
		} as AgentarioMessage
		expect(isAgentTaskRunning(undefined, lastMessage)).toBe(true)
	})
})
