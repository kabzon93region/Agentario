import type { ContextBudgetBreakdown } from "@agentario/shared"
import { AgentarioMessage } from "./ExtensionMessage"

export type { ContextBudgetBreakdown }

interface ApiMetrics {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
}

/**
 * Calculates API metrics from an array of agentarioMessages.
 *
 * This function processes usage-carrying say messages.
 * It includes:
 * - 'api_req_started' messages that have been combined with their corresponding 'api_req_finished' messages
 * - 'deleted_api_reqs' messages, which are aggregated from deleted messages
 * - 'subagent_usage' messages, which are aggregated usage snapshots emitted by subagent batches
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of AgentarioMessage objects to process.
 * @returns An ApiMetrics object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, and totalCost.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = getApiMetrics(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function getApiMetrics(messages: AgentarioMessage[]): ApiMetrics {
	const result: ApiMetrics = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
	}

	messages.forEach((message) => {
		if (
			message.type === "say" &&
			(message.say === "api_req_started" || message.say === "deleted_api_reqs" || message.say === "subagent_usage") &&
			message.text
		) {
			try {
				const parsedData = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedData

				if (typeof tokensIn === "number") {
					result.totalTokensIn += tokensIn
				}
				if (typeof tokensOut === "number") {
					result.totalTokensOut += tokensOut
				}
				if (typeof cacheWrites === "number") {
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
				}
				if (typeof cacheReads === "number") {
					result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
				}
				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch {
				// Ignore JSON parse errors
			}
		}
	})

	return result
}

export type ContextWindowUsage = {
	/** Input tokens for the progress bar (measured or estimate). */
	used: number
	/** True when `used` comes from char-based contextBudget, not provider usage. */
	approximate: boolean
}

/**
 * Gets context-window usage for the task header progress bar.
 *
 * Prefer the last **measured** provider input (`tokensIn` + cache) over a newer
 * `contextBudget.totalEstimated`-only `api_req_started`. Otherwise the bar jumps
 * up after each model reply, then drops when the next iteration posts an estimate
 * before usage arrives (often ~2× lower for local models / RU text).
 *
 * Agentario: НЕ включаем tokensOut — выходные токены не занимают контекст.
 */
export function getContextWindowUsage(messages: AgentarioMessage[]): ContextWindowUsage {
	let lastMeasured = 0
	let lastEstimated = 0

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === "api_req_started" && msg.text) {
			try {
				const parsed = JSON.parse(msg.text) as {
					tokensIn?: number
					cacheWrites?: number
					cacheReads?: number
					contextBudget?: ContextBudgetBreakdown
				}
				const measured =
					(parsed.tokensIn || 0) + (parsed.cacheWrites || 0) + (parsed.cacheReads || 0)
				if (measured > 0 && lastMeasured === 0) {
					lastMeasured = measured
				}
				const estimated = parsed.contextBudget?.totalEstimated ?? 0
				if (estimated > 0 && lastEstimated === 0) {
					lastEstimated = estimated
				}
				if (lastMeasured > 0) {
					// Measured wins even if a newer estimate-only message exists.
					return { used: lastMeasured, approximate: false }
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}

	if (lastEstimated > 0) {
		return { used: lastEstimated, approximate: true }
	}
	return { used: 0, approximate: false }
}

/**
 * Gets the total INPUT token count from the last API request (for progress bar).
 * @see getContextWindowUsage
 */
export function getLastApiReqTotalTokens(messages: AgentarioMessage[]): number {
	return getContextWindowUsage(messages).used
}

function isContextBudgetBreakdown(value: unknown): value is ContextBudgetBreakdown {
	if (!value || typeof value !== "object") {
		return false
	}
	const candidate = value as ContextBudgetBreakdown
	return (
		typeof candidate.contextWindow === "number" &&
		typeof candidate.totalEstimated === "number" &&
		candidate.categories !== undefined &&
		typeof candidate.categories.system === "number" &&
		typeof candidate.categories.rules === "number" &&
		typeof candidate.categories.tools === "number" &&
		typeof candidate.categories.mcp === "number" &&
		typeof candidate.categories.skills === "number" &&
		typeof candidate.categories.chat === "number"
	)
}

export function getLastContextBudget(messages: AgentarioMessage[]): ContextBudgetBreakdown | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === "api_req_started" && msg.text) {
			try {
				const parsed = JSON.parse(msg.text) as { contextBudget?: unknown }
				if (isContextBudgetBreakdown(parsed.contextBudget)) {
					return parsed.contextBudget
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}
	return undefined
}
