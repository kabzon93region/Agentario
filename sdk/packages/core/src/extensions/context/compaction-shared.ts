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
// Agentario: fallback — переопределяется динамически из chunkSize в runAgenticCompaction.
// 16384 достаточно для reasoning-моделей (qwen и др.), которые тратят ~4000 токенов на thinking.
export const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 16384;
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

export type SerializeMessageOptions = {
	/**
	 * Truncate tool_result / thinking / file for basic compaction retained messages.
	 * Agentic map-phase uses `false` — oversized blocks go to solo chunks instead.
	 * @default true
	 */
	truncateLargeBlocks?: boolean;
	/**
	 * How to render `type:"file"` blocks for summarization input.
	 * - `truncated` — first N chars (basic)
	 * - `stub` — path only; raw file body must not enter chat summarizer chunks
	 * @default "truncated"
	 */
	fileContentMode?: "truncated" | "stub";
};

/** Soft threshold: tool_result / thinking above this go to an individual chunk. */
export const SOLO_BLOCK_CHAR_THRESHOLD = 2_000;

/** Max characters for thinking blocks in summarization units. Longer thinking is truncated. */
export const THINKING_TRUNCATE_CHARS = 2_000;

/** Individual oversized blocks may use up to this fraction of the model context window. */
export const SOLO_CHUNK_CONTEXT_RATIO = 0.9;

export function serializeMessage(
	message: MessageWithMetadata,
	options?: SerializeMessageOptions,
): string {
	const truncateLargeBlocks = options?.truncateLargeBlocks !== false;
	const fileContentMode = options?.fileContentMode ?? "truncated";
	const roleLabel = message.role === "user" ? "User" : "Bot";

	if (typeof message.content === "string") {
		return `[${roleLabel}]: ${message.content}`;
	}
	const lines: string[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				lines.push(`[${roleLabel}]: ${block.text}`);
				break;
			case "thinking":
				lines.push(
					`[Bot thinking]: ${
						truncateLargeBlocks
							? truncateText(block.thinking, 2_000)
							: block.thinking
					}`,
				);
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
				lines.push(
					`[Tool result]: ${
						truncateLargeBlocks
							? flattenToolResultContent(block.content)
							: flattenToolResultContentFull(block.content)
					}`,
				);
				break;
			case "file":
				if (fileContentMode === "stub") {
					lines.push(
						`[${roleLabel} file ${block.path}]: [саммари файла — сырое содержимое в суммаризацию чата не передаётся]`,
					);
				} else {
					lines.push(
						`[${roleLabel} file ${block.path}]: ${truncateText(block.content, FILE_CONTENT_CHAR_LIMIT)}`,
					);
				}
				break;
			case "image":
				lines.push(`[${roleLabel} image]: ${block.mediaType}`);
				break;
		}
	}
	return lines.join("\n");
}

/** Flatten tool_result without the 2k compaction cap (agentic summarizer input). */
export function flattenToolResultContentFull(
	content: ToolResultContent["content"],
): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => {
			switch (block.type) {
				case "text":
					return block.text;
				case "file":
					// Nested file bodies are not re-sent into chat summarization.
					return `<file path="${block.path}">[саммари файла — сырое содержимое опущено]</file>`;
				case "image":
					return `[image:${block.mediaType}]`;
				default:
					return "";
			}
		})
		.join("\n");
}

export function serializeConversation(
	messages: MessageWithMetadata[],
	options?: SerializeMessageOptions,
): string {
	return messages.map((m) => serializeMessage(m, options)).join("\n\n").trim();
}

/** One dialog fragment for map-phase packing (may span multiple chunks with continuation). */
export type SummarizationUnit = {
	text: string;
	/** Short label for continuation headers, e.g. "Tool result", "Bot thinking", "User" */
	label: string;
	forceSolo: boolean;
};

/**
 * Split messages into summarization units without truncating tool_result / thinking.
 * File blocks become path stubs (raw content stays out of chat summarizer).
 */
export function buildSummarizationUnits(
	messages: MessageWithMetadata[],
): SummarizationUnit[] {
	const units: SummarizationUnit[] = [];
	for (const message of messages) {
		const roleLabel = message.role === "user" ? "User" : "Bot";
		if (typeof message.content === "string") {
			const text = `[${roleLabel}]: ${message.content}`;
			units.push({
				text,
				label: roleLabel,
				forceSolo: message.content.length > SOLO_BLOCK_CHAR_THRESHOLD,
			});
			continue;
		}
		for (const block of message.content) {
			switch (block.type) {
				case "text": {
					const text = `[${roleLabel}]: ${block.text}`;
					units.push({
						text,
						label: roleLabel,
						forceSolo: block.text.length > SOLO_BLOCK_CHAR_THRESHOLD,
					});
					break;
				}
				case "thinking": {
					// Agentario: truncate long thinking blocks for summarization.
					// The summarizer doesn't need the full thinking text — only key points.
					const rawThinking = block.thinking;
					const thinkingText = rawThinking.length > THINKING_TRUNCATE_CHARS
						? `[Bot thinking (truncated ${rawThinking.length}→${THINKING_TRUNCATE_CHARS} chars)]: ${rawThinking.substring(0, THINKING_TRUNCATE_CHARS)}…`
						: `[Bot thinking]: ${rawThinking}`;
					units.push({
						text: thinkingText,
						label: "Bot thinking",
						forceSolo: rawThinking.length > SOLO_BLOCK_CHAR_THRESHOLD,
					});
					break;
				}
				case "redacted_thinking":
					units.push({
						text: "[Bot thinking]: [redacted]",
						label: "Bot thinking",
						forceSolo: false,
					});
					break;
				case "tool_use": {
					const body = `${block.name}(${formatToolInput(block.input)})`;
					units.push({
						text: `[Bot tool calls]: ${body}`,
						label: `Bot tool calls (${block.name})`,
						forceSolo: body.length > SOLO_BLOCK_CHAR_THRESHOLD,
					});
					break;
				}
				case "tool_result": {
					const body = flattenToolResultContentFull(block.content);
					units.push({
						text: `[Tool result]: ${body}`,
						label: block.name ? `Tool result (${block.name})` : "Tool result",
						forceSolo: body.length > SOLO_BLOCK_CHAR_THRESHOLD,
					});
					break;
				}
				case "file":
					units.push({
						text: `[${roleLabel} file ${block.path}]: [саммари файла — сырое содержимое в суммаризацию чата не передаётся]`,
						label: `${roleLabel} file ${block.path}`,
						forceSolo: false,
					});
					break;
				case "image":
					units.push({
						text: `[${roleLabel} image]: ${block.mediaType}`,
						label: `${roleLabel} image`,
						forceSolo: false,
					});
					break;
			}
		}
	}
	return units;
}

/**
 * Pack units into conversation-text chunks for the summarizer.
 * - Normal budget: `chunkSizeTokens`
 * - Solo / oversized tool_result & thinking: up to 90% of model context
 * - Split bodies get a continuation header on the next chunk
 */
export function packSummarizationUnits(options: {
	units: SummarizationUnit[];
	chunkSizeTokens: number;
	modelContextTokens: number;
}): string[] {
	const normalBudget = Math.max(1, options.chunkSizeTokens);
	const soloBudget = Math.max(
		1,
		Math.floor(options.modelContextTokens * SOLO_CHUNK_CONTEXT_RATIO),
	);

	const chunks: string[] = [];
	let currentParts: string[] = [];
	let currentTokens = 0;
	let pendingContinuation: string | undefined;

	const flush = () => {
		if (currentParts.length === 0) {
			return;
		}
		chunks.push(currentParts.join("\n\n").trim());
		currentParts = [];
		currentTokens = 0;
	};

	const pushPart = (text: string, tokens: number) => {
		if (pendingContinuation) {
			currentParts.push(`[Продолжение: ${pendingContinuation}]`);
			pendingContinuation = undefined;
		}
		currentParts.push(text);
		currentTokens += tokens;
	};

	const emitSplitUnit = (unit: SummarizationUnit, budget: number) => {
		flush();
		const charsPerChunk = Math.max(256, Math.floor(budget * CHARS_PER_TOKEN));
		if (unit.text.length <= charsPerChunk) {
			pushPart(unit.text, estimateTokens(unit.text.length));
			flush();
			return;
		}
		let offset = 0;
		let partIndex = 0;
		while (offset < unit.text.length) {
			const slice = unit.text.slice(offset, offset + charsPerChunk);
			offset += charsPerChunk;
			if (partIndex === 0) {
				pushPart(slice, estimateTokens(slice.length));
			} else {
				pendingContinuation = unit.label;
				pushPart(slice, estimateTokens(slice.length));
			}
			flush();
			partIndex++;
			if (offset < unit.text.length) {
				pendingContinuation = unit.label;
			}
		}
	};

	for (const unit of options.units) {
		const unitTokens = estimateTokens(unit.text.length);
		const solo = unit.forceSolo || unitTokens > normalBudget;

		if (solo) {
			emitSplitUnit(unit, soloBudget);
			continue;
		}

		if (currentParts.length > 0 && currentTokens + unitTokens > normalBudget) {
			// Would need truncation to keep with prior dialog — move to its own chunk instead.
			flush();
		}

		if (unitTokens > normalBudget) {
			emitSplitUnit(unit, soloBudget);
			continue;
		}

		pushPart(unit.text, unitTokens);
	}

	flush();
	return chunks.filter((c) => c.length > 0);
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
						// Всегда считаем полный размер — buildSummarizationUnits использует
						// flattenToolResultContentFull (без лимита), estimator должен совпадать
						contentLength +=
							"[Tool result]: ".length +
							estimateToolResultProviderLength(block.content);
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

/**
 * Agentario: Find the last assistant message with a substantive text block.
 * A "substantive" assistant message has at least one `type: "text"` block
 * with non-empty content (not just thinking / tool_use / tool_result).
 * Returns -1 if none found.
 */
export function findLastSubstantiveAssistantIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const msg = messages[index];
		if (msg.role !== "assistant") {
			continue;
		}
		if (typeof msg.content === "string" && msg.content.trim().length > 0) {
			return index;
		}
		if (Array.isArray(msg.content)) {
			const hasText = msg.content.some(
				(block) =>
					block.type === "text" &&
					"text" in block &&
					typeof block.text === "string" &&
					block.text.trim().length > 0,
			);
			if (hasText) {
				return index;
			}
		}
	}
	return -1;
}

export interface WrapUpRange {
	/** Index of the first turn-start user message (the task / first question). */
	preserveFirst: number;
	/** Index of the last assistant message with substantive text (the final answer). */
	preserveLast: number;
	/** Index where folding starts (preserveFirst + 1). */
	foldStart: number;
	/** Index where folding ends (preserveLast, exclusive). */
	foldEnd: number;
}

/**
 * Agentario: Compute the wrap-up range for forced/compaction.
 *
 * For a completed dialogue the structure is typically:
 *   [0] user task       ← preserveFirst
 *   [1..N-1] tools/thinking/file-results  ← fold these
 *   [N] assistant text  ← preserveLast
 *
 * Returns `null` when:
 *   - fewer than 3 messages
 *   - no first turn-start user message
 *   - no substantive assistant answer (agent still mid-flight)
 *   - first and last are the same (nothing to fold)
 */
export function findWrapUpRange(
	messages: MessageWithMetadata[],
): WrapUpRange | null {
	if (messages.length < 3) {
		return null;
	}
	const preserveFirst = findFirstUserMessageIndex(messages);
	if (preserveFirst < 0) {
		return null;
	}
	const preserveLast = findLastSubstantiveAssistantIndex(messages);
	if (preserveLast < 0) {
		return null;
	}
	// Nothing between first and last — nothing to fold.
	if (preserveLast <= preserveFirst + 1) {
		return null;
	}
	return {
		preserveFirst,
		preserveLast,
		foldStart: preserveFirst + 1,
		foldEnd: preserveLast,
	};
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

// Agentario: wrap-up промпт — для принудительной суммаризации завершённого диалога.
// Сохраняет якоря (задание + финальный ответ), сжимает промежуточную работу.
export const WRAP_UP_PROMPT_BEFORE = `Ты — компрессор текста для принудительной суммаризации завершённого диалога. Твоя задача — сжать ПРОМЕЖУТОЧНУЮ работу (вызовы инструментов, чтение файлов, thinking-блоки, промежуточные действия) в краткий связный итог.

Первое сообщение (задание пользователя) и последнее (финальный ответ агента) ты НЕ сжимаешь — они остаются как есть. Твоя задача — сжать ВСЁ между ними.

Правила:
1. Оставь только суть: что делали, какие файлы читали/писали, какие команды выполняли, какие выводы сделали по ходу.
2. Для прочитанных файлов — краткая характеристика (назначение, ключевые функции/выводы), без сырого кода.
3. Удали служебные маркеры (Tool calls, Thinking, Completed, пути к файлам, diff-блоки).
4. Формат: один связный абзац или несколько кратких тезисов.
5. Обязательно добавь секцию:
## Находки из файлов
- путь: краткое описание (назначение, ключевые элементы)

6. В конце (перед финальным ответом) — список прочитанных/изменённых файлов (пути).`;

export const WRAP_UP_PROMPT_AFTER = `Выводи ответ строго в формате:
[сжатый итог промежуточной работы]
## Находки из файлов
- ...
## Files
Read:
- ...
Modified:
- ...`;

export function buildSummaryRequest(options: {
	previousSummary?: string;
	conversationText: string;
	fileOps: FileOperationSummary;
	/** Agentario: custom prompt template part BEFORE the conversation text */
	promptTemplateBefore?: string;
	/** Agentario: custom prompt template part AFTER the conversation text */
	promptTemplateAfter?: string;
	/** Agentario: use wrap-up prompts (preserves anchors, compresses middle) */
	wrapUp?: boolean;
}): string {
	// Agentario: строго по шаблону — промпт + диалог
	// Если есть предыдущая суммаризация, добавляем её в начало диалога
	let dialogContent = "";
	if (options.previousSummary?.trim()) {
		dialogContent = `[Предыдущая суммаризация]\n${options.previousSummary.trim()}\n\n${options.conversationText || "(пусто)"}`;
	} else {
		dialogContent = options.conversationText || "(пусто)";
	}

	// Agentario: wrap-up mode — используем специальный промпт для принудительной суммаризации
	if (options.wrapUp) {
		const before = options.promptTemplateBefore?.trim() || WRAP_UP_PROMPT_BEFORE;
		const after = options.promptTemplateAfter?.trim() || WRAP_UP_PROMPT_AFTER;
		return `${before}\n\n--- НАЧАЛО ДИАЛОГА ---\n${dialogContent}\n--- КОНЕЦ ДИАЛОГА ---\n\n${after}`;
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
	/** Optional max output tokens override (prefer omitting — use LM Studio / model defaults). */
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
		// Do NOT set thinking:false / reasoning overrides — that breaks LM Studio
		// thinking-budget settings. Leave provider/model thinking config untouched.
		const { thinking: _thinking, ...rest } = config as ProviderConfig & {
			thinking?: unknown;
		};
		if (config.providerId === "openai-codex") {
			const { maxOutputTokens: _maxOutputTokens, ...codexRest } = rest;
			return {
				...codexRest,
				...(filteredCapabilities ? { capabilities: filteredCapabilities } : {}),
			};
		}
		const maxOutputTokens =
			options.maxOutputTokensOverride
			?? rest.maxOutputTokens
			?? DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS;
		return {
			...rest,
			...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
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
