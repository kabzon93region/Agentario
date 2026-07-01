import type { ClineApiReqInfo, ClineMessage } from "./ExtensionMessage"

/** Whether an API request row has finished (works for local LM Studio without cost). */
export function isApiReqComplete(info: ClineApiReqInfo): boolean {
	return (
		info.cost != null ||
		info.tokensIn != null ||
		info.cancelReason != null ||
		info.streamingFailedMessage != null
	)
}

export function formatMessageTimestamp(createdAtMs: number, locale?: string): string {
	try {
		return new Intl.DateTimeFormat(locale, {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(createdAtMs))
	} catch {
		return new Date(createdAtMs).toLocaleString()
	}
}

function parseApiReqInfo(message: ClineMessage): ClineApiReqInfo | undefined {
	if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
		return undefined
	}
	try {
		return JSON.parse(message.text) as ClineApiReqInfo
	} catch {
		return undefined
	}
}

function isUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "user_feedback" || message.say === "task")
}

/** API usage row that follows `fromTs` before the next user message. */
export function findFollowingApiStats(messages: ClineMessage[], fromTs: number): ClineApiReqInfo | undefined {
	const startIndex = messages.findIndex((message) => message.ts === fromTs)
	if (startIndex === -1) {
		return undefined
	}

	for (let i = startIndex + 1; i < messages.length; i++) {
		const message = messages[i]
		if (isUserMessage(message)) {
			break
		}
		const info = parseApiReqInfo(message)
		if (info && isApiReqComplete(info) && info.tokensIn != null) {
			return info
		}
	}

	return undefined
}

export function formatMessageStatsLine(info: ClineApiReqInfo): string | undefined {
	const tokensIn = info.tokensIn
	const tokensOut = info.tokensOut
	if (tokensIn == null && tokensOut == null) {
		return undefined
	}

	const total = (tokensIn ?? 0) + (tokensOut ?? 0)
	const parts: string[] = []
	if (tokensIn != null) {
		parts.push(`in: ${tokensIn}`)
	}
	if (tokensOut != null) {
		parts.push(`out: ${tokensOut}`)
	}
	parts.push(`total: ${total}`)

	if (info.durationMs != null && info.durationMs > 0) {
		const seconds = (info.durationMs / 1000).toFixed(1)
		parts.push(`time: ${seconds}s`)
	}
	if (info.generationDurationMs != null && info.generationDurationMs > 0) {
		const genSeconds = (info.generationDurationMs / 1000).toFixed(1)
		parts.push(`gen: ${genSeconds}s`)
	}
	if (info.tokensPerSecond != null && info.tokensPerSecond > 0) {
		parts.push(`${info.tokensPerSecond} tok/s`)
	}
	if (info.cost != null && info.cost > 0) {
		parts.push(`$${info.cost.toFixed(4)}`)
	}

	return parts.join(" · ")
}

export type MessageBubbleRole = "User" | "Agentario" | "Thinking" | "Plan" | "Subagent"

export function getMessageBubbleRole(message: ClineMessage): MessageBubbleRole | undefined {
	if (message.type === "say") {
		switch (message.say) {
			case "task":
			case "user_feedback":
				return "User"
			case "text":
			case "completion_result":
			case "tool":
			case "command":
			case "command_output":
				return "Agentario"
			case "reasoning":
				return "Thinking"
			case "subagent":
			case "subagent_usage":
			case "use_subagents":
				return "Subagent"
		}
	}
	if (message.type === "ask") {
		switch (message.ask) {
			case "plan_mode_respond":
				return "Plan"
			case "tool":
			case "command":
			case "completion_result":
				return "Agentario"
		}
	}
	return undefined
}
