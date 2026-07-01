import { EmptyRequest } from "@shared/proto/cline/common"
import { CodebaseIndex, IndexedFile, IndexedFileStatus } from "@shared/proto/cline/indexing"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { DebouncedTextField } from "@/components/settings/common/DebouncedTextField"
import { DropdownContainer } from "@/components/settings/common/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { IndexingServiceClient, ModelsServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"

const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"

type IndexingViewProps = {
	onDone: () => void
}

interface LmStudioApiModel {
	id: string
	type?: string
	state?: string
	key?: string
	loadedInstanceIds?: string[]
}

function statusLabel(status: IndexedFileStatus): string {
	switch (status) {
		case IndexedFileStatus.INDEXED_FILE_STATUS_INDEXED:
			return "ok"
		case IndexedFileStatus.INDEXED_FILE_STATUS_PARTIAL:
			return "part"
		case IndexedFileStatus.INDEXED_FILE_STATUS_SKIPPED:
			return "skip"
		case IndexedFileStatus.INDEXED_FILE_STATUS_ERROR:
			return "err"
		default:
			return "…"
	}
}

function statusColor(status: IndexedFileStatus): string {
	switch (status) {
		case IndexedFileStatus.INDEXED_FILE_STATUS_INDEXED:
			return "var(--vscode-testing-iconPassed)"
		case IndexedFileStatus.INDEXED_FILE_STATUS_PARTIAL:
			return "var(--vscode-editorWarning-foreground)"
		case IndexedFileStatus.INDEXED_FILE_STATUS_SKIPPED:
			return "var(--vscode-descriptionForeground)"
		case IndexedFileStatus.INDEXED_FILE_STATUS_ERROR:
			return "var(--vscode-errorForeground)"
		default:
			return "var(--vscode-descriptionForeground)"
	}
}

function formatBytes(size: number): string {
	if (size < 1024) {
		return `${size} B`
	}
	if (size < 1024 * 1024) {
		return `${Math.round(size / 1024)} KB`
	}
	return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isEmbeddingCapableType(type?: string): boolean {
	const normalized = type?.toLowerCase()
	return normalized === "embedding" || normalized === "embeddings"
}

function formatLmStudioModelLabel(model: LmStudioApiModel): string {
	const tags: string[] = []
	if (model.type) {
		tags.push(model.type)
	}
	if (model.state === "loaded") {
		tags.push("loaded")
	}
	if (!isEmbeddingCapableType(model.type)) {
		tags.push("не для /embeddings")
	}
	return tags.length > 0 ? `${model.id} (${tags.join(", ")})` : model.id
}

const IndexingView = ({ onDone }: IndexingViewProps) => {
	const { apiConfiguration, environment } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const [index, setIndex] = useState<CodebaseIndex | undefined>(undefined)
	const [isWorking, setIsWorking] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)
	const [lmStudioModels, setLmStudioModels] = useState<LmStudioApiModel[]>([])

	const lmStudioBaseUrl = apiConfiguration?.lmStudioBaseUrl?.trim() || "http://localhost:1234"
	const configuredEmbeddingModel = apiConfiguration?.lmStudioEmbeddingModelId?.trim() || DEFAULT_EMBEDDING_MODEL

	const loadLmStudioModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getLmStudioModels({ value: lmStudioBaseUrl })
			if (response?.values) {
				setLmStudioModels(response.values.map((value) => JSON.parse(value) as LmStudioApiModel))
			}
		} catch (caught) {
			console.error("Failed to load LM Studio models for indexing:", caught)
		}
	}, [lmStudioBaseUrl])

	const loadStatus = useCallback(async () => {
		setError(undefined)
		const response = await IndexingServiceClient.getIndexStatus(EmptyRequest.create({}))
		setIndex(response)
	}, [])

	const runAction = useCallback(
		async (action: "clear" | "rebuild" | "update") => {
			setIsWorking(true)
			setError(undefined)
			try {
				if (action === "clear") {
					const confirmed = window.confirm("Очистить локальный embedding-индекс для этого workspace?")
					if (!confirmed) {
						return
					}
					setIndex(await IndexingServiceClient.clearIndex(EmptyRequest.create({})))
				} else if (action === "rebuild") {
					setIndex(await IndexingServiceClient.rebuildIndex(EmptyRequest.create({})))
				} else {
					setIndex(await IndexingServiceClient.updateIndex(EmptyRequest.create({})))
				}
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught))
			} finally {
				setIsWorking(false)
			}
		},
		[],
	)

	useEffect(() => {
		loadStatus().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
	}, [loadStatus])

	useEffect(() => {
		loadLmStudioModels().catch((caught) => console.error(caught))
	}, [loadLmStudioModels])

	const selectedEmbeddingModelId = configuredEmbeddingModel
	const embeddingModelOptions = useMemo(() => {
		if (lmStudioModels.length === 0) {
			return []
		}
		const embeddingOnly = lmStudioModels.filter((model) => isEmbeddingCapableType(model.type))
		const pool = embeddingOnly.length > 0 ? embeddingOnly : lmStudioModels
		const sorted = [...pool].sort((a, b) => {
			if (a.state === "loaded" && b.state !== "loaded") {
				return -1
			}
			if (b.state === "loaded" && a.state !== "loaded") {
				return 1
			}
			return (a.key ?? a.id).localeCompare(b.key ?? b.id)
		})
		const hasSelected = sorted.some(
			(model) =>
				model.id === selectedEmbeddingModelId ||
				model.key === selectedEmbeddingModelId ||
				model.loadedInstanceIds?.includes(selectedEmbeddingModelId),
		)
		if (!hasSelected && selectedEmbeddingModelId) {
			return [{ id: selectedEmbeddingModelId, key: selectedEmbeddingModelId }, ...sorted]
		}
		return sorted
	}, [lmStudioModels, selectedEmbeddingModelId])

	const selectedModelRecord = useMemo(
		() =>
			lmStudioModels.find(
				(model) =>
					model.id === selectedEmbeddingModelId ||
					model.key === selectedEmbeddingModelId ||
					model.loadedInstanceIds?.includes(selectedEmbeddingModelId),
			),
		[lmStudioModels, selectedEmbeddingModelId],
	)
	const selectedIsNonEmbedding =
		selectedModelRecord !== undefined && !isEmbeddingCapableType(selectedModelRecord.type)

	const files: IndexedFile[] = index?.files ?? []
	const partialCount = files.filter((file) => file.status === IndexedFileStatus.INDEXED_FILE_STATUS_PARTIAL).length
	const updatedAt = index?.updatedAtMs ? new Date(Number(index.updatedAtMs)).toLocaleString() : "never"
	const busy = isWorking || index?.isIndexing
	const activeEmbeddingModel = index?.embeddingModel || configuredEmbeddingModel
	const loadedEmbeddingHint =
		lmStudioModels.filter((model) => model.state === "loaded" && isEmbeddingCapableType(model.type)).length > 0
			? lmStudioModels
					.filter((model) => model.state === "loaded" && isEmbeddingCapableType(model.type))
					.map((model) => formatLmStudioModelLabel(model))
					.join(", ")
			: "нет загруженных embedding-моделей"

	return (
		<div className="fixed inset-0 flex flex-col">
			<ViewHeader environment={environment} onDone={onDone} title="Индексация кода" />
			<div className="sticky top-0 z-10 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-5 pb-3">
				<div className="mb-2 grid gap-1 text-[11px] text-description leading-tight">
					<div className="truncate" title={index?.workspacePath}>
						Workspace: {index?.workspacePath || "unknown"}
					</div>
					<div>LM Studio: {index?.baseUrl || lmStudioBaseUrl}</div>
					<div>Updated: {updatedAt}</div>
				</div>
				<div className="mb-2">
					{embeddingModelOptions.length > 0 ? (
						<DropdownContainer className="dropdown-container" zIndex={10}>
							<VSCodeDropdown
								className="w-full"
								onChange={(event: any) => {
									const value = event?.target?.value
									if (typeof value === "string") {
										const selected = lmStudioModels.find(
											(model) =>
												model.id === value ||
												model.key === value ||
												model.loadedInstanceIds?.includes(value),
										)
										handleFieldChange("lmStudioEmbeddingModelId", (selected?.key ?? value).trim() || undefined)
									}
								}}
								value={selectedEmbeddingModelId}>
								{embeddingModelOptions.map((model) => (
									<VSCodeOption className="w-full" key={model.id} value={model.key ?? model.id}>
										{formatLmStudioModelLabel(model)}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<p className="mt-0.5 text-[11px] font-medium">Embedding-модель (LM Studio)</p>
						</DropdownContainer>
					) : (
						<DebouncedTextField
							initialValue={apiConfiguration?.lmStudioEmbeddingModelId ?? ""}
							onChange={(value) => handleFieldChange("lmStudioEmbeddingModelId", value.trim() || undefined)}
							placeholder={DEFAULT_EMBEDDING_MODEL}
							style={{ width: "100%" }}>
							<span className="text-[11px] font-medium">Embedding-модель (LM Studio)</span>
						</DebouncedTextField>
					)}
					<p className="mt-0.5 text-[10px] text-description leading-tight">
						Семантическая индексация требует embedding-модель (type: embeddings) в LM Studio — не chat/llm.
						lfm2.5-embedding-350m в LLM-слоте для /embeddings недоступна. Загрузите, например, text-embedding-qwen3-embedding-0.6b
						в Developer. Загружено embedding: {loadedEmbeddingHint}. Сейчас в индексе: {activeEmbeddingModel}.
					</p>
					{selectedIsNonEmbedding && (
						<p className="mt-1 text-[10px] text-[var(--vscode-errorForeground)] leading-tight">
							Выбранная модель имеет type «{selectedModelRecord?.type ?? "llm"}» — LM Studio не отдаст векторы через
							/embeddings. Выберите модель с type embeddings.
						</p>
					)}
				</div>
				<div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-tight">
					<span>Total: {index?.totalFiles ?? 0}</span>
					<span>
						Indexed: {index?.indexedFiles ?? 0}
						{partialCount > 0 ? ` (${partialCount} partial)` : ""}
					</span>
					<span>Skipped: {index?.skippedFiles ?? 0}</span>
					<span>Errors: {index?.errorFiles ?? 0}</span>
				</div>
				<div className="mb-2 text-[10px] text-description leading-tight">
					Большие файлы — частично: до 12 чанков (~24 KB) или первые 2 MB.
				</div>
				<div className="flex flex-wrap gap-1.5">
					<VSCodeButton appearance="secondary" disabled={busy} onClick={() => runAction("clear")}>
						Очистить
					</VSCodeButton>
					<VSCodeButton disabled={busy} onClick={() => runAction("rebuild")}>
						Пересоздать
					</VSCodeButton>
					<VSCodeButton appearance="secondary" disabled={busy} onClick={() => runAction("update")}>
						Обновить новые
					</VSCodeButton>
					<VSCodeButton appearance="secondary" disabled={busy} onClick={loadStatus}>
						Обновить список
					</VSCodeButton>
					<VSCodeButton appearance="secondary" disabled={busy} onClick={() => loadLmStudioModels()}>
						Обновить модели LM Studio
					</VSCodeButton>
				</div>
				{busy && (
					<div className="mt-2 flex items-center gap-1.5 text-[11px] text-description">
						<VSCodeProgressRing style={{ height: 12, width: 12 }} />
						Идёт индексация…
					</div>
				)}
				{(error || index?.lastError) && (
					<div className="mt-2 text-[11px] text-[var(--vscode-errorForeground)]">{error || index?.lastError}</div>
				)}
			</div>
			<div className="flex-1 overflow-auto px-5 py-2">
				{files.length === 0 ? (
					<div className="text-xs text-description">Индекс пуст. Нажмите «Пересоздать».</div>
				) : (
					<div className="flex flex-wrap gap-1 content-start">
						{files.map((file) => {
							const title = [
								file.path,
								file.error,
								`${file.chunks} chunks · ${file.embeddingCount} emb · ${formatBytes(Number(file.size))}`,
							]
								.filter(Boolean)
								.join("\n")
							return (
								<div
									className="inline-flex max-w-full items-center gap-1 rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-inactiveSelectionBackground)] px-1 py-px text-[10px] leading-none"
									key={file.path}
									title={title}>
									<span className="min-w-0 truncate max-w-[min(100%,22rem)]">{file.path}</span>
									<span
										className="shrink-0 rounded px-0.5 font-medium uppercase tracking-tight"
										style={{ color: statusColor(file.status) }}>
										{statusLabel(file.status)}
									</span>
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}

export default IndexingView
