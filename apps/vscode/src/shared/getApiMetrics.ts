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

/**
 * Gets the total INPUT token count from the last API request.
 *
 * This is used for context window progress display - it shows how much of the
 * context window is used in the current/most recent request, not cumulative totals.
 *
 * Agentario: НЕ включаем tokensOut — это выходные токены модели, которые НЕ
 * занимают контекст. Контекст — это только input (tokensIn + cacheWrites + cacheReads).
 *
 * @param messages - An array of AgentarioMessage objects to process.
 * @returns The total INPUT tokens from the last api_req_started message, or 0 if none found.
 */
export function getLastApiReqTotalTokens(messages: AgentarioMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === "api_req_started" && msg.text) {
			try {
				const parsed = JSON.parse(msg.text) as {
					tokensIn?: number
					tokensOut?: number
					cacheWrites?: number
					cacheReads?: number
					contextBudget?: ContextBudgetBreakdown
				}
				// Agentario: только INPUT токены (tokensIn + cache).
				// tokensOut — это выходные токены, они не занимают контекст.
				const total =
					(parsed.tokensIn || 0) +
					(parsed.cacheWrites || 0) +
					(parsed.cacheReads || 0)
				if (total > 0) {
					return total
				}
				if (parsed.contextBudget?.totalEstimated) {
					return parsed.contextBudget.totalEstimated
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}
	return 0
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
