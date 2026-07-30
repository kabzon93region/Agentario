import { EmptyRequest } from "@shared/proto/agentario/common"
import { UpdateSettingsRequest } from "@shared/proto/agentario/state"
import { CodebaseIndex, IndexedFile, IndexedFileStatus } from "@shared/proto/agentario/indexing"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { DebouncedTextField } from "@/components/settings/common/DebouncedTextField"
import { DropdownContainer } from "@/components/settings/common/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { IndexingServiceClient, ModelsServiceClient, StateServiceClient } from "@/services/grpc-client"
import {
	formatLmStudioEmbeddingModelLabel,
	isEmbeddingLmStudioType,
	sortLmStudioModelsForPicker,
	type LmStudioApiModel,
} from "@/utils/lmStudioModelLabel"
import ViewHeader from "../common/ViewHeader"
import { logAgentarioScreenView } from "@/utils/agentario-ui-logger"

const DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"

type IndexingViewProps = {
	onDone: () => void
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

const IndexingView = ({ onDone }: IndexingViewProps) => {
	const {
		apiConfiguration,
		environment,
		codebaseIndexMode = "local",
		codebaseIndexAiBackend = "lmstudio",
		codebaseIndexBaseUrl,
		codebaseIndexEmbeddingModelId,
	} = useExtensionState()
	const [index, setIndex] = useState<CodebaseIndex | undefined>(undefined)
	const [isWorking, setIsWorking] = useState(false)
	const [clearConfirmPending, setClearConfirmPending] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)
	const [lmStudioModels, setLmStudioModels] = useState<LmStudioApiModel[]>([])

	const lmStudioBaseUrl = apiConfiguration?.lmStudioBaseUrl?.trim() || "http://localhost:1234"
	const configuredEmbeddingModel =
		codebaseIndexEmbeddingModelId?.trim() || apiConfiguration?.lmStudioEmbeddingModelId?.trim() || DEFAULT_EMBEDDING_MODEL
	const usesAiEmbeddings = codebaseIndexMode !== "local"
	const showRemoteUrl = codebaseIndexMode === "remote-ai" || (codebaseIndexMode === "local-ai" && codebaseIndexAiBackend === "ollama")

	const persistIndexSetting = useCallback(async (request: UpdateSettingsRequest) => {
		await StateServiceClient.updateSettings(request)
	}, [])

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
			if (action === "clear" && !clearConfirmPending) {
				setClearConfirmPending(true)
				setError(undefined)
				return
			}
			setIsWorking(true)
			setError(undefined)
			try {
				if (action === "clear") {
					setClearConfirmPending(false)
					const cleared = await IndexingServiceClient.clearIndex(EmptyRequest.create({}))
					setIndex({
						...cleared,
						files: cleared.files ?? [],
						totalFiles: 0,
						indexedFiles: 0,
						skippedFiles: 0,
						errorFiles: 0,
						indexSizeBytes: 0,
						isIndexing: false,
						progressCurrent: 0,
						progressTotal: 0,
						progressPath: undefined,
						updatedAtMs: 0,
					})
				} else if (action === "rebuild") {
				setClearConfirmPending(false)
				// Optimistic: start polling before the blocking RPC returns.
				setIndex((prev) => ({
					workspacePath: prev?.workspacePath ?? "",
					indexPath: prev?.indexPath ?? "",
					embeddingModel: prev?.embeddingModel ?? "",
					baseUrl: prev?.baseUrl ?? "",
					files: prev?.files ?? [],
					totalFiles: prev?.totalFiles ?? 0,
					indexedFiles: prev?.indexedFiles ?? 0,
					skippedFiles: prev?.skippedFiles ?? 0,
					errorFiles: prev?.errorFiles ?? 0,
					indexSizeBytes: prev?.indexSizeBytes ?? 0,
					updatedAtMs: prev?.updatedAtMs ?? 0,
					isIndexing: true,
					progressCurrent: 0,
					progressTotal: prev?.totalFiles && prev.totalFiles > 0 ? prev.totalFiles : 0,
					progressPath: undefined,
					lastError: prev?.lastError,
				}))
					setIndex(await IndexingServiceClient.rebuildIndex(EmptyRequest.create({})))
				} else {
				setClearConfirmPending(false)
				setIndex((prev) => ({
					workspacePath: prev?.workspacePath ?? "",
					indexPath: prev?.indexPath ?? "",
					embeddingModel: prev?.embeddingModel ?? "",
					baseUrl: prev?.baseUrl ?? "",
					files: prev?.files ?? [],
					totalFiles: prev?.totalFiles ?? 0,
					indexedFiles: prev?.indexedFiles ?? 0,
					skippedFiles: prev?.skippedFiles ?? 0,
					errorFiles: prev?.errorFiles ?? 0,
					indexSizeBytes: prev?.indexSizeBytes ?? 0,
					updatedAtMs: prev?.updatedAtMs ?? 0,
					isIndexing: true,
					progressCurrent: 0,
					progressTotal: prev?.totalFiles && prev.totalFiles > 0 ? prev.totalFiles : 0,
					progressPath: undefined,
					lastError: prev?.lastError,
				}))
				setIndex(await IndexingServiceClient.updateIndex(EmptyRequest.create({})))
				}
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught))
				await loadStatus().catch(() => undefined)
			} finally {
				setIsWorking(false)
			}
		},
		[clearConfirmPending, loadStatus],
	)

	useEffect(() => {
		logAgentarioScreenView("indexing", codebaseIndexMode, { backend: codebaseIndexAiBackend })
	}, [codebaseIndexMode, codebaseIndexAiBackend])

	useEffect(() => {
		loadStatus().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
	}, [loadStatus])

	useEffect(() => {
		// Poll while local busy flag OR host reports indexing — getIndexStatus
		// returns live progress during the blocking rebuild/update RPC.
		if (!isWorking && !index?.isIndexing) {
			return
		}
		const timer = window.setInterval(() => {
			loadStatus().catch((caught) => console.error(caught))
		}, 500)
		return () => window.clearInterval(timer)
	}, [isWorking, index?.isIndexing, loadStatus])

	useEffect(() => {
		if (!usesAiEmbeddings || codebaseIndexAiBackend !== "lmstudio") {
			return
		}
		loadLmStudioModels().catch((caught) => console.error(caught))
	}, [loadLmStudioModels, usesAiEmbeddings, codebaseIndexAiBackend])

	const selectedEmbeddingModelId = configuredEmbeddingModel
	const embeddingModelOptions = useMemo(() => {
		if (lmStudioModels.length === 0) {
			return []
		}
		const embeddingOnly = lmStudioModels.filter((model) => isEmbeddingLmStudioType(model.type))
		const pool = embeddingOnly.length > 0 ? embeddingOnly : lmStudioModels
		const sorted = sortLmStudioModelsForPicker(pool).sort((a, b) =>
			(a.key ?? a.id).localeCompare(b.key ?? b.id),
		)
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
		selectedModelRecord !== undefined && !isEmbeddingLmStudioType(selectedModelRecord.type)

	const files: IndexedFile[] = index?.files ?? []
	const partialCount = files.filter((file) => file.status === IndexedFileStatus.INDEXED_FILE_STATUS_PARTIAL).length
	const updatedAt = index?.updatedAtMs ? new Date(Number(index.updatedAtMs)).toLocaleString() : "never"
	const busy = isWorking || index?.isIndexing
	const progressCurrent = Number(index?.progressCurrent ?? 0)
	const progressTotal = Number(index?.progressTotal ?? 0)
	const progressPercent =
		progressTotal > 0 ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100)) : busy ? 0 : 100
	const indexSizeBytes = Number(index?.indexSizeBytes ?? 0)
	const activeEmbeddingModel = index?.embeddingModel || configuredEmbeddingModel
	const loadedEmbeddingHint =
		lmStudioModels.filter((model) => model.state === "loaded" && isEmbeddingLmStudioType(model.type)).length > 0
			? lmStudioModels
					.filter((model) => model.state === "loaded" && isEmbeddingLmStudioType(model.type))
					.map((model) => formatLmStudioEmbeddingModelLabel(model))
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
					<div>
						Режим:{" "}
						{codebaseIndexMode === "local"
							? "локальный (без AI)"
							: codebaseIndexMode === "local-ai"
								? `локальный AI (${codebaseIndexAiBackend})`
								: `удалённый AI (${codebaseIndexAiBackend})`}
					</div>
					<div>Endpoint: {index?.baseUrl || (usesAiEmbeddings ? codebaseIndexBaseUrl || lmStudioBaseUrl : "local")}</div>
					<div>Updated: {updatedAt}</div>
				</div>
				<div className="mb-2 grid gap-2">
					<DropdownContainer className="dropdown-container" zIndex={30}>
						<VSCodeDropdown
							className="w-full"
							onChange={(event: any) => {
								const value = event?.target?.value
								if (typeof value === "string") {
									void persistIndexSetting(
										UpdateSettingsRequest.create({
											codebaseIndexMode: value,
										} as any),
									)
								}
							}}
							value={codebaseIndexMode}>
							<VSCodeOption value="local">Локальный (без AI, ripgrep/файлы)</VSCodeOption>
							<VSCodeOption value="local-ai">Локальный AI (127.0.0.1)</VSCodeOption>
							<VSCodeOption value="remote-ai">Удалённый AI (IP/URL)</VSCodeOption>
						</VSCodeDropdown>
						<p className="mt-0.5 text-[11px] font-medium">Режим индексации</p>
					</DropdownContainer>
					{usesAiEmbeddings && (
						<DropdownContainer className="dropdown-container" zIndex={20}>
							<VSCodeDropdown
								className="w-full"
								onChange={(event: any) => {
									const value = event?.target?.value
									if (value === "lmstudio" || value === "ollama") {
										void persistIndexSetting(
											UpdateSettingsRequest.create({
												codebaseIndexAiBackend: value,
											} as any),
										)
									}
								}}
								value={codebaseIndexAiBackend}>
								<VSCodeOption value="lmstudio">LM Studio</VSCodeOption>
								<VSCodeOption value="ollama">Ollama</VSCodeOption>
							</VSCodeDropdown>
							<p className="mt-0.5 text-[11px] font-medium">Backend embeddings</p>
						</DropdownContainer>
					)}
					{usesAiEmbeddings && showRemoteUrl && (
						<DebouncedTextField
							initialValue={codebaseIndexBaseUrl ?? ""}
							onChange={(value) =>
								void persistIndexSetting(
									UpdateSettingsRequest.create({
										codebaseIndexBaseUrl: value.trim(),
									} as any),
								)
							}
							placeholder={
								codebaseIndexAiBackend === "ollama" ? "http://127.0.0.1:11434" : "http://192.168.1.10:1234"
							}
							style={{ width: "100%" }}>
							<span className="text-[11px] font-medium">
								{codebaseIndexMode === "remote-ai" ? "URL сервера embeddings" : "URL Ollama (если не localhost)"}
							</span>
						</DebouncedTextField>
					)}
					{usesAiEmbeddings && codebaseIndexMode === "local-ai" && codebaseIndexAiBackend === "lmstudio" && (
						<p className="text-[10px] text-description leading-tight">
							LM Studio URL берётся из Settings → API ({lmStudioBaseUrl}), если поле URL выше пустое.
						</p>
					)}
				</div>
				{usesAiEmbeddings && (
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
										void persistIndexSetting(
											UpdateSettingsRequest.create({
												codebaseIndexEmbeddingModelId: (selected?.key ?? value).trim() || undefined,
											} as any),
										)
									}
								}}
								value={selectedEmbeddingModelId}>
								{embeddingModelOptions.map((model) => (
									<VSCodeOption className="w-full" key={model.id} value={model.key ?? model.id}>
										{formatLmStudioEmbeddingModelLabel(model)}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<p className="mt-0.5 text-[11px] font-medium">Embedding-модель (LM Studio)</p>
						</DropdownContainer>
					) : (
						<DebouncedTextField
							initialValue={configuredEmbeddingModel}
							onChange={(value) =>
								void persistIndexSetting(
									UpdateSettingsRequest.create({
										codebaseIndexEmbeddingModelId: value.trim() || undefined,
									} as any),
								)
							}
							placeholder={DEFAULT_EMBEDDING_MODEL}
							style={{ width: "100%" }}>
							<span className="text-[11px] font-medium">
								Embedding-модель ({codebaseIndexAiBackend === "ollama" ? "Ollama" : "LM Studio"})
							</span>
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
				)}
				<div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-tight">
					<span>Total: {index?.totalFiles ?? 0}</span>
					<span>
						Indexed: {index?.indexedFiles ?? 0}
						{partialCount > 0 ? ` (${partialCount} partial)` : ""}
					</span>
					<span>Skipped: {index?.skippedFiles ?? 0}</span>
					<span>Errors: {index?.errorFiles ?? 0}</span>
					<span>Index size: {formatBytes(indexSizeBytes)}</span>
				</div>
				{busy && (
					<div className="mb-2 text-[11px] leading-tight">
						<div className="mb-1 flex items-center justify-between gap-2">
							<span>
								{progressTotal > 0
									? `Прогресс: ${progressCurrent} / ${progressTotal} (${progressPercent}%)`
									: "Подготовка списка файлов…"}
							</span>
						</div>
						<div className="h-1.5 overflow-hidden rounded bg-[var(--vscode-editor-inactiveSelectionBackground)]">
							<div
								className="h-full bg-[var(--vscode-progressBar-background)] transition-[width] duration-300"
								style={{ width: `${progressTotal > 0 ? progressPercent : 5}%` }}
							/>
						</div>
						{index?.progressPath && (
							<div className="mt-1 truncate text-[10px] text-description" title={index.progressPath}>
								{index.progressPath}
							</div>
						)}
					</div>
				)}
				<div className="mb-2 text-[10px] text-description leading-tight">
					Чанк ~3072 симв. (~1024 tok), нахлёст 17.5%, batch до 2048 tok. Файлы индексируются целиком (без лимита размера).
				</div>
				<div className="flex flex-wrap gap-1.5">
					{clearConfirmPending ? (
						<>
							<VSCodeButton disabled={busy} onClick={() => runAction("clear")}>
								Подтвердить очистку
							</VSCodeButton>
							<VSCodeButton appearance="secondary" disabled={busy} onClick={() => setClearConfirmPending(false)}>
								Отмена
							</VSCodeButton>
						</>
					) : (
						<VSCodeButton appearance="secondary" disabled={busy} onClick={() => runAction("clear")}>
							Очистить
						</VSCodeButton>
					)}
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
				{clearConfirmPending && (
					<div className="mt-2 text-[11px] text-[var(--vscode-editorWarning-foreground)]">
						Будет удалён локальный embedding-индекс для этого workspace. Нажмите «Подтвердить очистку».
					</div>
				)}
				{busy && (
					<div className="mt-2 flex items-center gap-1.5 text-[11px] text-description">
						<VSCodeProgressRing style={{ height: 12, width: 12 }} />
						{progressTotal > 0
							? `Индексация: ${progressCurrent}/${progressTotal} (${progressPercent}%) · ${formatBytes(indexSizeBytes)}`
							: "Идёт индексация…"}
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
