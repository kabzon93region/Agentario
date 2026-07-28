import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { StringRequest } from "@shared/proto/agentario/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useMemo, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
	/** True when lastApiReqTotalTokens is char-estimate only (no provider usage yet). */
	contextUsageApproximate?: boolean
	contextWindow?: number
	contextBudget?: ContextBudgetBreakdown
	onSendMessage?: (command: string, files: string[], images: string[]) => void
}

const ConfirmationDialog = memo<{
	onConfirm: (e: React.MouseEvent, mode: "context" | "full") => void
	onCancel: (e: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="text-sm my-2 flex flex-col gap-2">
		<span className="font-semibold text-sm">{t("contextWindow.confirmCompact")}</span>
		<div className="flex flex-col gap-1">
			<VSCodeButton
				appearance="primary"
				autoFocus
				className="text-sm w-full"
				onClick={(e) => onConfirm(e, "context")}
				type="button">
				Суммаризировать контекст (быстро)
			</VSCodeButton>
			<VSCodeButton
				appearance="secondary"
				className="text-sm w-full"
				onClick={(e) => onConfirm(e, "full")}
				type="button">
				Пересуммаризировать весь чат (медленнее)
			</VSCodeButton>
			<VSCodeButton
				appearance="secondary"
				className="text-sm w-full"
				onClick={onCancel}
				type="button">
				{t("contextWindow.cancelCompact")}
			</VSCodeButton>
		</div>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	contextUsageApproximate = false,
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

	const handleConfirm = useCallback((e: React.MouseEvent, mode: "context" | "full") => {
		e.preventDefault()
		e.stopPropagation()
		// Agentario: передаём режим суммаризации
		SlashServiceClient.condense(StringRequest.create({ value: mode === "full" ? "compact-full" : "compact" })).catch((err) =>
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
		// Prefer last measured provider usage (see getContextWindowUsage).
		// Do not fall back to a lower char-estimate mid-turn — that caused the
		// progress number to jump up after thinking, then drop on the next tool.
		const used = lastApiReqTotalTokens || contextBudget?.totalEstimated || 0
		const approximate =
			contextUsageApproximate || (!(lastApiReqTotalTokens > 0) && !!contextBudget?.totalEstimated)
		return {
			percentage: (used / contextWindow) * 100,
			max: contextWindow,
			used,
			approximate,
		}
	}, [contextBudget?.totalEstimated, contextUsageApproximate, contextWindow, lastApiReqTotalTokens])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col my-1.5">
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span className="cursor-pointer text-sm" title={t("contextWindow.usedTitle")}>
						{formatTokenNumber(tokenData.used)}
						{tokenData.approximate ? " ≈" : ""}
					</span>
					<Popover open={isOpened} onOpenChange={setIsOpened}>
						<PopoverTrigger asChild>
							<div
								className="flex relative items-center gap-1 flex-1 w-full h-full cursor-pointer"
								ref={progressBarRef}>
								<div className="relative w-full text-foreground context-window-progress brightness-100">
									<StructuredContextBar
										contextBudget={contextBudget}
										contextWindow={tokenData.max}
										totalUsed={tokenData.used}
									/>
								</div>
							</div>
						</PopoverTrigger>
						<PopoverContent className="bg-menu rounded-xs shadow-sm w-80" align="start">
							<ContextWindowSummary
								cacheReads={cacheReads}
								cacheWrites={cacheWrites}
								contextBudget={contextBudget}
								contextUsageApproximate={tokenData.approximate}
								contextWindow={tokenData.max}
								percentage={tokenData.percentage}
								tokensIn={tokensIn}
								tokensOut={tokensOut}
								tokenUsed={tokenData.used}
								useAutoCondense={useAutoCondense}
							/>
						</PopoverContent>
					</Popover>
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
