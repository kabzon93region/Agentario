import type { AgentarioMessage, AgentarioSayTool } from "@shared/ExtensionMessage"
import { isApiReqComplete } from "@shared/message-display"
import type { Mode } from "@shared/storage/types"
import type { LucideIcon } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { cleanPathPrefix } from "../common/CodeAccordian"
import { getIconByToolName } from "./chat-view"
import { isLowStakesTool } from "./chat-view/utils/messageUtils"
import ErrorRow from "./ErrorRow"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"

interface RequestStartRowProps {
	message: AgentarioMessage
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	reasoningContent?: string
	responseStarted?: boolean
	agentarioMessages: AgentarioMessage[]
	mode?: Mode
	classNames?: string
	isExpanded: boolean
	handleToggle: () => void
}

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

// Helper to format search regex for display - show all terms separated by |
const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
	const cleanedPath = cleanPathPrefix(path)
	const pathDisplay = cleanedPath ? `${cleanedPath}/` : "codebase"
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${pathDisplay} (${filePattern})` : `"${terms}" in ${pathDisplay}`
}
// Format activity text based on tool type
const getActivityText = (tool: AgentarioSayTool): string | null => {
	const cleanedPath = cleanPathPrefix(tool.path || "")
	switch (tool.tool) {
		case "readFile":
			return tool.path ? `Reading ${cleanedPath}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `Exploring ${cleanedPath}/...` : null
		case "searchFiles":
			return tool.regex ? `Searching ${formatSearchRegex(tool.regex, tool.path || "", tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `Analyzing ${cleanedPath}/...` : null
		default:
			return null
	}
}

// Collect tools in a given range, with optional stop condition
const collectToolsInRange = (
	messages: AgentarioMessage[],
	startIdx: number,
	endIdx: number,
	stopCondition?: (msg: AgentarioMessage) => boolean,
): { icon: LucideIcon; text: string }[] => {
	const activities: { icon: LucideIcon; text: string }[] = []

	for (let i = startIdx; i < endIdx; i++) {
		const msg = messages[i]

		if (stopCondition?.(msg)) {
			break
		}

		// Only collect tools that are currently executing (ask === "tool")
		// Skip completed tools (say === "tool") - they should be in the completed list
		if (msg.say === "tool" || msg.ask !== "tool") {
			continue
		}

		try {
			const tool = JSON.parse(msg.text || "{}") as AgentarioSayTool
			const activityText = getActivityText(tool)
			if (activityText) {
				const toolIcon = getIconByToolName(tool.tool)
				activities.push({ icon: toolIcon, text: activityText })
			}
		} catch {
			// ignore parse errors
		}
	}
	return activities
}

// Find current api_req and determine if it has cost
const findCurrentApiReq = (messages: AgentarioMessage[]): { index: number; hasCost: boolean } | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				return { index: i, hasCost: isApiReqComplete(info) }
			} catch {
				return null
			}
		}
	}
	return null
}

// Find the most recent completed api_req before the given index
const findPrevCompletedApiReq = (messages: AgentarioMessage[], beforeIdx: number): number => {
	for (let i = beforeIdx - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				if (isApiReqComplete(info)) {
					return i
				}
			} catch {
				// ignore parse errors
			}
		}
	}
	return -1
}

/**
 * Displays the current state of an active tool operation,
 */
export const RequestStartRow: React.FC<RequestStartRowProps> = ({
	apiRequestFailedMessage,
	apiReqStreamingFailedMessage,
	cost,
	reasoningContent,
	agentarioMessages,
	handleToggle,
	isExpanded,
	message,
}) => {
	// Derive explicit state
	const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
	const apiReqComplete = useMemo(() => {
		if (message.say === "api_req_started" && message.text) {
			try {
				return isApiReqComplete(JSON.parse(message.text))
			} catch {
				return cost != null
			}
		}
		return cost != null
	}, [cost, message.say, message.text])
	const reasoningText = reasoningContent?.replace(/[\u0000-\u001F\u200B-\u200D\uFEFF]/g, "").trim() ?? ""
	const hasReasoning = reasoningText.length > 0

	const apiReqState: ApiReqState = hasError ? "error" : apiReqComplete ? "final" : hasReasoning ? "thinking" : "pre"

	// Find all exploratory tool activities that are currently in flight.
	// Tools come AFTER the api_req_started message, so we look from currentApiReq forward.
	const currentActivities = useMemo(() => {
		const currentApiReq = findCurrentApiReq(agentarioMessages)
		if (!currentApiReq) {
			return []
		}

		if (!currentApiReq.hasCost) {
			// CASE A: Current api_req is INCOMPLETE
			// Look for ask === "tool" messages AFTER the current api_req_started
			return collectToolsInRange(agentarioMessages, currentApiReq.index + 1, agentarioMessages.length)
		}
		// CASE B: Current api_req is COMPLETE - no activities to show
		return []
	}, [agentarioMessages])

	// Check if there are any completed tools in the tool group
	const hasCompletedTools = useMemo(() => {
		// Look for any completed low-stakes tool messages that would be in a tool group
		return agentarioMessages.some((msg, idx) => {
			if (msg.say === "tool" && isLowStakesTool(msg)) {
				// Check if this tool is from a completed API request
				// (looking backwards for an api_req with cost)
				for (let i = idx - 1; i >= 0; i--) {
					const prevMsg = agentarioMessages[i]
					if (prevMsg.say === "api_req_started" && prevMsg.text) {
						try {
							const info = JSON.parse(prevMsg.text)
							return isApiReqComplete(info)
						} catch {
							return false
						}
					}
				}
			}
			return false
		})
	}, [agentarioMessages])

	// Only show currentActivities if there are NO completed tools
	// (otherwise they'll be shown in the unified ToolGroupRenderer list)
	const shouldShowActivities = currentActivities.length > 0 && !hasCompletedTools

	// Initial loading ("Thinking..." before any content) is injected as a synthetic in-list
	// reasoning row in MessagesArea to avoid footer handoff flicker.

	const showActivities = apiReqState === "pre" && shouldShowActivities
	const showStreamingReasoning = hasReasoning && !apiReqComplete
	const showCompletedReasoning = hasReasoning && apiReqComplete
	const showError = apiReqState === "error"

	// Diagnostic: never return null — empty api_req was a source of squashed padding rows.
	if (!showActivities && !showStreamingReasoning && !showCompletedReasoning && !showError) {
		let costLabel = "—"
		try {
			const info = JSON.parse(message.text || "{}") as { cost?: number; cancelReason?: string }
			costLabel =
				info.cost != null
					? `cost=${info.cost}`
					: info.cancelReason
						? `cancel=${info.cancelReason}`
						: "in-progress"
		} catch {
			costLabel = "unparsed"
		}
		return (
			<div className="ml-1 text-[12px] leading-tight text-description/80 font-mono select-text break-all">
				[say=api_req_started · {costLabel} · ts={message.ts}]
			</div>
		)
	}

	return (
		<div>
			{showActivities && (
				<div className="flex items-center text-description w-full text-sm">
					<div className="ml-1 flex-1 w-full h-full">
						<div className="flex flex-col gap-0.5 w-full min-h-1">
							{currentActivities.map((activity) => (
								<div className="flex items-center gap-2 h-auto w-full overflow-hidden" key={activity.text}>
									<activity.icon className="size-2 text-foreground shrink-0" />
									<TypewriterText speed={15} text={activity.text} />
								</div>
							))}
						</div>
					</div>
				</div>
			)}
			{showStreamingReasoning && (
				<ThinkingRow
					isExpanded={true}
					isStreaming={true}
					isVisible={true}
					reasoningContent={reasoningText}
					showChevron={false}
					showTitle={true}
					title="Размышление…"
				/>
			)}
			{showCompletedReasoning && (
				<ThinkingRow
					isExpanded={isExpanded}
					isVisible={true}
					onToggle={handleToggle}
					reasoningContent={reasoningText}
					showTitle={true}
					title="Размышление"
				/>
			)}

			{showError && (
				<ErrorRow
					apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
					apiRequestFailedMessage={apiRequestFailedMessage}
					errorType="error"
					message={message}
				/>
			)}
		</div>
	)
}
