export type LmStudioModelRecord = {
	id: string
	type?: string
	state?: string
	key?: string
	selectedVariant?: string
	loadedInstanceIds?: string[]
	variants?: string[]
}

export type LmStudioEmbeddingsResult = {
	embeddings: number[][]
	modelId: string
	endpoint: LmStudioEmbeddingEndpoint
}

export type LmStudioEmbeddingEndpoint = "/api/v0/embeddings" | "/v1/embeddings"

const LM_STUDIO_EMBEDDING_ENDPOINTS: LmStudioEmbeddingEndpoint[] = ["/api/v0/embeddings", "/v1/embeddings"]

type LmStudioV1Model = {
	type?: string
	key?: string
	selected_variant?: string
	variants?: string[]
	loaded_instances?: Array<{ id?: string }>
}

type LmStudioV0Model = {
	id?: string
	type?: string
	state?: string
}

export function isLmStudioEmbeddingModelType(type?: string): boolean {
	const normalized = type?.toLowerCase()
	return normalized === "embedding" || normalized === "embeddings"
}

export function lmStudioModelBaseName(id: string): string {
	const withoutQuant = id.split("@")[0] ?? id
	const segments = withoutQuant.split("/")
	return (segments[segments.length - 1] ?? withoutQuant).toLowerCase()
}

export function lmStudioModelMatches(modelId: string, requestedId: string): boolean {
	const requested = requestedId.trim()
	if (!requested) {
		return false
	}
	if (modelId === requested) {
		return true
	}
	if (modelId.startsWith(`${requested}@`)) {
		return true
	}
	if (requested.startsWith(`${modelId}@`)) {
		return true
	}
	return lmStudioModelBaseName(modelId) === lmStudioModelBaseName(requested)
}

export function recordMatchesRequested(record: LmStudioModelRecord, requestedId: string): boolean {
	const ids = collectRecordModelIds(record)
	return ids.some((id) => lmStudioModelMatches(id, requestedId))
}

export function isLmStudioModelLoaded(model: LmStudioModelRecord): boolean {
	if (model.state === "loaded") {
		return true
	}
	return (model.loadedInstanceIds?.length ?? 0) > 0
}

function collectRecordModelIds(record: LmStudioModelRecord): string[] {
	const ids = new Set<string>()
	if (record.id) {
		ids.add(record.id)
	}
	if (record.key) {
		ids.add(record.key)
	}
	for (const instanceId of record.loadedInstanceIds ?? []) {
		ids.add(instanceId)
	}
	for (const variant of record.variants ?? []) {
		ids.add(variant)
	}
	return [...ids]
}

export function buildEmbeddingRequestModelIds(record: LmStudioModelRecord, configuredId: string): string[] {
	const ids = new Set<string>()
	for (const instanceId of record.loadedInstanceIds ?? []) {
		ids.add(instanceId)
	}
	if (record.selectedVariant) {
		ids.add(record.selectedVariant)
	}
	for (const variant of record.variants ?? []) {
		ids.add(variant)
	}
	if (record.id) {
		ids.add(record.id)
	}
	if (record.key) {
		ids.add(record.key)
	}
	if (configuredId.trim()) {
		ids.add(configuredId.trim())
	}
	return [...ids]
}

function pickFromPool(models: LmStudioModelRecord[]): LmStudioModelRecord | undefined {
	if (models.length === 0) {
		return undefined
	}
	const embedding = models.find((model) => isLmStudioEmbeddingModelType(model.type))
	if (embedding) {
		return embedding
	}
	return models.find((model) => model.type === "llm") ?? models.find((model) => model.type === "vlm") ?? models[0]
}

export function pickLmStudioEmbeddingCandidate(
	models: LmStudioModelRecord[],
	configuredId: string,
): LmStudioModelRecord | undefined {
	const requested = configuredId.trim()
	if (!requested || models.length === 0) {
		return undefined
	}

	const matches = models.filter((model) => recordMatchesRequested(model, requested))
	if (matches.length === 0) {
		return undefined
	}

	const loadedMatches = matches.filter(isLmStudioModelLoaded)
	return pickFromPool(loadedMatches.length > 0 ? loadedMatches : matches)
}

export function resolveLmStudioEmbeddingModelId(
	models: LmStudioModelRecord[],
	configuredId: string,
): { modelId: string; warning?: string } {
	const requested = configuredId.trim()
	if (!requested) {
		return { modelId: configuredId }
	}

	const candidate = pickLmStudioEmbeddingCandidate(models, requested)
	if (candidate) {
		const preferredId = candidate.loadedInstanceIds?.[0] ?? candidate.id
		if (!isLmStudioModelLoaded(candidate)) {
			return {
				modelId: preferredId,
				warning: formatLmStudioEmbeddingLoadError(requested, models),
			}
		}
		if (preferredId !== requested) {
			return {
				modelId: preferredId,
				warning: `Using loaded LM Studio model id "${preferredId}" for "${requested}"`,
			}
		}
		return { modelId: preferredId }
	}

	const loadedMatches = models.filter((model) => isLmStudioModelLoaded(model) && recordMatchesRequested(model, requested))
	if (loadedMatches.length > 0) {
		const picked = pickFromPool(loadedMatches) ?? loadedMatches[0]
		const preferredId = picked.loadedInstanceIds?.[0] ?? picked.id
		return {
			modelId: preferredId,
			warning: `Resolved "${requested}" to loaded model "${preferredId}"`,
		}
	}

	return { modelId: requested, warning: formatLmStudioEmbeddingLoadError(requested, models) }
}

function normalizeV1Models(models: LmStudioV1Model[]): LmStudioModelRecord[] {
	return models.flatMap((model) => {
		if (!model.key) {
			return []
		}
		const loadedInstanceIds = (model.loaded_instances ?? [])
			.map((instance) => instance.id?.trim())
			.filter((id): id is string => Boolean(id))
		const loaded = loadedInstanceIds.length > 0
		const id = loadedInstanceIds[0] ?? model.selected_variant ?? model.key
		return [
			{
				id,
				key: model.key,
				type: model.type,
				state: loaded ? "loaded" : "not-loaded",
				loadedInstanceIds,
				variants: model.variants ?? [],
				selectedVariant: model.selected_variant,
			},
		]
	})
}

function normalizeV0Models(models: LmStudioV0Model[]): LmStudioModelRecord[] {
	return models.flatMap((model) => {
		if (!model.id) {
			return []
		}
		return [
			{
				id: model.id,
				key: model.id,
				type: model.type,
				state: model.state,
				loadedInstanceIds: model.state === "loaded" ? [model.id] : [],
				variants: [],
			},
		]
	})
}

function mergeLmStudioCatalog(v1Models: LmStudioModelRecord[], v0Models: LmStudioModelRecord[]): LmStudioModelRecord[] {
	const merged = new Map<string, LmStudioModelRecord>()
	for (const record of v1Models) {
		for (const alias of collectRecordModelIds(record)) {
			merged.set(alias.toLowerCase(), record)
		}
	}
	for (const record of v0Models) {
		const existing = [...merged.values()].find((entry) => recordMatchesRequested(entry, record.id))
		if (existing) {
			if (record.state === "loaded") {
				existing.state = "loaded"
				const ids = new Set([...(existing.loadedInstanceIds ?? []), ...(record.loadedInstanceIds ?? [record.id])])
				existing.loadedInstanceIds = [...ids]
				if (!existing.loadedInstanceIds.includes(existing.id)) {
					existing.id = record.id
				}
			}
			continue
		}
		for (const alias of collectRecordModelIds(record)) {
			merged.set(alias.toLowerCase(), record)
		}
	}
	const unique = new Map<string, LmStudioModelRecord>()
	for (const record of merged.values()) {
		unique.set(record.id, record)
	}
	return [...unique.values()]
}

async function fetchLmStudioV1Models(baseUrl: string, fetchFn: typeof fetch): Promise<LmStudioModelRecord[]> {
	try {
		const response = await fetchFn(lmStudioApiUrl(baseUrl, "/api/v1/models"))
		if (!response.ok) {
			return []
		}
		const data = (await response.json()) as { models?: LmStudioV1Model[] }
		return normalizeV1Models(data.models ?? [])
	} catch {
		return []
	}
}

async function fetchLmStudioV0Models(baseUrl: string, fetchFn: typeof fetch): Promise<LmStudioModelRecord[]> {
	try {
		const response = await fetchFn(lmStudioApiUrl(baseUrl, "/api/v0/models"))
		if (!response.ok) {
			return []
		}
		const data = (await response.json()) as { data?: LmStudioV0Model[] }
		return normalizeV0Models(data.data ?? [])
	} catch {
		return []
	}
}

export function lmStudioApiUrl(baseUrl: string, path: string): string {
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
	return new URL(path.replace(/^\//, ""), normalizedBase).href
}

export async function fetchLmStudioModels(
	baseUrl: string,
	fetchFn: typeof fetch = fetch,
): Promise<LmStudioModelRecord[]> {
	if (!URL.canParse(baseUrl)) {
		return []
	}
	const [v1Models, v0Models] = await Promise.all([
		fetchLmStudioV1Models(baseUrl, fetchFn),
		fetchLmStudioV0Models(baseUrl, fetchFn),
	])
	if (v1Models.length === 0) {
		return v0Models
	}
	return mergeLmStudioCatalog(v1Models, v0Models)
}

function parseEmbeddingsPayload(
	payload: { data?: Array<{ embedding?: number[] }>; model?: string },
	expectedCount: number,
	fallbackModelId: string,
): LmStudioEmbeddingsResult | undefined {
	const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? []
	if (embeddings.length !== expectedCount || embeddings.some((embedding) => embedding.length === 0)) {
		return undefined
	}
	return {
		embeddings,
		modelId: payload.model ?? fallbackModelId,
		endpoint: "/api/v0/embeddings",
	}
}

async function postLmStudioEmbeddings(
	baseUrl: string,
	endpoint: LmStudioEmbeddingEndpoint,
	modelId: string,
	input: string | string[],
	fetchFn: typeof fetch,
	abortSignal?: AbortSignal,
): Promise<
	| { ok: true; result: LmStudioEmbeddingsResult }
	| { ok: false; status: number; body: string }
> {
	const inputs = Array.isArray(input) ? input : [input]
	const response = await fetchFn(lmStudioApiUrl(baseUrl, endpoint), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: modelId, input }),
		signal: abortSignal,
	})
	if (!response.ok) {
		return { ok: false, status: response.status, body: await response.text().catch(() => "") }
	}
	const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }>; model?: string }
	const parsed = parseEmbeddingsPayload(payload, inputs.length, modelId)
	if (!parsed) {
		return { ok: false, status: 502, body: "LM Studio embeddings response did not contain embeddings for every input" }
	}
	return { ok: true, result: { ...parsed, endpoint } }
}

async function tryEmbeddingCandidates(
	baseUrl: string,
	modelIds: string[],
	input: string | string[],
	fetchFn: typeof fetch,
	abortSignal?: AbortSignal,
): Promise<
	| { ok: true; result: LmStudioEmbeddingsResult }
	| { ok: false; status: number; body: string; retriable: boolean }
> {
	let lastFailure: { ok: false; status: number; body: string; retriable: boolean } = {
		ok: false,
		status: 503,
		body: "No models loaded",
		retriable: true,
	}
	for (const modelId of modelIds) {
		for (const endpoint of LM_STUDIO_EMBEDDING_ENDPOINTS) {
			const attempt = await postLmStudioEmbeddings(baseUrl, endpoint, modelId, input, fetchFn, abortSignal)
			if (attempt.ok) {
				return attempt
			}
			lastFailure = {
				ok: false,
				status: attempt.status,
				body: attempt.body,
				retriable: isLmStudioNoModelLoadedError(attempt.body),
			}
			if (!lastFailure.retriable) {
				return lastFailure
			}
		}
	}
	return lastFailure
}

export class LmStudioEmbeddingClient {
	private catalog: LmStudioModelRecord[] = []
	private candidateRecord?: LmStudioModelRecord
	private resolvedModelId?: string
	private resolvedEndpoint?: LmStudioEmbeddingEndpoint
	private requestModelIds: string[] = []

	constructor(
		private readonly baseUrl: string,
		private readonly configuredModel: string,
		private readonly fetchFn: typeof fetch = fetch,
	) {}

	private configuredModelIds(): string[] {
		const configured = this.configuredModel.trim()
		return configured ? [configured] : []
	}

	private async resolveRequestModelIds(): Promise<string[]> {
		if (this.requestModelIds.length > 0) {
			return this.requestModelIds
		}
		this.catalog = await fetchLmStudioModels(this.baseUrl, this.fetchFn)
		this.candidateRecord = pickLmStudioEmbeddingCandidate(this.catalog, this.configuredModel)
		if (this.candidateRecord) {
			this.requestModelIds = buildEmbeddingRequestModelIds(this.candidateRecord, this.configuredModel)
		}
		const merged = new Set<string>([...this.configuredModelIds(), ...this.requestModelIds])
		return [...merged]
	}

	private async ensureEmbeddingCapableModel(): Promise<void> {
		if (this.catalog.length === 0) {
			this.catalog = await fetchLmStudioModels(this.baseUrl, this.fetchFn)
		}
		this.candidateRecord = pickLmStudioEmbeddingCandidate(this.catalog, this.configuredModel)
		if (
			this.candidateRecord &&
			isLmStudioModelLoaded(this.candidateRecord) &&
			!isLmStudioEmbeddingModelType(this.candidateRecord.type)
		) {
			throw new Error(formatLmStudioNonEmbeddingModelError(this.configuredModel, this.catalog))
		}
	}

	async initialize(): Promise<{ modelId: string; endpoint: LmStudioEmbeddingEndpoint }> {
		await this.ensureEmbeddingCapableModel()

		const direct = await tryEmbeddingCandidates(this.baseUrl, this.configuredModelIds(), "ping", this.fetchFn)
		if (direct.ok) {
			this.resolvedModelId = direct.result.modelId
			this.resolvedEndpoint = direct.result.endpoint
			return { modelId: this.resolvedModelId, endpoint: this.resolvedEndpoint }
		}

		const modelIds = await this.resolveRequestModelIds()
		const probe = await tryEmbeddingCandidates(this.baseUrl, modelIds, "ping", this.fetchFn)
		if (!probe.ok) {
			throw new Error(formatLmStudioEmbeddingLoadError(this.configuredModel, this.catalog))
		}
		this.resolvedModelId = probe.result.modelId
		this.resolvedEndpoint = probe.result.endpoint
		return { modelId: this.resolvedModelId, endpoint: this.resolvedEndpoint }
	}

	async embed(inputs: string[], abortSignal?: AbortSignal): Promise<LmStudioEmbeddingsResult> {
		if (!this.resolvedModelId || !this.resolvedEndpoint) {
			await this.initialize()
		}
		const primary = await postLmStudioEmbeddings(
			this.baseUrl,
			this.resolvedEndpoint!,
			this.resolvedModelId!,
			inputs,
			this.fetchFn,
			abortSignal,
		)
		if (primary.ok) {
			return primary.result
		}
		const fallback = await tryEmbeddingCandidates(
			this.baseUrl,
			await this.resolveRequestModelIds(),
			inputs,
			this.fetchFn,
			abortSignal,
		)
		if (!fallback.ok) {
			if (isLmStudioNoModelLoadedError(fallback.body)) {
				throw new Error(formatLmStudioEmbeddingLoadError(this.configuredModel, this.catalog))
			}
			throw new Error(
				`LM Studio embeddings failed: HTTP ${fallback.status}${fallback.body ? `: ${fallback.body.slice(0, 500)}` : ""}`,
			)
		}
		this.resolvedModelId = fallback.result.modelId
		this.resolvedEndpoint = fallback.result.endpoint
		return fallback.result
	}

	getResolvedModelId(): string | undefined {
		return this.resolvedModelId
	}
}

export async function requestLmStudioEmbeddings(
	baseUrl: string,
	configuredModel: string,
	input: string | string[],
	fetchFn: typeof fetch = fetch,
	options?: { abortSignal?: AbortSignal },
): Promise<LmStudioEmbeddingsResult> {
	const client = new LmStudioEmbeddingClient(baseUrl, configuredModel, fetchFn)
	const payload = Array.isArray(input) ? input : [input]
	return client.embed(payload, options?.abortSignal)
}

export function listLmStudioEmbeddingCapableModels(models: LmStudioModelRecord[]): LmStudioModelRecord[] {
	return models.filter((model) => isLmStudioEmbeddingModelType(model.type))
}

export function formatLmStudioNonEmbeddingModelError(configuredId: string, models: LmStudioModelRecord[]): string {
	const embeddingModels = listLmStudioEmbeddingCapableModels(models)
	const embeddingSuggestions = embeddingModels
		.map((model) => {
			const status = isLmStudioModelLoaded(model) ? "loaded" : "not loaded"
			return `${model.id} (${status})`
		})
		.slice(0, 5)
	const selected = pickLmStudioEmbeddingCandidate(models, configuredId)
	const selectedType = selected?.type ?? "llm"
	return [
		`«${configuredId}» загружена в LM Studio как ${selectedType}, не как embedding.`,
		"API /api/v0/embeddings и /v1/embeddings принимают только модели типа embedding/embeddings (отдельный слот LM Studio).",
		"Модель в LLM-слоте (рядом с qwen/qwen3.5-9b) для индексации через LM Studio не подходит — нужны векторы, а не текст.",
		embeddingSuggestions.length > 0
			? `Для индексации загрузите embedding-модель, например: ${embeddingSuggestions.join(", ")}.`
			: "Скачайте и загрузите embedding-модель (nomic-embed, qwen3-embedding и т.п.) в Developer LM Studio.",
		"Либо: My Models → ⚙️ → Domain Type → Embedding для этой модели, затем перезагрузите (может конфликтовать с chat-моделями).",
	].join(" ")
}

export function formatLmStudioEmbeddingLoadError(configuredId: string, models: LmStudioModelRecord[]): string {
	const selected = pickLmStudioEmbeddingCandidate(models, configuredId)
	if (selected && isLmStudioModelLoaded(selected) && !isLmStudioEmbeddingModelType(selected.type)) {
		return formatLmStudioNonEmbeddingModelError(configuredId, models)
	}
	const loaded = models
		.filter(isLmStudioModelLoaded)
		.map((model) => `${model.loadedInstanceIds?.[0] ?? model.id}${model.type ? ` (${model.type})` : ""}`)
	if (loaded.length === 0) {
		const suggestions = listLmStudioEmbeddingCapableModels(models)
			.map((model) => model.id)
			.slice(0, 3)
		return `LM Studio embeddings: нет загруженных моделей. Загрузите embedding-модель${suggestions.length ? ` (${suggestions.join(", ")})` : ""} в Developer LM Studio.`
	}
	return `LM Studio embeddings: «${configuredId}» недоступна. Загружено: ${loaded.join(", ")}. Выберите embedding-модель (type: embeddings).`
}

export function isLmStudioNoModelLoadedError(body: string): boolean {
	const lower = body.toLowerCase()
	return (
		lower.includes("no models loaded") ||
		lower.includes("model is not loaded") ||
		lower.includes("model is not embedding")
	)
}
