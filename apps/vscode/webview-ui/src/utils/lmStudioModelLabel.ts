export interface LmStudioApiModel {
	id: string
	type?: string
	state?: string
	key?: string
	loadedInstanceIds?: string[]
	max_context_length?: number
	loaded_context_length?: number
}

export function isEmbeddingLmStudioType(type?: string): boolean {
	const normalized = type?.toLowerCase()
	return normalized === "embedding" || normalized === "embeddings"
}

/** Подпись модели для индексации (embedding). */
export function formatLmStudioEmbeddingModelLabel(model: LmStudioApiModel): string {
	const tags: string[] = []
	if (model.type) {
		tags.push(model.type)
	}
	if (model.state === "loaded") {
		tags.push("loaded")
	}
	if (!isEmbeddingLmStudioType(model.type)) {
		tags.push("не для /embeddings")
	}
	return tags.length > 0 ? `${model.id} (${tags.join(", ")})` : model.id
}

/** Подпись модели для чата/агента (LLM). */
export function formatLmStudioAgentModelLabel(model: LmStudioApiModel): string {
	const tags: string[] = []
	if (model.type) {
		tags.push(model.type)
	}
	if (model.state === "loaded") {
		tags.push("loaded")
	} else if (model.state && model.state !== "not-loaded") {
		tags.push(model.state)
	}
	if (isEmbeddingLmStudioType(model.type)) {
		tags.push("не для чата")
	}
	return tags.length > 0 ? `${model.id} (${tags.join(", ")})` : model.id
}

export function sortLmStudioModelsForPicker<T extends LmStudioApiModel>(models: T[]): T[] {
	return [...models].sort((a, b) => {
		if (a.state === "loaded" && b.state !== "loaded") {
			return -1
		}
		if (b.state === "loaded" && a.state !== "loaded") {
			return 1
		}
		return a.id.localeCompare(b.id)
	})
}
