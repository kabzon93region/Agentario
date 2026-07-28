import type { ToolResultContent } from "@agentario/llms";
import {
	CHARS_PER_TOKEN,
	estimateTokens,
	type MessageWithMetadata,
} from "@agentario/shared";

export { CHARS_PER_TOKEN, estimateTokens };

import type {
	CoreCompactionContext,
	CoreCompactionSummarizerConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";

export const DEFAULT_MAX_INPUT_TOKENS = 200_000;
export const DEFAULT_THRESHOLD_RATIO = 0.9;
export const DEFAULT_TARGET_RATIO = 0.7;
export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_PRESERVE_RECENT_TOKENS = 20_000;
// Agentario: fallback — переопределяется динамически из chunkSize в runAgenticCompaction
export const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 0;
export const TOOL_RESULT_CHAR_LIMIT = 2_000;
export const FILE_CONTENT_CHAR_LIMIT = 2_000;
export const MIN_TRUNCATED_MESSAGE_TOKENS = 8;

export interface FileOperationSummary {
	readFiles: string[];
	modifiedFiles: string[];
}

export interface CompactionSummaryMetadata {
	kind: "compaction_summary";
	summary: string;
	details: FileOperationSummary;
	tokensBefore: number;
	generatedAt: number;
}

export type EstimateMessageTokens = (message: MessageWithMetadata) => number;

export function truncateText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

export function flattenToolResultContent(
	content: ToolResultContent["content"],
): string {
	const truncated = truncateToolResultContentForCompaction(content);
	if (typeof truncated === "string") {
		return truncated;
	}
	return truncated
		.map((block) => {
			switch (block.type) {
				case "text":
					return block.text;
				case "file":
					return `<file path="${block.path}">\n${block.content}\n</file>`;
				case "image":
					return `[image:${block.mediaType}]`;
				default:
					return "";
			}
		})
		.join("\n");
}

export function truncateToolResultContentForCompaction(
	content: ToolResultContent["content"],
): ToolResultContent["content"] {
	if (typeof content === "string") {
		return truncateText(content, TOOL_RESULT_CHAR_LIMIT);
	}
	return content.map((block) => {
		switch (block.type) {
			case "text":
				return {
					...block,
					text: truncateText(block.text, TOOL_RESULT_CHAR_LIMIT),
				};
			case "file":
				return {
					...block,
					content: truncateText(block.content, FILE_CONTENT_CHAR_LIMIT),
				};
			case "image":
				return block;
			default:
				return block;
		}
	});
}

export function formatToolInput(input: Record<string, unknown>): string {
	return Object.entries(input)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(", ");
}

export function serializeMessage(message: MessageWithMetadata): string {
	if (typeof message.content === "string") {
		return `[${message.role === "user" ? "User" : "Bot"}]: ${message.content}`;
	}
	const lines: string[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"}]: ${block.text}`,
				);
				break;
			case "thinking":
				lines.push(`[Bot thinking]: ${truncateText(block.thinking, 2_000)}`);
				break;
			case "redacted_thinking":
				lines.push("[Bot thinking]: [redacted]");
				break;
			case "tool_use":
				lines.push(
					`[Bot tool calls]: ${block.name}(${formatToolInput(block.input)})`,
				);
				break;
			case "tool_result":
				lines.push(`[Tool result]: ${flattenToolResultContent(block.content)}`);
				break;
			case "file":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"} file ${block.path}]: ${truncateText(block.content, FILE_CONTENT_CHAR_LIMIT)}`,
				);
				break;
			case "image":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"} image]: ${block.mediaType}`,
				);
				break;
		}
	}
	return lines.join("\n");
}

export function serializeConversation(messages: MessageWithMetadata[]): string {
	return messages.map(serializeMessage).join("\n\n").trim();
}

// Agentario: проверка является ли сообщение "Общей картиной"
export function isOverallPictureMessage(message: MessageWithMetadata): boolean {
	if (message.role !== "user") {
		return false;
	}
	let text = "";
	if (typeof message.content === "string") {
		text = message.content;
	} else if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (block.type === "text") {
				text += block.text + " ";
			}
		}
	}
	return /^Общая картина[:\s]/i.test(text.trim());
}

export type TokenEstimatorMode = "compaction" | "provider";

/**
 * Token estimator for messages.
 * - `compaction` — caps tool_result/file/thinking like serializeMessage (2k) for summary sizing.
 * - `provider` — counts content as already prepared for the API (MessageBuilder ~8k tool
 *   results). Used by context-budget UI so totalEstimated tracks tokensIn, not the
 *   compaction-truncated underestimate.
 */
export function createTokenEstimator(
	mode: TokenEstimatorMode = "compaction",
): EstimateMessageTokens {
	const cache = new WeakMap<object, number>();
	const forProvider = mode === "provider";
	return (message) => {
		const ref = message as unknown as object;
		const cached = cache.get(ref);
		if (typeof cached === "number") {
			return cached;
		}
		// Agentario: считаем токены по ТОМУ ЖЕ формату что и serializeMessage(),
		// а не по raw JSON. Иначе chunk sizing расходится с реальным текстом.
		const roleLabel = message.role === "user" ? "User" : "Bot";
		let contentLength = 0;
		if (typeof message.content === "string") {
			contentLength = `[${roleLabel}]: `.length + message.content.length;
		} else if (Array.isArray(message.content)) {
			for (const block of message.content) {
				switch (block.type) {
					case "text":
						contentLength += `[${roleLabel}]: `.length + block.text.length;
						break;
					case "thinking":
						contentLength +=
							"[Bot thinking]: ".length +
							(forProvider
								? block.thinking.length
								: Math.min(block.thinking.length, 2_000));
						break;
					case "redacted_thinking":
						contentLength += "[Bot thinking]: [redacted]".length;
						break;
					case "tool_use":
						contentLength +=
							"[Bot tool calls]: ".length +
							block.name.length +
							formatToolInput(block.input).length;
						break;
					case "tool_result":
						contentLength +=
							"[Tool result]: ".length +
							(forProvider
								? estimateToolResultProviderLength(block.content)
								: estimateToolResultSerializedLength(block.content));
						break;
					case "file":
						contentLength +=
							`[${roleLabel} file ${block.path}]: `.length +
							(forProvider
								? block.content.length
								: Math.min(block.content.length, FILE_CONTENT_CHAR_LIMIT));
						break;
					case "image":
						contentLength +=
							`[${roleLabel} image]: `.length + (block.mediaType?.length ?? 5);
						break;
				}
			}
		}
		const value = estimateTokens(contentLength);
		cache.set(ref, value);
		return value;
	};
}

/**
 * Оценивает длину сериализованного tool_result после flattenToolResultContent().
 * Учитывает лимиты truncateToolResultContentForCompaction().
 */
function estimateToolResultSerializedLength(content: unknown): number {
	return estimateToolResultLength(content, {
		textLimit: TOOL_RESULT_CHAR_LIMIT,
		fileLimit: FILE_CONTENT_CHAR_LIMIT,
	});
}

/** Full length of tool_result as present in API-prepared messages (no extra 2k cap). */
function estimateToolResultProviderLength(content: unknown): number {
	return estimateToolResultLength(content, { textLimit: Infinity, fileLimit: Infinity });
}

function estimateToolResultLength(
	content: unknown,
	limits: { textLimit: number; fileLimit: number },
): number {
	if (typeof content === "string") {
		return Math.min(content.length, limits.textLimit);
	}
	if (Array.isArray(content)) {
		let total = 0;
		for (const block of content) {
			if (block && typeof block === "object") {
				const b = block as Record<string, unknown>;
				if (b.type === "text" && typeof b.text === "string") {
					total += Math.min(b.text.length, limits.textLimit);
				} else if (b.type === "file" && typeof b.content === "string") {
					total +=
						`<file path="${b.path ?? ""}">\n`.length +
						Math.min(b.content.length, limits.fileLimit) +
						"\n</file>".length;
				} else if (b.type === "image") {
					total += `[image:${(b as { mediaType?: string }).mediaType ?? ""}]`.length;
				} else {
					// Structured tool payloads (read_files / run_commands): count JSON size.
					try {
						total += Math.min(JSON.stringify(b).length, limits.textLimit);
					} catch {
						total += Math.min(String(b).length, limits.textLimit);
					}
				}
			}
		}
		return total;
	}
	if (content != null) {
		return Math.min(String(content).length, limits.textLimit);
	}
	return 0;
}

export function isCompactionSummaryMessage(
	message: MessageWithMetadata,
): boolean {
	return (
		(message.metadata as { kind?: string } | undefined)?.kind ===
		"compaction_summary"
	);
}

export function getCompactionSummaryMetadata(
	message: MessageWithMetadata,
): CompactionSummaryMetadata | undefined {
	if (!isCompactionSummaryMessage(message)) {
		return undefined;
	}
	const metadata = message.metadata as Record<string, unknown> | undefined;
	if (!metadata) {
		return undefined;
	}
	const details = metadata.details as Record<string, unknown> | undefined;
	return {
		kind: "compaction_summary",
		summary: String(metadata.summary ?? ""),
		details: {
			readFiles: Array.isArray(details?.readFiles)
				? details.readFiles
						.filter((value): value is string => typeof value === "string")
						.map((value) => value.trim())
						.filter((value) => value.length > 0)
				: [],
			modifiedFiles: Array.isArray(details?.modifiedFiles)
				? details.modifiedFiles
						.filter((value): value is string => typeof value === "string")
						.map((value) => value.trim())
						.filter((value) => value.length > 0)
				: [],
		},
		tokensBefore: Number(metadata.tokensBefore ?? 0),
		generatedAt: Number(metadata.generatedAt ?? 0),
	};
}

export function isToolResultOnlyUserMessage(
	message: MessageWithMetadata,
): boolean {
	if (message.role !== "user" || !Array.isArray(message.content)) {
		return false;
	}
	return (
		message.content.length > 0 &&
		message.content.every((block) => block.type === "tool_result")
	);
}

export function isTurnStartMessage(message: MessageWithMetadata): boolean {
	return (
		message.role === "user" &&
		!isToolResultOnlyUserMessage(message) &&
		!isCompactionSummaryMessage(message)
	);
}

export function findFirstUserMessageIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = 0; index < messages.length; index += 1) {
		if (isTurnStartMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

export function findLastTurnStartIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isTurnStartMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

export function findLastAssistantIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "assistant") {
			return index;
		}
	}
	return -1;
}

export function findLatestSummaryIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isCompactionSummaryMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

export function findCutIndex(
	messages: MessageWithMetadata[],
	preserveRecentTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): number {
	const lastTurnStartIndex = findLastTurnStartIndex(messages);
	// Agentario: если нет turn start сообщений, суммаризируем все сообщения
	if (lastTurnStartIndex < 0) {
		return messages.length;
	}
	if (lastTurnStartIndex === 0) {
		// Единственный user-turn в начале: суммируем весь хвост (всё сообщение).
		return messages.length > 1 ? messages.length : 0;
	}

	let total = 0;
	let candidate = messages.length;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		total += estimateMessageTokens(messages[index]);
		candidate = index;
		if (total >= preserveRecentTokens) {
			break;
		}
	}

	// preserveRecent «съел» весь диалог — режем перед текущим user-turn.
	if (candidate <= 0) {
		return lastTurnStartIndex;
	}

	// Snap to a turn-start boundary so the cut never splits a
	// tool_use/tool_result pair (or any other intra-turn block).
	let cut = Math.min(candidate, lastTurnStartIndex);
	while (cut > 0 && !isTurnStartMessage(messages[cut])) {
		cut -= 1;
	}
	// cut=0 → messages.slice(0,0) пусто → «cutIndex=0 некорректен» и пустой fallback.
	if (cut <= 0) {
		return lastTurnStartIndex;
	}
	return cut;
}

export function collectPaths(value: unknown): string[] {
	if (typeof value === "string" && value.trim().length > 0) {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectPaths(item));
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const paths: string[] = [];
		for (const key of [
			"path",
			"file_path",
			"target_file",
			"new_file_path",
			"old_file_path",
		]) {
			paths.push(...collectPaths(record[key]));
		}
		if (Array.isArray(record.files)) {
			for (const item of record.files) {
				if (item && typeof item === "object") {
					paths.push(...collectPaths((item as Record<string, unknown>).path));
				}
			}
		}
		if (Array.isArray(record.file_paths)) {
			paths.push(...collectPaths(record.file_paths));
		}
		return paths;
	}
	return [];
}

export function mergeUnique(base: string[], next: Iterable<string>): string[] {
	const seen = new Set(base);
	for (const value of next) {
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		seen.add(trimmed);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

export function extractFileOps(
	messages: MessageWithMetadata[],
): FileOperationSummary {
	let readFiles: string[] = [];
	let modifiedFiles: string[] = [];
	for (const message of messages) {
		const summaryMetadata = getCompactionSummaryMetadata(message);
		if (summaryMetadata) {
			readFiles = mergeUnique(readFiles, summaryMetadata.details.readFiles);
			modifiedFiles = mergeUnique(
				modifiedFiles,
				summaryMetadata.details.modifiedFiles,
			);
			continue;
		}
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "file") {
				readFiles = mergeUnique(readFiles, [block.path]);
				continue;
			}
			if (block.type !== "tool_use") {
				continue;
			}
			const paths = collectPaths(block.input);
			if (block.name === "read_files") {
				readFiles = mergeUnique(readFiles, paths);
				continue;
			}
			if (block.name === "editor" || block.name === "apply_patch") {
				modifiedFiles = mergeUnique(modifiedFiles, paths);
			}
		}
	}
	return { readFiles, modifiedFiles };
}

export function renderFilesSection(fileOps: FileOperationSummary): string {
	const readLines =
		fileOps.readFiles.length > 0
			? fileOps.readFiles.map((path) => `- ${path}`).join("\n")
			: "- none";
	const modifiedLines =
		fileOps.modifiedFiles.length > 0
			? fileOps.modifiedFiles.map((path) => `- ${path}`).join("\n")
			: "- none";
	return `## Files\nRead:\n${readLines}\nModified:\n${modifiedLines}`;
}

export function ensureFilesSection(
	summary: string,
	fileOps: FileOperationSummary,
): string {
	if (/^## Files$/im.test(summary)) {
		return summary.trim();
	}
	return `${summary.trim()}\n\n${renderFilesSection(fileOps)}`.trim();
}

// Agentario: стандартные части промпт-шаблона суммаризации (до и после текста диалога)
export const DEFAULT_PROMPT_BEFORE = `Ты — компрессор(суммаризатор) текста сообщений чата. Получаешь диалог из чата пользователя с агентом, и разбив чат на отдельные сообщения, начинаешь их обрабатывать отдельно, по следующим правилам:
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

Вот диалог для обработки (сжатия):`;

export const DEFAULT_PROMPT_AFTER = `Выводи мне в ответ только обработанный диалог с сжатыми тобой сообщениями, без кавычек, без предисловий "Вот сжатое сообщение".`;

export function buildSummaryRequest(options: {
	previousSummary?: string;
	conversationText: string;
	fileOps: FileOperationSummary;
	/** Agentario: custom prompt template part BEFORE the conversation text */
	promptTemplateBefore?: string;
	/** Agentario: custom prompt template part AFTER the conversation text */
	promptTemplateAfter?: string;
}): string {
	// Agentario: строго по шаблону — промпт + диалог
	// Если есть предыдущая суммаризация, добавляем её в начало диалога
	let dialogContent = "";
	if (options.previousSummary?.trim()) {
		dialogContent = `[Предыдущая суммаризация]\n${options.previousSummary.trim()}\n\n${options.conversationText || "(пусто)"}`;
	} else {
		dialogContent = options.conversationText || "(пусто)";
	}

	// Agentario: если задан пользовательский шаблон — используем его
	const before = options.promptTemplateBefore?.trim();
	const after = options.promptTemplateAfter?.trim();
	if (before || after) {
		const beforePart = before || DEFAULT_PROMPT_BEFORE;
		const afterPart = after || DEFAULT_PROMPT_AFTER;
		return `${beforePart}\n\n--- НАЧАЛО ДИАЛОГА ---\n${dialogContent}\n--- КОНЕЦ ДИАЛОГА ---\n\n${afterPart}`;
	}

	return `${DEFAULT_PROMPT_BEFORE}\n\n--- НАЧАЛО ДИАЛОГА ---\n${dialogContent}\n--- КОНЕЦ ДИАЛОГА ---\n\n${DEFAULT_PROMPT_AFTER}`;
}

export function resolveSummarizerConfig(options: {
	activeProviderConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	/** Agentario: динамический лимит output токенов (перекрывает дефолт) */
	maxOutputTokensOverride?: number;
}): ProviderConfig {
	const summarizer = options.summarizer;
	const withSummarizerDefaults = (config: ProviderConfig): ProviderConfig => {
		// Agentario: убираем capabilities связанные с tools из конфига суммаризатора.
		// Это предотвращает Jinja template ошибки в LM Studio когда model использует
		// tool-calling темплейт, а запрос суммаризации не содержит инструментов.
		const filteredCapabilities = config.capabilities?.filter(
			(c) => c !== "tools"
		);
		if (config.providerId === "openai-codex") {
			const { maxOutputTokens: _maxOutputTokens, ...rest } = config;
			return {
				...rest,
				thinking: false,
				...(filteredCapabilities ? { capabilities: filteredCapabilities } : {}),
			};
		}
		return {
			...config,
			maxOutputTokens:
				options.maxOutputTokensOverride
				?? config.maxOutputTokens
				?? DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS,
			thinking: false,
			...(filteredCapabilities ? { capabilities: filteredCapabilities } : {}),
		};
	};
	if (!summarizer) {
		return withSummarizerDefaults(options.activeProviderConfig);
	}
	const baseProviderConfig =
		summarizer.providerConfig?.providerId === summarizer.providerId
			? summarizer.providerConfig
			: undefined;
	// Normalize baseUrl: add /v1 suffix for OpenAI-compatible providers if missing
	const rawBaseUrl = summarizer.baseUrl ?? baseProviderConfig?.baseUrl;
	const normalizedBaseUrl = normalizeOpenAiCompatibleBaseUrl(
		rawBaseUrl,
		summarizer.providerId,
	);
	return withSummarizerDefaults({
		...(baseProviderConfig ?? {}),
		providerId: summarizer.providerId,
		modelId: summarizer.modelId,
		apiKey: summarizer.apiKey ?? baseProviderConfig?.apiKey,
		baseUrl: normalizedBaseUrl,
		headers: summarizer.headers ?? baseProviderConfig?.headers,
		knownModels: summarizer.knownModels ?? baseProviderConfig?.knownModels,
		maxOutputTokens:
			options.maxOutputTokensOverride
			?? summarizer.maxOutputTokens
			?? DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS,
	});
}

/**
 * Normalize baseUrl for OpenAI-compatible providers.
 * If the URL doesn't end with /v1 or /v1/, append /v1.
 * This ensures compatibility with LM Studio, Ollama, and other OpenAI-compatible servers.
 */
function normalizeOpenAiCompatibleBaseUrl(
	baseUrl: string | undefined,
	providerId: string,
): string | undefined {
	if (!baseUrl) {
		return baseUrl;
	}
	// Only normalize for OpenAI-compatible providers
	const openAiCompatibleProviders = [
		"openai-compatible",
		"lmstudio",
		"ollama",
		"litellm",
	];
	if (!openAiCompatibleProviders.includes(providerId)) {
		return baseUrl;
	}
	const trimmed = baseUrl.trim();
	if (!trimmed) {
		return baseUrl;
	}
	// Already has /v1 or /v1/ suffix
	if (trimmed.endsWith("/v1") || trimmed.endsWith("/v1/")) {
		return trimmed;
	}
	// Add /v1 suffix
	return trimmed.endsWith("/") ? `${trimmed}v1` : `${trimmed}/v1`;
}

export function buildSummaryMessage(options: {
	summary: string;
	fileOps: FileOperationSummary;
	tokensBefore: number;
}): MessageWithMetadata {
	return {
		role: "user",
		content: `Context summary:\n\n${options.summary}`,
		metadata: {
			kind: "compaction_summary",
			summary: options.summary,
			details: options.fileOps,
			tokensBefore: options.tokensBefore,
			generatedAt: Date.now(),
		} satisfies CompactionSummaryMetadata,
	};
}

export function getMaxInputTokens(
	context: Pick<CoreCompactionContext, "maxInputTokens">,
): number {
	return context.maxInputTokens;
}
