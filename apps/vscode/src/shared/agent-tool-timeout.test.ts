import { describe, expect, it } from "vitest"
import { resolveAgentToolTimeoutMs } from "./agent-tool-timeout"

describe("resolveAgentToolTimeoutMs", () => {
	it("uses configured requestTimeoutMs when set (capped at 5 min)", () => {
		expect(resolveAgentToolTimeoutMs("lmstudio", { requestTimeoutMs: 900_000 })).toBe(300_000)
		expect(resolveAgentToolTimeoutMs("lmstudio", { requestTimeoutMs: 120_000 })).toBe(120_000)
	})

	it("defaults to 120s for local providers without override", () => {
		expect(resolveAgentToolTimeoutMs("lmstudio", {})).toBe(120_000)
		expect(resolveAgentToolTimeoutMs("ollama", {})).toBe(120_000)
	})

	it("defaults to 30s for cloud providers without override", () => {
		expect(resolveAgentToolTimeoutMs("anthropic", {})).toBe(30_000)
	})
})
