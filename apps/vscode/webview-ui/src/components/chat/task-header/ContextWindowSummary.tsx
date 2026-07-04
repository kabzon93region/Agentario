import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { t } from "@/i18n"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import type { ContextBudgetSegmentKey } from "./StructuredContextBar"
import { SEGMENT_COLORS } from "./StructuredContextBar"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: number
	contextWindow: number
	contextBudget?: ContextBudgetBreakdown
	useAutoCondense?: boolean
}

const AccordionItem = memo<{
	title: string
	value: React.ReactNode
	isExpanded: boolean
	onToggle: (event?: React.MouseEvent) => void
	children?: React.ReactNode
}>(({ title, value, isExpanded, onToggle, children }) => {
	const handleClick = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
			onToggle(event)
		},
		[onToggle],
	)

	return (
		<div className="flex flex-col w-full">
			<div
				className="flex justify-between items-center gap-1 cursor-pointer hover:bg-foreground/5 rounded p-0.5 transition-colors w-full"
				onClick={handleClick}>
				<div className="flex items-center gap-1">
					{isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
					<div className="font-semibold">{title}</div>
				</div>
				<div className="text-muted-foreground">{value}</div>
			</div>
			{isExpanded && children && <div className="ml-5 my-1 text-xs text-muted-foreground">{children}</div>}
		</div>
	)
})
AccordionItem.displayName = "AccordionItem"

const CATEGORY_KEYS: ContextBudgetSegmentKey[] = ["system", "rules", "tools", "chat"]

const CATEGORY_LABELS: Record<ContextBudgetSegmentKey, () => string> = {
	system: () => t("contextWindow.categorySystem"),
	rules: () => t("contextWindow.categoryRules"),
	tools: () => t("contextWindow.categoryTools"),
	chat: () => t("contextWindow.categoryChat"),
}

const TokenUsageDetails = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	if (!tokensIn) {
		return <div>{t("contextWindow.noTokenUsage")}</div>
	}
	return (
		<div className="space-y-1">
			<div className="flex justify-between">
				<span>{t("contextWindow.promptTokens")}</span>
				<span className="font-mono">{formatTokenNumber(tokensIn)}</span>
			</div>
			<div className="flex justify-between">
				<span>{t("contextWindow.completionTokens")}</span>
				<span className="font-mono">{formatTokenNumber(tokensOut || 0)}</span>
			</div>
			{(cacheWrites || 0) > 0 && (
				<div className="flex justify-between">
					<span>{t("contextWindow.cacheWrites")}</span>
					<span className="font-mono">{formatTokenNumber(cacheWrites || 0)}</span>
				</div>
			)}
			{(cacheReads || 0) > 0 && (
				<div className="flex justify-between">
					<span>{t("contextWindow.cacheReads")}</span>
					<span className="font-mono">{formatTokenNumber(cacheReads || 0)}</span>
				</div>
			)}
		</div>
	)
})
TokenUsageDetails.displayName = "TokenUsageDetails"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	percentage,
	contextBudget,
	useAutoCondense = false,
}) => {
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["categories"]))

	const toggleSection = useCallback((section: string, event?: React.MouseEvent) => {
		if (event) {
			event.preventDefault()
			event.stopPropagation()
		}
		setExpandedSections((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(section)) {
				newSet.delete(section)
			} else {
				newSet.add(section)
			}
			return newSet
		})
	}, [])

	const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

	const categoryRows = useMemo(() => {
		if (!contextBudget) {
			return []
		}
		return CATEGORY_KEYS.map((key) => ({
			key,
			label: CATEGORY_LABELS[key](),
			tokens: contextBudget.categories[key],
			colorClass: SEGMENT_COLORS[key],
			compressible: key === "chat",
		})).filter((row) => row.tokens > 0)
	}, [contextBudget])

	return (
		<div className="context-window-tooltip-content flex flex-col gap-2 bg-menu rounded shadow-sm z-100 w-72 p-1">
			{useAutoCondense && (
				<div className="text-xs text-muted-foreground px-0.5">{t("contextWindow.autoCompactEnabled")}</div>
			)}

			<AccordionItem
				isExpanded={expandedSections.has("context")}
				onToggle={(event) => toggleSection("context", event)}
				title={t("contextWindow.summaryTitle")}
				value={percentage ? `${percentage.toFixed(1)}%` : formatTokenNumber(contextWindow)}>
				<div className="space-y-1">
					<div className="flex justify-between">
						<span>{t("contextWindow.usedLabel")}</span>
						<span className="font-mono">
							{formatTokenNumber(tokenUsed)}
							{contextBudget ? " ≈" : ""}
						</span>
					</div>
					<div className="flex justify-between">
						<span>{t("contextWindow.totalLabel")}</span>
						<span className="font-mono">{formatTokenNumber(contextWindow)}</span>
					</div>
					{contextBudget && (
						<>
							<div className="flex justify-between">
								<span>{t("contextWindow.pinnedLabel")}</span>
								<span className="font-mono">≈ {formatTokenNumber(contextBudget.pinnedEstimated)}</span>
							</div>
							<div className="flex justify-between">
								<span>{t("contextWindow.compressibleLabel")}</span>
								<span className="font-mono">≈ {formatTokenNumber(contextBudget.compressibleEstimated)}</span>
							</div>
						</>
					)}
				</div>
			</AccordionItem>

			{categoryRows.length > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("categories")}
					onToggle={(event) => toggleSection("categories", event)}
					title={t("contextWindow.categoriesTitle")}
					value={`≈ ${formatTokenNumber(contextBudget?.totalEstimated ?? tokenUsed)}`}>
					<div className="space-y-1">
						{categoryRows.map((row) => (
							<div className="flex justify-between items-center gap-2" key={row.key}>
								<span className="flex items-center gap-1.5">
									<span className={`inline-block size-2 rounded-full ${row.colorClass}`} />
									{row.label}
									{row.compressible ? ` (${t("contextWindow.compressibleShort")})` : ""}
								</span>
								<span className="font-mono">≈ {formatTokenNumber(row.tokens)}</span>
							</div>
						))}
						{contextBudget?.rulesDetail && contextBudget.rulesDetail.length > 0 && (
							<div className="mt-2 space-y-0.5 border-t border-foreground/10 pt-1">
								{contextBudget.rulesDetail.map((rule) => (
									<div className="flex justify-between pl-3" key={rule.name}>
										<span className="truncate max-w-[9rem]" title={rule.name}>
											{rule.name}
										</span>
										<span className="font-mono">≈ {formatTokenNumber(rule.tokens)}</span>
									</div>
								))}
							</div>
						)}
						<p className="text-[10px] leading-snug pt-1">{t("contextWindow.estimatedHint")}</p>
					</div>
				</AccordionItem>
			)}

			{totalTokens > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("tokens")}
					onToggle={(event) => toggleSection("tokens", event)}
					title={t("contextWindow.tokenUsageTitle")}
					value={formatTokenNumber(totalTokens)}>
					<TokenUsageDetails
						cacheReads={cacheReads}
						cacheWrites={cacheWrites}
						tokensIn={tokensIn}
						tokensOut={tokensOut}
					/>
				</AccordionItem>
			)}
		</div>
	)
}
