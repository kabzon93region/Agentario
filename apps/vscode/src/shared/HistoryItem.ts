export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean

	modelId?: string

	/** Последний расчёт бюджета контекста (system/rules/tools/chat). Сохраняется для отображения структурной полоски в истории. */
	lastContextBudget?: import("@shared/getApiMetrics").ContextBudgetBreakdown

	/** Цвет плашки таска (hex без #, например "3b82f6"). Пользователь задаёт через ПКМ. */
	taskColor?: string
}
