import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { isApiReqComplete } from "@shared/message-display"

/** True while the agent is actively working and the user may want to interrupt. */
export function isAgentTaskRunning(turnState: TurnState | undefined, lastMessage: ClineMessage | undefined): boolean {
	if (turnState) {
		return turnState.phase === "streaming" || turnState.phase === "awaiting_approval"
	}

	if (!lastMessage) {
		return false
	}

	if (lastMessage.partial === true) {
		return true
	}

	if (lastMessage.type === "say" && lastMessage.say === "api_req_started") {
		try {
			const info = JSON.parse(lastMessage.text || "{}")
			return !isApiReqComplete(info)
		} catch {
			return true
		}
	}

	return false
}
