import { memo, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { DebouncedTextField } from "../common/DebouncedTextField"
import CollapsibleSection from "../CollapsibleSection"
import Section from "../Section"
import { updateSettingsPatch } from "../utils/settingsHandlers"
import { SlashServiceClient } from "@/services/grpc-client"
import { StringRequest, EmptyRequest } from "@shared/proto/agentario/common"

// Default prompt template parts (matching the backend defaults)
const DEFAULT_PROMPT_BEFORE = `Ты — компрессор(суммаризатор) текста сообщений чата. Получаешь диалог из чата пользователя с агентом, и разбив чат на отдельные сообщения, начинаешь их обрабатывать отдельно, по следующим правилам:
1. Отдельным сообщением считается отдельное действие участника диалога (сообщение пользователя целиком (даже из многих предложений), размышления агента в чате, действия агента в чате (Tool calls, чтение файлов, запись в файлов, открытие браузера, и так далее), ответные сообщения агента в чате, промежуточные высказывания агента в чате между другими действиями).
2. Удали из каждого обрабатываемого отдельного сообщения ВСЮ техническую служебную информацию (конкретику вызовов инструментов, пути к файлам, списки файлов, diff кода, логовые маркеры типа "Tool calls", "Thinking", "Completed").
3. Сожми текст (суммаризируй) отдельного сообщения, оставив только его смысл и ключевые действия/требования/вопросы/ответы (кратко).
4. Сжатый текст отдельного сообщения должен быть в 2 раза меньше оригинального (но не менее 30 слов, чтобы не потерять смысл и контекст сообщения). Если всё исходное отдельное сообщение короче 30 слов — не сжимай его, а возвращай целиком оригинальный текст.
5. Для отдельных сообщений о действиях агента (вызов tools, чтение файлов, индексация, обращение к браузеру, создание файла и т.д.) оставляй только сжатый смысл и краткое описание произведенных действий, без перечисления деталей.

Пример и формат вывода диалога сжатыми сообщениями:
[User]: Изучи документацию, историю чатов, файлы правил, структуру папок и прогресс проекта.
[Agent-thinking]: Нужно начать сборку контекста, проверяя статус репозитория и структуру папок.
[Agent]: Изучаю назначение проекта, текущий статус и планы развития.
[Agent-Tool-calls]: Выполнил команду git status для проверки репозитория, получил список файлов в структуре папок проекта и проверил наличие ошибок.
[Agent-thinking]: Я полностью ознакомился с проектом. Теперь сформирую подробный анализ.
[Agent]: Результат анализа: NetWatcher — фоновое Windows-приложение, которое контролирует сетевое подключение и автоматически восстанавливает его при потере связи. Проект полностью реализован: есть готовый исходный код, поддержка системного трея и собранный NetWatcher.exe с логикой автоматического ремонта сети.
[User]: Продолжи выполнение плана разработки.

Вот диалог для обработки (сжатия):`

const DEFAULT_PROMPT_AFTER = `Выводи мне в ответ только обработанный диалог с сжатыми тобой сообщениями, без кавычек, без предисловий "Вот сжатое сообщение".`

// Default tag mappings for post-processing
interface TagMapping {
	tag: string
	type: "say" | "ask"
	say: string
	ask: string
	description: string
}

const DEFAULT_TAG_MAPPINGS: TagMapping[] = [
	{ tag: "User", type: "say", say: "user_feedback", ask: "", description: "Сообщение пользователя" },
	{ tag: "Agent", type: "say", say: "text", ask: "", description: "Ответ агента (текст)" },
	{ tag: "Agent-thinking", type: "say", say: "reasoning", ask: "", description: "Размышления агента" },
	{ tag: "Agent-Tool-calls", type: "say", say: "tool", ask: "", description: "Вызовы инструментов" },
]

interface SummarizationSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const SummarizationSettingsSection = ({ renderSectionHeader }: SummarizationSettingsSectionProps) => {
	const {
		useAutoCondense,
		compactionStrategy,
		compactionProviderId,
		compactionModelId,
		compactionBaseUrl,
		compactionApiKey,
		compactionChunkSize,
		compactionDoubleSummarization,
		compactionReserveTokens,
		compactionMaxInputTokens,
		compactionPromptTemplateBefore,
		compactionPromptTemplateAfter,
		compactionPostProcessTags,
	} = useExtensionState()

	// Local state for prompt template text areas (debounced save)
	const [templateBefore, setTemplateBefore] = useState(compactionPromptTemplateBefore ?? DEFAULT_PROMPT_BEFORE)
	const [templateAfter, setTemplateAfter] = useState(compactionPromptTemplateAfter ?? DEFAULT_PROMPT_AFTER)

	// Local state for tag mappings
	const [tagMappings, setTagMappings] = useState<TagMapping[]>(() => {
		if (compactionPostProcessTags) {
			try {
				return JSON.parse(compactionPostProcessTags)
			} catch {
				return DEFAULT_TAG_MAPPINGS
			}
		}
		return DEFAULT_TAG_MAPPINGS
	})

	// Debug file content
	const [debugFileContent, setDebugFileContent] = useState<string>("")
	const [showDebugFile, setShowDebugFile] = useState(false)

	const handleTemplateBeforeChange = useCallback((value: string) => {
		setTemplateBefore(value)
		updateSettingsPatch({ compactionPromptTemplateBefore: value })
	}, [])

	const handleTemplateAfterChange = useCallback((value: string) => {
		setTemplateAfter(value)
		updateSettingsPatch({ compactionPromptTemplateAfter: value })
	}, [])

	const handleResetTemplate = useCallback(() => {
		setTemplateBefore(DEFAULT_PROMPT_BEFORE)
		setTemplateAfter(DEFAULT_PROMPT_AFTER)
		updateSettingsPatch({
			compactionPromptTemplateBefore: undefined,
			compactionPromptTemplateAfter: undefined,
		})
	}, [])

	const handleTagMappingChange = useCallback((index: number, field: keyof TagMapping, value: string) => {
		setTagMappings((prev) => {
			const updated = [...prev]
			updated[index] = { ...updated[index], [field]: value }
			updateSettingsPatch({ compactionPostProcessTags: JSON.stringify(updated) })
			return updated
		})
	}, [])

	const handleResetTagMappings = useCallback(() => {
		setTagMappings(DEFAULT_TAG_MAPPINGS)
		updateSettingsPatch({ compactionPostProcessTags: JSON.stringify(DEFAULT_TAG_MAPPINGS) })
	}, [])

	const handleOpenDebugFile = useCallback(async () => {
		try {
			const result = await SlashServiceClient.openCompactionDebugFile(StringRequest.create({ value: "" }))
			setDebugFileContent(result.value)
			setShowDebugFile(true)
		} catch (err) {
			console.error("Failed to open debug file:", err)
			setDebugFileContent("Ошибка при открытии файла дебага.")
			setShowDebugFile(true)
		}
	}, [])

	const handleApplyPostProcessing = useCallback(async () => {
		try {
			// Get current context messages from the debug file (latest summary)
			const result = await SlashServiceClient.openCompactionDebugFile(StringRequest.create({ value: "" }))
			const content = result.value

			// Extract the summary text (after "=== ОТВЕТ МОДЕЛИ ===")
			const responseMatch = content.match(/=== ОТВЕТ МОДЕЛИ ===\s*\n([\s\S]*?)$/)
			const summaryText = responseMatch ? responseMatch[1].trim() : content

			await SlashServiceClient.applyCompactionPostProcessing(
				StringRequest.create({
					value: JSON.stringify({
						summaryText,
						tagMappings,
						mode: "context",
					}),
				})
			)
		} catch (err) {
			console.error("Failed to apply post-processing:", err)
		}
	}, [tagMappings])

	const handleOpenContextText = useCallback(async () => {
		try {
			const result = await SlashServiceClient.exportContextText(EmptyRequest.create({}))
			if (result.value) {
				console.log("[ContextExport] Exported to:", result.value)
			}
		} catch (err) {
			console.error("Failed to export context text:", err)
		}
	}, [])

	return (
		<div className="mb-2">
			{renderSectionHeader("summarization")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Auto-condense toggle */}
					<CollapsibleSection title={t("features.autoCompactLabel")} defaultExpanded={true}>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									{t("features.autoCompactLabel")}
								</Label>
								<div className="text-xs text-muted-foreground">
									{t("features.autoCompactDesc")}
								</div>
							</div>
							<Switch
								checked={useAutoCondense ?? true}
								onCheckedChange={(checked) => updateSettingsPatch({ useAutoCondense: checked })}
							/>
						</div>
					</CollapsibleSection>

					{/* Strategy & model settings */}
					<CollapsibleSection title={t("features.compactionStrategyLabel")}>
						{/* Strategy */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold">{t("features.compactionStrategyLabel")}</Label>
							<p className="text-xs text-description">{t("features.compactionStrategyDesc")}</p>
							<Select
								onValueChange={(value) =>
									updateSettingsPatch({
										compactionStrategy: value === "basic" ? "basic" : "agentic",
									})
								}
								value={compactionStrategy === "basic" ? "basic" : "agentic"}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="agentic">{t("features.compactionStrategyAgentic")}</SelectItem>
									<SelectItem value="basic">{t("features.compactionStrategyBasic")}</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Summarizer model */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold">{t("features.compactionSummarizerLabel")}</Label>
							<p className="text-xs text-description">{t("features.compactionSummarizerDesc")}</p>
							<div className="space-y-2">
								<Select
									onValueChange={(value) =>
										updateSettingsPatch({
											compactionProviderId: value || undefined,
										})
									}
									value={compactionProviderId ?? ""}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder={t("features.compactionProviderPlaceholder")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="lmstudio">LM Studio</SelectItem>
										<SelectItem value="ollama">Ollama</SelectItem>
										<SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
									</SelectContent>
								</Select>
								<DebouncedTextField
									initialValue={compactionModelId ?? ""}
									onChange={(value) =>
										updateSettingsPatch({
											compactionModelId: value.trim(),
										})
									}
									placeholder={t("features.compactionModelPlaceholder")}
									style={{ width: "100%" }}
								/>
								<DebouncedTextField
									initialValue={compactionBaseUrl ?? ""}
									onChange={(value) =>
										updateSettingsPatch({
											compactionBaseUrl: value.trim(),
										})
									}
									placeholder={t("features.compactionBaseUrlPlaceholder")}
									style={{ width: "100%" }}
								/>
								{compactionProviderId === "openai-compatible" && (
									<DebouncedTextField
										initialValue={compactionApiKey ?? ""}
										onChange={(value) =>
											updateSettingsPatch({
												compactionApiKey: value.trim(),
											})
										}
										placeholder={t("features.compactionApiKeyPlaceholder")}
										type="password"
										style={{ width: "100%" }}
									/>
								)}
							</div>
						</div>

						{/* Chunk size */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold">{t("features.compactionChunkSizeLabel")}</Label>
							<p className="text-xs text-description">{t("features.compactionChunkSizeDesc")}</p>
							<DebouncedTextField
								initialValue={String(compactionChunkSize ?? 4000)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										compactionChunkSize: Number.isFinite(num) && num >= 0 ? num : 4000,
									})
								}}
								placeholder="4000"
								style={{ width: "100%" }}
							/>
						</div>

						{/* Double summarization */}
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-1">
								<Label className="text-sm font-medium text-foreground">
									{t("features.compactionDoubleSummarizationLabel")}
								</Label>
								<div className="text-xs text-muted-foreground">
									{t("features.compactionDoubleSummarizationDesc")}
								</div>
							</div>
							<Switch
								checked={compactionDoubleSummarization ?? true}
								onCheckedChange={(checked) => updateSettingsPatch({ compactionDoubleSummarization: checked })}
							/>
						</div>

						{/* Reserve tokens */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold">Резервный контекст (токены)</Label>
							<p className="text-xs text-description">
								Минимальный свободный контекст для нового сообщения модели. Авто-сжатие срабатывает, когда оставшийся контекст опускается ниже этого значения.
							</p>
							<DebouncedTextField
								initialValue={String(compactionReserveTokens ?? 16384)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										compactionReserveTokens: Number.isFinite(num) && num > 0 ? num : 16384,
									})
								}}
								placeholder="16384"
								style={{ width: "100%" }}
							/>
						</div>

						{/* Max input tokens override */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold">Максимум токенов контекста модели</Label>
							<p className="text-xs text-description">
								Если 0 — определяется автоматически из настроек модели. Укажите вручную, если автоматическое определение не работает (например, для локальных моделей LM Studio/Ollama). Триггер сжатия: контекст − резерв.
							</p>
							<DebouncedTextField
								initialValue={String(compactionMaxInputTokens ?? 0)}
								onChange={(value) => {
									const num = Number.parseInt(value.trim(), 10)
									updateSettingsPatch({
										compactionMaxInputTokens: Number.isFinite(num) && num >= 0 ? num : 0,
									})
								}}
								placeholder="0 (авто)"
								style={{ width: "100%" }}
							/>
						</div>
					</CollapsibleSection>

					{/* Prompt template editor */}
					<CollapsibleSection title={t("features.promptTemplateLabel")}>
						<div className="flex items-center justify-between">
							<p className="text-xs text-description">{t("features.promptTemplateDesc")}</p>
							<Button
								className="h-7 text-xs"
								onClick={handleResetTemplate}
								variant="secondary">
								{t("features.promptTemplateReset")}
							</Button>
						</div>

						{/* Before template */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold text-foreground">
								{t("features.promptTemplateBeforeLabel")}
							</Label>
							<textarea
								className="w-full min-h-[120px] rounded-md border border-editor-widget-border/50 bg-editor-background px-3 py-2 text-sm text-foreground placeholder:text-description focus:outline-none focus:ring-1 focus:ring-ring resize-y"
								onChange={(e) => handleTemplateBeforeChange(e.target.value)}
								placeholder={DEFAULT_PROMPT_BEFORE}
								value={templateBefore}
							/>
						</div>

						{/* Divider */}
						<div className="flex items-center gap-2 py-2">
							<div className="flex-1 border-t border-dashed border-editor-widget-border/60" />
							<span className="text-xs font-medium text-description whitespace-nowrap px-2">
								{t("features.promptTemplateDivider")}
							</span>
							<div className="flex-1 border-t border-dashed border-editor-widget-border/60" />
						</div>

						{/* After template */}
						<div className="space-y-1">
							<Label className="text-sm font-semibold text-foreground">
								{t("features.promptTemplateAfterLabel")}
							</Label>
							<textarea
								className="w-full min-h-[60px] rounded-md border border-editor-widget-border/50 bg-editor-background px-3 py-2 text-sm text-foreground placeholder:text-description focus:outline-none focus:ring-1 focus:ring-ring resize-y"
								onChange={(e) => handleTemplateAfterChange(e.target.value)}
								placeholder={DEFAULT_PROMPT_AFTER || t("features.promptTemplateAfterLabel")}
								value={templateAfter}
							/>
						</div>
					</CollapsibleSection>

					{/* Post-processing settings */}
					<CollapsibleSection title="Постобработка ответа модели">
						<p className="text-xs text-description mb-3">
							Настройка маппинга тегов модели суммаризации на типы сообщений Agentario.
							Модель помечает сообщения тегами в квадратных скобках (например, [User]:, [Agent]:).
							Здесь вы можете указать, какие теги соответствуют каким типам сообщений в чате.
						</p>

						{/* Tag mappings */}
						<div className="space-y-3">
							{tagMappings.map((mapping, index) => (
								<div key={index} className="flex flex-col gap-1 p-2 rounded border border-editor-widget-border/30">
									<div className="flex items-center justify-between">
										<Label className="text-xs font-semibold">{mapping.description}</Label>
										<span className="text-xs text-muted-foreground">→ {mapping.type === "say" ? `say:${mapping.say}` : `ask:${mapping.ask}`}</span>
									</div>
									<div className="flex gap-2">
										<DebouncedTextField
											initialValue={mapping.tag}
											onChange={(value) => handleTagMappingChange(index, "tag", value)}
											placeholder="Тег модели (без скобок)"
											style={{ flex: 1 }}
										/>
										<Select
											onValueChange={(value) => {
												const [type, subtype] = value.split(":")
												handleTagMappingChange(index, "type", type)
												if (type === "say") handleTagMappingChange(index, "say", subtype)
												if (type === "ask") handleTagMappingChange(index, "ask", subtype)
											}}
											value={`${mapping.type}:${mapping.type === "say" ? mapping.say : mapping.ask}`}>
											<SelectTrigger className="w-[200px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="say:user_feedback">say: user_feedback</SelectItem>
												<SelectItem value="say:text">say: text</SelectItem>
												<SelectItem value="say:reasoning">say: reasoning</SelectItem>
												<SelectItem value="say:tool">say: tool</SelectItem>
												<SelectItem value="say:command">say: command</SelectItem>
												<SelectItem value="say:info">say: info</SelectItem>
												<SelectItem value="ask:followup">ask: followup</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
							))}
						</div>

						<div className="flex gap-2 mt-3">
							<Button
								className="h-7 text-xs"
								onClick={handleResetTagMappings}
								variant="secondary">
								Сбросить маппинг
							</Button>
						</div>

						{/* Debug file viewer */}
						<div className="mt-4 pt-3 border-t border-editor-widget-border/30">
							<Label className="text-sm font-semibold mb-2 block">Дебаг суммаризации</Label>
							<div className="flex gap-2 mb-2">
								<Button
									className="h-7 text-xs"
									onClick={handleOpenDebugFile}
									variant="secondary">
									Открыть compaction_map_chunk1
								</Button>
								<Button
									className="h-7 text-xs"
									onClick={handleOpenContextText}
									variant="secondary">
									Текст чата из контекста
								</Button>
							</div>
							{showDebugFile && debugFileContent && (
								<div className="mt-2">
									<textarea
										className="w-full min-h-[200px] max-h-[400px] rounded-md border border-editor-widget-border/50 bg-editor-background px-3 py-2 text-xs text-foreground font-mono placeholder:text-description focus:outline-none focus:ring-1 focus:ring-ring resize-y overflow-auto"
										readOnly
										value={debugFileContent}
									/>
								</div>
							)}
						</div>

						{/* Apply post-processing button */}
						<div className="mt-4 pt-3 border-t border-editor-widget-border/30">
							<Label className="text-sm font-semibold mb-2 block">Применить постобработку</Label>
							<p className="text-xs text-description mb-2">
								Применить текущие настройки маппинга к последней суммаризации в контексте чата.
							</p>
							<Button
								className="h-7 text-xs"
								onClick={handleApplyPostProcessing}
								variant="default">
								Применить постобработку к контексту
							</Button>
						</div>
					</CollapsibleSection>
				</div>
			</Section>
		</div>
	)
}

export default memo(SummarizationSettingsSection)
