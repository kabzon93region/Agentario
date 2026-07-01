import type { ClineApiReqInfo } from "@shared/ExtensionMessage"
import { formatMessageStatsLine } from "@shared/message-display"

interface MessageStatsFooterProps {
	stats?: ClineApiReqInfo
}

const MessageStatsFooter: React.FC<MessageStatsFooterProps> = ({ stats }) => {
	const line = stats ? formatMessageStatsLine(stats) : undefined
	if (!line) {
		return null
	}

	return (
		<div className="mt-1 select-text cursor-text text-[10px] leading-tight opacity-45 tabular-nums">{line}</div>
	)
}

export default MessageStatsFooter
