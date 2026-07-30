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
 * Scans backwards to find the NEWEST measured (tokensIn + cache) and the NEWEST
 * contextBudget.totalEstimated independently. Then:
 * - If the estimate is strictly newer (closer to array end) → use it (handles
 *   post-compaction where the estimate reflects the compressed context).
 * - If the measured value is newer → use it (real provider usage data).
 * - If both come from the same message → prefer measured unless estimate is higher.
 *
 * Agentario: НЕ включаем tokensOut — выходные токены не занимают контекст.
 */
export function getContextWindowUsage(messages: AgentarioMessage[]): ContextWindowUsage {
	let lastMeasured = 0
	let lastEstimated = 0
	/** Index of the newest message carrying a measured value (tokensIn > 0). */
	let lastMeasuredIdx = -1
	/** Index of the newest message carrying an estimated value (contextBudget.totalEstimated > 0). */
	let lastEstimatedIdx = -1

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
				if (measured > 0 && lastMeasuredIdx < 0) {
					lastMeasured = measured
					lastMeasuredIdx = i
				}
				const estimated = parsed.contextBudget?.totalEstimated ?? 0
				if (estimated > 0 && lastEstimatedIdx < 0) {
					lastEstimated = estimated
					lastEstimatedIdx = i
				}
				if (lastMeasuredIdx >= 0 && lastEstimatedIdx >= 0) {
					break
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}

	if (lastMeasured > 0 && lastEstimated > 0) {
		// If the estimate is strictly newer (found at a higher index in the
		// backwards scan = closer to the array end), prefer it — it reflects
		// a more recent snapshot (e.g. post-compaction contextBudget).
		if (lastEstimatedIdx > lastMeasuredIdx) {
			return { used: lastEstimated, approximate: true }
		}
		// Same message or measured is newer: prefer measured (real provider data)
		// unless the estimate is significantly higher (stale measured after cancel / reload).
		if (lastEstimatedIdx === lastMeasuredIdx && lastEstimated > lastMeasured) {
			return { used: lastEstimated, approximate: true }
		}
		return { used: lastMeasured, approximate: false }
	}
	if (lastMeasured > 0) {
		return { used: lastMeasured, approximate: false }
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
