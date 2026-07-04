import type { ContextBudgetBreakdown } from "@shared/getApiMetrics"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

export type ContextBudgetSegmentKey = keyof ContextBudgetBreakdown["categories"]

const SEGMENT_COLORS: Record<ContextBudgetSegmentKey, string> = {
	system: "bg-blue-500/80",
	rules: "bg-violet-500/80",
	tools: "bg-amber-500/70",
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
		const entries = Object.entries(contextBudget.categories) as Array<[ContextBudgetSegmentKey, number]>
		return entries
			.filter(([, value]) => value > 0)
			.map(([key, value]) => ({
				key,
				value,
				widthPercent: Math.min(100, (value / contextWindow) * 100),
				colorClass: SEGMENT_COLORS[key],
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
