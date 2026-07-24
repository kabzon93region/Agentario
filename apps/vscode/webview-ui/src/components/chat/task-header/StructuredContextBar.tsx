import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

export type ContextBudgetSegmentKey = keyof ContextBudgetBreakdown["categories"]

// Agentario: порядок категорий — chat всегда последний
const CATEGORY_ORDER: ContextBudgetSegmentKey[] = ["system", "tools", "skills", "rules", "mcp", "chat"]

const SEGMENT_COLORS: Record<string, string> = {
	system: "bg-blue-500/80",
	rules: "bg-violet-500/80",
	tools: "bg-amber-500/70",
	mcp: "bg-orange-500/70",
	skills: "bg-pink-500/70",
	chat: "bg-emerald-500/80",
}

export interface StructuredContextBarProps {
	contextBudget?: ContextBudgetBreakdown
	totalUsed: number
	contextWindow: number
	className?: string
}

export const StructuredContextBar = memo(function StructuredContextBar({
	contextBudget,
	totalUsed,
	contextWindow,
	className,
}: StructuredContextBarProps) {
	const segments = useMemo(() => {
		if (!contextBudget || contextWindow <= 0) {
			return []
		}
		const cats = contextBudget.categories
		// Agentario: используем CATEGORY_ORDER для стабильного порядка (chat всегда последний)
		return CATEGORY_ORDER.map((key) => ({
			key,
			value: (cats[key] as number) ?? 0,
			widthPercent: Math.min(100, (((cats[key] as number) ?? 0) / contextWindow) * 100),
			colorClass: SEGMENT_COLORS[key] ?? "bg-gray-500/50",
		}))
	}, [contextBudget, contextWindow])

	const fallbackPercent = contextWindow > 0 ? Math.min(100, (totalUsed / contextWindow) * 100) : 0

	if (segments.length === 0) {
		return (
			<div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
				<div
					className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/80 transition-all"
					style={{ width: `${fallbackPercent}%` }}
				/>
			</div>
		)
	}

	return (
		<div
			className={cn("relative flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
			title="Structured context usage">
			{segments.map((segment) => (
				<div
					className={cn("h-full shrink-0 transition-all", segment.colorClass)}
					key={segment.key}
					style={{ width: `${segment.widthPercent}%` }}
				/>
			))}
		</div>
	)
})

export { SEGMENT_COLORS }
