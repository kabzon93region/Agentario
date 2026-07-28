import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { EmptyRequest } from "@shared/proto/agentario/common"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { t } from "@/i18n"
import { SlashServiceClient } from "@/services/grpc-client"
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
	/** When false, occupied count is provider-measured — do not mark ≈ */
	contextUsageApproximate?: boolean
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

const CATEGORY_KEYS: string[] = ["system", "tools", "skills", "rules", "mcp", "chat"]

const CATEGORY_LABELS: Record<string, () => string> = {
	system: () => t("contextWindow.categorySystem"),
	rules: () => t("contextWindow.categoryRules"),
	tools: () => t("contextWindow.categoryTools"),
	chat: () => t("contextWindow.categoryChat"),
	mcp: () => "MCP",
	skills: () => "Skills",
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
	contextUsageApproximate = false,
}) => {
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["categories"]))
	const [exportStatus, setExportStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null)

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
			label: CATEGORY_LABELS[key]?.() ?? key,
			tokens: contextBudget.categories[key as keyof typeof contextBudget.categories] ?? 0,
			colorClass: SEGMENT_COLORS[key] ?? "bg-gray-500/50",
			compressible: key === "chat",
		})) // Agentario: показываем все категории, включая нулевые
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
							{contextUsageApproximate ? " ≈" : ""}
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
				<>
					{/* Pinned (non-chat) categories */}
					<AccordionItem
						isExpanded={expandedSections.has("categories")}
						onToggle={(event) => toggleSection("categories", event)}
						title={t("contextWindow.categoriesTitle")}
						value={`≈ ${formatTokenNumber(contextBudget?.pinnedEstimated ?? 0)}`}>
						<div className="space-y-1">
							{categoryRows
								.filter((row) => !row.compressible)
								.map((row) => (
									<div className="flex justify-between items-center gap-2" key={row.key}>
										<span className="flex items-center gap-1.5">
											<span className={`inline-block size-2 rounded-full ${row.colorClass}`} />
											{row.label}
										</span>
										<span className="font-mono">≈ {formatTokenNumber(row.tokens)}</span>
									</div>
								))}
							<div className="flex justify-between items-center gap-2 pt-1 border-t border-foreground/20 font-semibold">
								<span>Итого (без чата)</span>
								<span className="font-mono">≈ {formatTokenNumber(contextBudget?.pinnedEstimated ?? 0)}</span>
							</div>
							<p className="text-[10px] leading-snug pt-0.5">{t("contextWindow.estimatedHint")}</p>
						</div>
					</AccordionItem>

					{/* Chat (compressible) — отдельный блок */}
					<AccordionItem
						isExpanded={expandedSections.has("chat")}
						onToggle={(event) => toggleSection("chat", event)}
						title={`${t("contextWindow.categoryChat")} (${t("contextWindow.compressibleShort")})`}
						value={`≈ ${formatTokenNumber(contextBudget?.compressibleEstimated ?? 0)}`}>
						<div className="space-y-1">
							{categoryRows
								.filter((row) => row.compressible)
								.map((row) => (
									<div className="flex justify-between items-center gap-2" key={row.key}>
										<span className="flex items-center gap-1.5">
											<span className={`inline-block size-2 rounded-full ${row.colorClass}`} />
											{row.label}
										</span>
										<span className="font-mono">≈ {formatTokenNumber(row.tokens)}</span>
									</div>
								))}
							<div className="flex justify-between items-center gap-2 pt-1 border-t border-foreground/20 font-semibold">
								<span>Итого (всего)</span>
								<span className="font-mono">≈ {formatTokenNumber(contextBudget?.totalEstimated ?? 0)}</span>
							</div>
						</div>
					</AccordionItem>
				</>
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

			{/* Export context button */}
			<button
				className="flex items-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer px-0.5 py-1 rounded hover:bg-foreground/5 transition-colors"
				onClick={async (e) => {
					e.preventDefault()
					e.stopPropagation()
					setExportStatus(null)
					try {
						const result = await SlashServiceClient.exportContextText(EmptyRequest.create({}))
						if (result?.value) {
							setExportStatus({ type: "success", message: `Экспортировано: ${result.value}` })
						} else {
							setExportStatus({
								type: "info",
								message: "Нет активной сессии — откройте таск и отправьте сообщение, затем повторите.",
							})
						}
					} catch (err) {
						console.error("Failed to export context:", err)
						setExportStatus({
							type: "error",
							message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
						})
					}
				}}>
				<span>📄</span>
				<span>Экспорт контекста в файл</span>
			</button>
			{exportStatus && (
				<div
					className={`text-[10px] px-0.5 py-0.5 rounded ${
						exportStatus.type === "success"
							? "text-green-400 bg-green-400/10"
							: exportStatus.type === "error"
								? "text-red-400 bg-red-400/10"
								: "text-yellow-400 bg-yellow-400/10"
					}`}>
					{exportStatus.message}
				</div>
			)}
		</div>
	)
}
