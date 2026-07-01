import { formatMessageTimestamp, getMessageBubbleRole } from "@shared/message-display"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface MessageBubbleHeaderProps {
	message: ClineMessage
	roleOverride?: string
}

const MessageBubbleHeader: React.FC<MessageBubbleHeaderProps> = ({ message, roleOverride }) => {
	const { preferredLanguage } = useExtensionState()
	const role = roleOverride ?? getMessageBubbleRole(message)
	if (!role) {
		return null
	}

	const locale = preferredLanguage === "Russian" ? "ru-RU" : preferredLanguage === "English" ? "en-US" : undefined

	return (
		<div className="flex items-baseline gap-2 mb-1 select-text text-[10px] leading-tight opacity-55">
			<span className="font-medium">{role}</span>
			{message.createdAtMs != null && (
				<span className="font-normal tabular-nums">{formatMessageTimestamp(message.createdAtMs, locale)}</span>
			)}
		</div>
	)
}

export default MessageBubbleHeader
