import { memo, useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface WaitingStatusRowProps {
	/** Optional override; default describes model wait. */
	label?: string
	className?: string
}

/**
 * Ephemeral UI-only status while the model is working.
 * Not written to chat history — MessagesArea injects/removes it via WAITING_ROW_TS.
 */
export const WaitingStatusRow = memo(function WaitingStatusRow({
	label = "Ожидание ответа модели",
	className,
}: WaitingStatusRowProps) {
	const [startedAt] = useState(() => Date.now())
	const [elapsedSec, setElapsedSec] = useState(0)

	useEffect(() => {
		const id = window.setInterval(() => {
			setElapsedSec(Math.max(0, (Date.now() - startedAt) / 1000))
		}, 200)
		return () => window.clearInterval(id)
	}, [startedAt])

	const timeLabel = elapsedSec < 10 ? `${elapsedSec.toFixed(1)}с` : `${Math.round(elapsedSec)}с`

	return (
		<div
			className={cn(
				"ml-1 pl-0 py-0.5 text-[13px] leading-tight text-description select-none",
				className,
			)}
			data-agentario-waiting-status="1">
			<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent">
				{label}… {timeLabel}
			</span>
		</div>
	)
})
