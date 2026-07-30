import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ThinkingRowProps {
	showTitle: boolean
	reasoningContent?: string
	isVisible: boolean
	isExpanded: boolean
	onToggle?: () => void
	title?: string
	isStreaming?: boolean
	showChevron?: boolean
}

export const ThinkingRow = memo(
	({
		showTitle = false,
		reasoningContent,
		isVisible,
		isExpanded,
		onToggle,
		title = "Thinking",
		isStreaming = false,
		showChevron = true,
	}: ThinkingRowProps) => {
		const contentEndRef = useRef<HTMLDivElement>(null)

		// While streaming, keep the latest reasoning in view (chat also pins to bottom).
		useEffect(() => {
			if (!isStreaming || !isExpanded || !isVisible) {
				return
			}
			contentEndRef.current?.scrollIntoView({ block: "nearest" })
		}, [reasoningContent, isStreaming, isExpanded, isVisible])

		if (!isVisible) {
			return null
		}

		// Don't render anything if collapsed and no title (nothing to show)
		if (!isExpanded && !showTitle) {
			return null
		}

		return (
			<div className="ml-1 pl-0 mb-0 -mt-[2px]">
				{showTitle ? (
					<div
						className={cn(
							// Stick to the top of the chat scroller while reading a long expanded block,
							// so the user can collapse without scrolling back to the start.
							"sticky top-0 z-10 -mx-1 px-1 py-0.5",
							"bg-[var(--vscode-sideBar-background)]",
						)}>
						<Button
							className={cn(
								"inline-flex justify-baseline gap-0.5 text-left select-none px-0 py-0 my-0 h-auto min-h-0 w-full text-description overflow-visible",
								{
									"cursor-pointer": !!onToggle,
									"cursor-default": !onToggle,
								},
							)}
							onClick={onToggle}
							size="icon"
							variant="icon">
							<span
								className={cn("text-[13px] leading-[1.2]", {
									"animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent":
										isStreaming,
									"select-none": isStreaming,
								})}>
								{title}
							</span>
							{showChevron &&
								(isExpanded ? (
									<ChevronDownIcon className="!size-1 text-description" />
								) : (
									<ChevronRightIcon className="!size-1 text-description" />
								))}
						</Button>
					</div>
				) : null}

				{isExpanded && (
					<div className="text-description leading-normal whitespace-pre-wrap break-words pl-0">
						<span className="pb-2 block text-sm">{reasoningContent}</span>
						<div aria-hidden className="h-0 w-0" ref={contentEndRef} />
					</div>
				)}
			</div>
		)
	},
)

ThinkingRow.displayName = "ThinkingRow"
