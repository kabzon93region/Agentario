export interface ContextBudgetRuleDetail {
	name: string
	tokens: number
}

export interface ContextBudgetCategories {
	system: number
	rules: number
	tools: number
	chat: number
}

/** Estimated token breakdown for one model request (categories are approximate). */
export interface ContextBudgetBreakdown {
	contextWindow: number
	totalEstimated: number
	pinnedEstimated: number
	compressibleEstimated: number
	categories: ContextBudgetCategories
	rulesDetail?: ContextBudgetRuleDetail[]
	measuredAt?: number
}

export const CONTEXT_BUDGET_NOTICE_KIND = "context-budget" as const
