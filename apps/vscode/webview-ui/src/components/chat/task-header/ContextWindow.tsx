import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { t } from "@/i18n"
import { SlashServiceClient } from "@/services/grpc-client"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import CompactTaskButton from "./buttons/CompactTaskButton"
import { ContextWindowSummary } from "./ContextWindowSummary"
import { StructuredContextBar } from "./StructuredContextBar"

interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

interface ContextWindowProgressProps extends ContextWindowInfoProps {
	useAutoCondense: boolean
	lastApiReqTotalTokens?: number
	contextWindow?: number
	contextBudget?: ContextBudgetBreakdown
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const ConfirmationDialog = memo<{
	onConfirm: (e: React.MouseEvent) => void
	onCancel: (e: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="text-sm my-2 flex items-center gap-0 justify-between">
		<span className="font-semibold text-sm">{t("contextWindow.confirmCompact")}</span>
		<span className="flex gap-1">
			<VSCodeButton appearance="secondary" className="text-sm" onClick={onCancel} type="button">
				{t("contextWindow.cancelCompact")}
			</VSCodeButton>
			<VSCodeButton appearance="primary" autoFocus className="text-sm" onClick={onConfirm} type="button">
				{t("contextWindow.yesCompact")}
			</VSCodeButton>
		</span>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	contextBudget,
	useAutoCondense,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
}) => {
	const [isOpened, setIsOpened] = useState(false)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)
	const progressBarRef = useRef<HTMLDivElement>(null)

	const handleCompactClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setConfirmationNeeded(!confirmationNeeded)
		},
		[confirmationNeeded],
	)

	const handleConfirm = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		SlashServiceClient.condense(StringRequest.create({ value: "compact" })).catch((err) =>
			console.error("Failed to compact task:", err),
		)
		setConfirmationNeeded(false)
	}, [])

	const handleCancel = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	const tokenData = useMemo(() => {
		if (!contextWindow) {
			return null
		}
		const used = contextBudget?.totalEstimated ?? lastApiReqTotalTokens
		return {
			percentage: (used / contextWindow) * 100,
			max: contextWindow,
			used,
		}
	}, [contextBudget?.totalEstimated, contextWindow, lastApiReqTotalTokens])

	const debounceCloseHover = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const showHover = debounce((open: boolean) => setIsOpened(open), 100)
		return showHover(false)
	}, [])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Element
			const isInsideProgressBar = progressBarRef.current?.contains(target as Node)
			const isInsideTooltipContent = target.closest(".context-window-tooltip-content") !== null
			if (!isInsideProgressBar && !isInsideTooltipContent) {
				setIsOpened(false)
			}
		}
		if (isOpened) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpened])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col my-1.5" onMouseLeave={debounceCloseHover}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span className="cursor-pointer text-sm" title={t("contextWindow.usedTitle")}>
						{formatTokenNumber(tokenData.used)}
						{contextBudget ? " ≈" : ""}
					</span>
					<div
						className="flex relative items-center gap-1 flex-1 w-full h-full"
						onMouseEnter={() => setIsOpened(true)}
						ref={progressBarRef}>
						<HoverCard open={isOpened}>
							<HoverCardContent className="bg-menu rounded-xs shadow-sm">
								<ContextWindowSummary
									cacheReads={cacheReads}
									cacheWrites={cacheWrites}
									contextBudget={contextBudget}
									contextWindow={tokenData.max}
									percentage={tokenData.percentage}
									tokensIn={tokensIn}
									tokensOut={tokensOut}
									tokenUsed={tokenData.used}
									useAutoCondense={useAutoCondense}
								/>
							</HoverCardContent>
							<HoverCardTrigger asChild>
								<div className="relative w-full text-foreground context-window-progress brightness-100">
									<StructuredContextBar
										contextBudget={contextBudget}
										contextWindow={tokenData.max}
										totalUsed={tokenData.used}
									/>
								</div>
							</HoverCardTrigger>
						</HoverCard>
					</div>
					<span className="cursor-pointer text-sm" title={t("contextWindow.maxTitle")}>
						{formatTokenNumber(tokenData.max)}
					</span>
				</div>
				<CompactTaskButton onClick={handleCompactClick} />
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindow)
