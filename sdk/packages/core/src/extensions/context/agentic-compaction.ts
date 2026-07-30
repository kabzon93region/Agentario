import { createHandlerAsync } from "@agentario/llms";
import type { BasicLogger } from "@agentario/shared";
// @ts-ignore - Node.js built-in modules
import { writeFile, mkdir } from "node:fs/promises";
// @ts-ignore
import { join } from "node:path";
// @ts-ignore
import { homedir } from "node:os";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionSummarizerConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	buildSummarizationUnits,
	type EstimateMessageTokens,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	isOverallPictureMessage,
	packSummarizationUnits,
	resolveSummarizerConfig,
	serializeMessage,
} from "./compaction-shared";

const DEFAULT_CHUNK_SIZE = 16000;

// Agentario: dump summarizer request/response under Documents for debugging.
// Set AGENTARIO_COMPACTION_DEBUG=0 to disable.
const COMPACTION_DEBUG_ENABLED =
	typeof process === "undefined" ||
	(process.env.AGENTARIO_COMPACTION_DEBUG !== "0" &&
		process.env.AGENTARIO_COMPACTION_DEBUG !== "false");

function resolveCompactionDebugDir(): string {
	if (!COMPACTION_DEBUG_ENABLED) {
		return "";
	}
	// Prefer Y:\Documents when present (user debug path), else ~/Documents.
	return process.platform === "win32"
		? "Y:\\Documents\\agentario-compaction-debug"
		: join(homedir(), "Documents", "agentario-compaction-debug");
}

const DEBUG_DIR = resolveCompactionDebugDir();

async function writeDebugFile(phase: string, chunkIndex: number | undefined, request: string, response: string): Promise<void> {
	if (!DEBUG_DIR) {
		return;
	}
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `compaction_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		const content = `=== ЗАПРОС К МОДЕЛИ ===\n\n${request}\n\n\n=== ОТВЕТ МОДЕЛИ ===\n\n${response}`;
		await writeFile(filepath, content, 'utf-8');
	} catch {
		// debug-only — ignore write failures
	}
}

async function writeRequestFile(phase: string, chunkIndex: number | undefined, request: string): Promise<string> {
	if (!DEBUG_DIR) {
		return "";
	}
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `REQUEST_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		await writeFile(filepath, request, 'utf-8');
		return filepath;
	} catch (err) {
		return `error: ${err}`;
	}
}

/**
 * Agentario: сохраняет полный JSON payload, отправляемый модели:
 * системный промпт, массив сообщений, параметры провайдера.
 */
async function writePayloadFile(
	phase: string,
	chunkIndex: number | undefined,
	providerConfig: ProviderConfig,
	systemPrompt: string,
	messages: Array<{ role: string; content: string }>,
): Promise<string> {
	if (!DEBUG_DIR) {
		return "";
	}
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `PAYLOAD_${phase}${chunkSuffix}_${timestamp}.json`;
		const filepath = join(DEBUG_DIR, filename);
		const payload = {
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			baseUrl: providerConfig.baseUrl,
			maxOutputTokens: providerConfig.maxOutputTokens,
			systemPrompt,
			messages,
			savedAt: new Date().toISOString(),
		};
		await writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');
		return filepath;
	} catch (err) {
		return `error: ${err}`;
	}
}

async function writeRawResponseFile(phase: string, chunkIndex: number | undefined, rawChunks: string[], textResult: string): Promise<void> {
	if (!DEBUG_DIR) {
		return;
	}
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `RESPONSE_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		const content = `=== RAW CHUNKS (${rawChunks.length}) ===\n\n${rawChunks.join('\n---\n')}\n\n\n=== ASSEMBLED TEXT (${textResult.length} chars) ===\n\n${textResult}`;
		await writeFile(filepath, content, 'utf-8');
	} catch {
		// debug-only — ignore write failures
	}
}

/**
 * Agentario: сохраняет полный сырой JSON каждого чанка от модели.
 * В отличие от writeRawResponseFile (который сохраняет метаданные строками),
 * здесь — сериализованные объекты чанков целиком.
 */
async function writeRawChunksJsonFile(
	phase: string,
	chunkIndex: number | undefined,
	chunkObjects: unknown[],
): Promise<void> {
	if (!DEBUG_DIR) {
		return;
	}
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `RAW_CHUNKS_JSON_${phase}${chunkSuffix}_${timestamp}.json`;
		const filepath = join(DEBUG_DIR, filename);
		await writeFile(filepath, JSON.stringify(chunkObjects, null, 2), 'utf-8');
	} catch {
		// debug-only — ignore write failures
	}
}

/**
 * Strip thinking/reasoning tags that leaked into the text channel.
 *
 * When a local model (LM Studio) switches from reasoning to text mid-stream,
 * the text channel may contain `</think>` or `</thinking>` without a
 * matching opener — the model continued thinking in the text channel after
 * LM Studio stopped routing to the reasoning channel.
 *
 * Strategy:
 * 1. Main cleanup: remove complete `<think>...</think>` / `<thinking>...</thinking>` blocks.
 * 2. Post-cleanup safeguard: if a closing think tag still exists (orphaned closer
 *    without opener), everything before it is leaked thinking — keep only what's after.
 */
function stripThinkingTags(text: string): string {
	if (!text) {
		return text;
	}

	let result = text;

	// 1. Main logic: remove complete think/thinking blocks
	result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');
	result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
	result = result.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');

	// 2. Post-cleanup safeguard: orphaned closing tags.
	//    After step 1, if `</think>` or `</thinking>` still remains,
	//    it means the opener was in the reasoning channel (already consumed)
	//    and the closer leaked into text. Everything before it is leaked thinking.
	const lastThinkClose = result.lastIndexOf('</think>');
	const lastThinkingClose = result.lastIndexOf('</thinking>');
	const lastBracketClose = result.lastIndexOf('[/thinking]');
	const closeIdx = Math.max(lastThinkClose, lastThinkingClose, lastBracketClose);
	if (closeIdx >= 0) {
		const closeLen = closeIdx === lastThinkClose
			? '</think>'.length
			: closeIdx === lastThinkingClose
				? '</thinking>'.length
				: '[/thinking]'.length;
		const after = result.slice(closeIdx + closeLen).trim();
		if (after.length > 0) {
			result = after;
		}
	}

	// 3. Strip markdown code fences
	result = result
		.replace(/^```(?:markdown|md|json|text)?\s*\n?/g, '')
		.replace(/\n?```\s*$/g, '')
		.trim();

	return result;
}

// Agentario: сборка streaming чанков с разделением reasoning и text
async function collectStreamingChunks(options: {
	providerConfig: ProviderConfig;
	request: string;
	logger?: BasicLogger;
	chunkIndex?: number;
}): Promise<{ text: string; reasoning: string; chunkCount: number; textChunkCount: number; reasoningChunkCount: number; rawChunks: string[]; rawChunkObjects: unknown[] }> {
	const handler = await createHandlerAsync(options.providerConfig);

	let text = "";
	let reasoning = "";
	let chunkCount = 0;
	let textChunkCount = 0;
	let reasoningChunkCount = 0;
	const rawChunks: string[] = [];
	const rawChunkObjects: unknown[] = [];

	// Agentario: отправляем ТОЛЬКО user-сообщение без системного промпта.
	// Системный промпт вызывает конфликт с чат-темплейтами моделей (например, tool-calling темплейты
	// в LM Studio ожидают формат с инструментами). Запрос суммаризации должен быть полностью
	// самостоятельным сообщением, не зависящим от контекста чата.
	for await (const chunk of handler.createMessage(
		"", // пустой системный промпт
		[{ role: "user", content: options.request }],
	)) {
		chunkCount++;
		const chunkAny = chunk as unknown as { type: string; text?: string; reasoning?: string; success?: boolean; error?: string | object | Record<string, unknown> };
		// Agentario: сохраняем RAW объект каждого чанка (полный JSON)
		rawChunkObjects.push({ ...chunkAny, _chunkIndex: chunkCount });
		// Agentario: сохраняем RAW данные каждого чанка (строковое представление)
		const displayText = chunkAny.text || chunkAny.reasoning || '';
		rawChunks.push(`[chunk ${chunkCount}] type=${chunkAny.type}, textLen=${chunkAny.text ? chunkAny.text.length : 0}, reasoningLen=${chunkAny.reasoning ? chunkAny.reasoning.length : 0}, text="${displayText.substring(0, 100).replace(/\n/g, '\\n')}"`);
		// Agentario: логируем первые 5 и каждый 100-й чанк
		if (chunkCount <= 5 || chunkCount % 100 === 0) {
			options.logger?.log?.(`generateSummary: chunk ${chunkCount}: type=${chunkAny.type}, textLen=${chunkAny.text ? chunkAny.text.length : 0}, reasoningLen=${chunkAny.reasoning ? chunkAny.reasoning.length : 0}`, { severity: "info" });
		}
		// Agentario: разделяем reasoning и text — НЕ смешиваем их
		if (chunkAny.type === "text" || chunkAny.type === "text-delta") {
			text += (chunkAny.text || '');
			textChunkCount++;
			continue;
		}
		if (chunkAny.type === "reasoning" || chunkAny.type === "reasoning-delta") {
			reasoning += (chunkAny.reasoning || '');
			reasoningChunkCount++;
			continue;
		}
		if (chunkAny.type === "done" && !chunkAny.success && chunkAny.error) {
			// Agentario: правильно строкифицируем ошибку — она может быть объектом
			let errorMsg: string;
			if (typeof chunkAny.error === "string") {
				errorMsg = chunkAny.error;
			} else if (typeof chunkAny.error === "object" && chunkAny.error !== null) {
				const errObj = chunkAny.error as Record<string, unknown>;
				// Try to extract message from nested error objects like {error: {code, message, type}}
				const nested = errObj.error as Record<string, unknown> | undefined;
				if (nested && typeof nested === "object" && typeof nested.message === "string") {
					errorMsg = nested.message;
				} else if (typeof errObj.message === "string") {
					errorMsg = errObj.message;
				} else {
					try { errorMsg = JSON.stringify(chunkAny.error); }
					catch { errorMsg = String(chunkAny.error); }
				}
			} else {
				errorMsg = String(chunkAny.error);
			}
			options.logger?.log?.(`generateSummary: error from model: ${errorMsg.substring(0, 500)}`, { severity: "error" });
			throw new Error(errorMsg);
		}
	}

	return { text, reasoning, chunkCount, textChunkCount, reasoningChunkCount, rawChunks, rawChunkObjects };
}

// Agentario: try to extract structured summary from reasoning text.
// Looks for patterns like [User]:, [Agent]:, "Summary:", "Сжатый диалог:" etc.
function extractSummaryFromReasoning(text: string): string | null {
	// Pattern 1: structured messages like [User]: ... [Agent]: ...
	const structuredMatch = text.match(/(?:\[User\]|\[Agent(?:-\w+)?\]|\[Bot\]).+/s);
	if (structuredMatch) {
		const start = text.indexOf(structuredMatch[0]);
		if (start >= 0) {
			return text.substring(start).trim();
		}
	}
	// Pattern 2: Russian/English summary markers
	const markers = text.match(/(?:Сжат(?:ый|ие) диалог(?:а)?|Summary|Сжатие|Сжатые сообщения)[:\s]+/i);
	if (markers) {
		const start = text.indexOf(markers[0]);
		if (start >= 0) {
			return text.substring(start).trim();
		}
	}
	return null;
}

async function generateSummary(options: {
	providerConfig: ProviderConfig;
	request: string;
	logger?: BasicLogger;
	chunkIndex?: number; // Agentario: индекс чанка для отладки
}): Promise<string> {
	const phase = options.chunkIndex !== undefined ? 'map' : 'single';
	options.logger?.log?.(`generateSummary: starting phase=${phase}, chunk=${options.chunkIndex ?? 'N/A'}, provider=${options.providerConfig.providerId}/${options.providerConfig.modelId}, requestLen=${options.request.length}`, { severity: "info" });

	// Agentario: сохраняем текст запроса в файл ДО отправки
	const requestFilePath = await writeRequestFile(phase, options.chunkIndex, options.request);
	options.logger?.log?.(`generateSummary: request saved to ${requestFilePath}`, { severity: "info" });

	// Agentario: сохраняем полный JSON payload (messages array + provider config)
	const apiMessages = [{ role: "user" as const, content: options.request }];
	await writePayloadFile(phase, options.chunkIndex, options.providerConfig, "", apiMessages);

	// Do not append /no_think or force thinking:false — that overrides LM Studio
	// thinking-budget settings. Use the request as-is.
	const result = await collectStreamingChunks({
		...options,
		request: options.request,
	});

	options.logger?.log?.(`generateSummary: done. chunks=${result.chunkCount}, textChunks=${result.textChunkCount}, reasoningChunks=${result.reasoningChunkCount}, textLen=${result.text.length}, reasoningLen=${result.reasoning.length}`, { severity: "info" });

	// Agentario: сохраняем ВСЕ чанки ответа в файл (текстовое представление)
	await writeRawResponseFile(phase, options.chunkIndex, result.rawChunks, result.text);
	// Agentario: сохраняем полный сырой JSON каждого чанка от модели
	await writeRawChunksJsonFile(phase, options.chunkIndex, result.rawChunkObjects);

	let finalText = result.text.trim();
	// If the model put the answer only in the reasoning channel, try to extract
	// useful content. Reasoning is often verbose thinking, not a summary.
	// Cap reasoning fallback to prevent 78k reasoning dumps from inflating context.
	if (!finalText && result.reasoning.trim()) {
		const reasoningText = result.reasoning.trim();
		const reasoningTokens = estimateTokens(reasoningText.length);
		const inputTokens = estimateTokens(options.request.length);
		// If reasoning is more than 1.5x the input, it's thinking — not a summary.
		if (reasoningTokens > inputTokens * 1.5) {
			const errorMsg = `Summarizer produced only reasoning (${reasoningTokens} tokens, input ${inputTokens} tokens, ratio ${(reasoningTokens / inputTokens).toFixed(1)}x). Model likely thinks instead of summarizing.`;
			options.logger?.log?.(errorMsg, { severity: "error" });
			throw new Error(errorMsg);
		}
		// Try to extract the actual summary from reasoning (look for structured markers)
		const extracted = extractSummaryFromReasoning(reasoningText);
		if (extracted) {
			options.logger?.log?.(`generateSummary: extracted summary from reasoning (${extracted.length} chars from ${reasoningText.length} chars reasoning).`, { severity: "info" });
			finalText = extracted;
		} else {
			// Cap reasoning to avoid inflating context
			const MAX_REASONING_AS_SUMMARY = 4000; // chars
			if (reasoningText.length > MAX_REASONING_AS_SUMMARY) {
				options.logger?.log?.(`generateSummary: reasoning too long (${reasoningText.length} chars), truncating to ${MAX_REASONING_AS_SUMMARY}.`, { severity: "warn" });
				finalText = reasoningText.substring(0, MAX_REASONING_AS_SUMMARY);
			} else {
				options.logger?.log?.(`generateSummary: using reasoning as summary body (${reasoningText.length} chars).`, { severity: "warn" });
				finalText = reasoningText;
			}
		}
	}

	options.logger?.log?.(`[CompactionSummary] model=${options.providerConfig.modelId}, inputChars=${options.request.length}, outputChars=${finalText.length}, textChunks=${result.textChunkCount}/${result.chunkCount}, reasoningChunks=${result.reasoningChunkCount}, preview=${finalText.substring(0, 200)}...`, { severity: "info" });

	if (!finalText) {
		const errorMsg = `Model returned empty response (${result.chunkCount} chunks, ${result.textChunkCount} text, ${result.reasoningChunkCount} reasoning). Provider: ${options.providerConfig.providerId}, Model: ${options.providerConfig.modelId}, BaseUrl: ${options.providerConfig.baseUrl || "default"}`;
		options.logger?.error?.(errorMsg);
		throw new Error(errorMsg);
	}

	// Strip accidental think-tag wrappers from the assembled text body.
	// Handles: complete blocks, orphaned closers (</think> without opener),
	// and orphaned openers (<think> without closer).
	const cleaned = stripThinkingTags(finalText);

	// Agentario: reject if summary is larger than input (anti-inflate).
	const outputTokens = estimateTokens(cleaned.length);
	const inputTokens = estimateTokens(options.request.length);
	if (inputTokens > 0 && outputTokens > inputTokens * 0.9) {
		const errorMsg = `Summarizer output (${outputTokens} tokens) >= 90% of input (${inputTokens} tokens). Summary would not reduce context.`;
		options.logger?.log?.(errorMsg, { severity: "error" });
		throw new Error(errorMsg);
	}

	await writeDebugFile(phase, options.chunkIndex, options.request, cleaned);
	return cleaned;
}

// Agentario: извлечение "Общей картины" из суммаризации
function extractOverallPicture(summary: string): string | null {
	// Ищем строку "Общая картина:" или "Overall picture:" и извлекаем до конца строки
	const match = summary.match(/(?:Общая картина|Overall picture|Summary|Итог)[:\s]+(.+)/i);
	return match ? match[1].trim() : null;
}

// Agentario: извлечение суммаризированных сообщений (User:/Agent:) из суммаризации
function extractSummarizedMessages(summary: string): string[] {
	const lines = summary.split('\n');
	const messages: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		// Support both "User:" and "[User]:" / "[Agent-thinking]:" forms from the model.
		if (
			/^(?:User|Agent|Пользователь|Агент)[:\s]+/i.test(trimmed) ||
			/^\[(?:User|Agent|Пользователь|Агент)[^\]]*\]:/i.test(trimmed)
		) {
			messages.push(trimmed);
		}
	}
	return messages;
}

export async function runAgenticCompaction(options: {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	chunkSize?: number;
	/** Agentario: custom prompt template parts for summarization */
	promptTemplateBefore?: string;
	promptTemplateAfter?: string;
	logger?: BasicLogger;
	/** Agentario: compaction mode - "context" uses previous summary, "full" re-summarizes all */
	compactionMode?: "context" | "full";
	/** Agentario: callback for status updates in UI */
	statusCallback?: (message: string) => void;
}): Promise<CoreCompactionResult | undefined> {
	const messages = options.context.messages;
	if (messages.length < 2) {
		options.logger?.log?.("Agentic compaction: messages.length < 2, skipping", { severity: "warn" });
		return undefined;
	}

	// Agentario: логируем структуру сообщений для диагностики
	const userMsgCount = messages.filter(m => m.role === "user").length;
	const assistantMsgCount = messages.filter(m => m.role === "assistant").length;
	const isFullMode = options.compactionMode === "full";
	options.logger?.log?.(`Agentic compaction: messages.length=${messages.length}, user=${userMsgCount}, assistant=${assistantMsgCount}, preserveRecentTokens=${options.preserveRecentTokens}, compactionMode=${options.compactionMode || "context"}`, { severity: "info" });
	
	// Agentario: статус в UI
	options.statusCallback?.(`Суммаризация: ${messages.length} сообщений (user: ${userMsgCount}, assistant: ${assistantMsgCount}), режим: ${isFullMode ? "полный чат" : "контекст"}`)

	// Agentario: для full режима отключаем защиту preserveRecentTokens
	const effectivePreserveRecentTokens = isFullMode ? 0 : options.preserveRecentTokens;
	
	const cutIndex = findCutIndex(
		messages,
		effectivePreserveRecentTokens,
		options.estimateMessageTokens,
	);
	options.logger?.log?.(`Agentic compaction: cutIndex=${cutIndex}`, { severity: "info" });
	
	// Agentario: статус в UI с разбивкой по категориям
	const pinnedTokens = messages.slice(cutIndex).reduce((sum, m) => sum + options.estimateMessageTokens(m), 0);
	const foldableCount = cutIndex;
	const preservedCount = messages.length - cutIndex;
	options.statusCallback?.(
		`Расчёт: foldable=${foldableCount} сообщ., pinned=${preservedCount} сообщ. (~${pinnedTokens.toLocaleString()} ток.), preserveRecentTokens=${effectivePreserveRecentTokens}`
	)
	
	if (cutIndex <= 0) {
		options.logger?.log?.(`Agentic compaction: cutIndex check failed (cutIndex=${cutIndex}, len=${messages.length})`, { severity: "warn" });
		options.statusCallback?.(`Ошибка: cutIndex=${cutIndex} некорректен`)
		return undefined;
	}

	const messagesToSummarize = messages.slice(0, cutIndex);
	
	// Agentario: для "full" режима игнорируем предыдущую суммаризацию
	const latestSummaryIndex = isFullMode ? -1 : findLatestSummaryIndex(messagesToSummarize);
	const previousSummary =
		latestSummaryIndex >= 0
			? getCompactionSummaryMetadata(messagesToSummarize[latestSummaryIndex])
					?.summary
			: undefined;
	// Agentario: newMessagesToFold должен быть подмножеством messagesToSummarize
	let newMessagesToFold =
		latestSummaryIndex >= 0
			? messagesToSummarize.slice(latestSummaryIndex + 1)
			: messagesToSummarize;
	
	// Agentario: фильтр — исключаем "Общие картины" из первого пайплайна
	const overallPictureMessages = newMessagesToFold.filter(isOverallPictureMessage);
	newMessagesToFold = newMessagesToFold.filter(m => !isOverallPictureMessage(m));
	
	// Agentario: логируем для диагностики
	options.logger?.log?.(`Agentic compaction: messagesToSummarize=${messagesToSummarize.length}, latestSummaryIndex=${latestSummaryIndex}, newMessagesToFold=${newMessagesToFold.length}, overallPicturesFiltered=${overallPictureMessages.length}`, { severity: "info" });
	if (newMessagesToFold.length === 0) {
		options.logger?.log?.("Agentic compaction: newMessagesToFold is empty after filtering, skipping", { severity: "warn" });
		return undefined;
	}

	const fileOps = extractFileOps(messagesToSummarize);

	const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
	const useChunked = chunkSize > 0;
	const modelContextTokens = Math.max(
		1,
		options.context.maxInputTokens || DEFAULT_CHUNK_SIZE,
	);

	// Do not force maxOutputTokens=chunkSize*2 — leave LM Studio / model defaults.
	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: options.providerConfig,
		summarizer: options.summarizer,
	});

	let rawSummary: string;

	// Agentario: логируем параметры для суммаризации
	options.logger?.log?.(`Agentic compaction: useChunked=${useChunked}, chunkSize=${chunkSize}, modelContextTokens=${modelContextTokens}, summarizerProvider=${summarizerProviderConfig.providerId}/${summarizerProviderConfig.modelId}`, { severity: "info" });

	try {
	if (!useChunked) {
		// Single-pass (unlimited) mode — still stub file bodies; no truncate on tools/thinking
		const units = buildSummarizationUnits(newMessagesToFold);
		const conversationText = units.map((u) => u.text).join("\n\n").trim();
		const summaryRequest = buildSummaryRequest({
			previousSummary,
			conversationText,
			fileOps,
			promptTemplateBefore: options.promptTemplateBefore,
			promptTemplateAfter: options.promptTemplateAfter,
		});
		options.logger?.debug("Agentic compaction summarizer (single-pass)", {
			messagesToSummarize: messagesToSummarize.length,
			summaryRequestChars: summaryRequest.length,
			summaryRequestEstimatedTokens: estimateTokens(summaryRequest.length),
		});
		rawSummary = await generateSummary({
			providerConfig: summarizerProviderConfig,
			request: summaryRequest,
			logger: options.logger,
		});
	} else {
		// Map-reduce: pack units without truncating tool_result/thinking; solo chunks at 90% context
		const units = buildSummarizationUnits(newMessagesToFold);
		const packedTexts = packSummarizationUnits({
			units,
			chunkSizeTokens: chunkSize,
			modelContextTokens,
		});

		const totalUnitTokens = units.reduce((sum, u) => sum + estimateTokens(u.text.length), 0);
		options.statusCallback?.(
			`К отправке: ${newMessagesToFold.length} сообщ. → ${units.length} units (~${totalUnitTokens.toLocaleString()} ток.), лимит чанка: ${chunkSize} ток., чанков: ${packedTexts.length}`
		);

		options.logger?.debug("Agentic compaction: map-reduce mode", {
			totalMessages: newMessagesToFold.length,
			units: units.length,
			chunks: packedTexts.length,
			chunkSizeTokens: chunkSize,
			modelContextTokens,
		});
		for (let i = 0; i < packedTexts.length; i++) {
			options.logger?.log?.(
				`Agentic compaction: packedChunk[${i}] chars=${packedTexts[i].length}, tokens≈${estimateTokens(packedTexts[i].length)}`,
				{ severity: "info" },
			);
		}

		const intermediateSummaries: string[] = [];
		for (let i = 0; i < packedTexts.length; i++) {
			const chunkRequest = buildSummaryRequest({
				previousSummary: i === 0 ? previousSummary : undefined,
				conversationText: packedTexts[i],
				fileOps: i === 0 ? fileOps : { readFiles: [], modifiedFiles: [] },
				promptTemplateBefore: options.promptTemplateBefore,
				promptTemplateAfter: options.promptTemplateAfter,
			});

			options.statusCallback?.(
				`Отправка чанка ${i + 1}/${packedTexts.length}: ≈${estimateTokens(chunkRequest.length)} токенов (${chunkRequest.length} симв.)`,
			);

			options.logger?.debug(`Compaction map phase chunk ${i + 1}/${packedTexts.length}`, {
				chunkChars: packedTexts[i].length,
			});
			const chunkSummary = await generateSummary({
				providerConfig: summarizerProviderConfig,
				request: chunkRequest,
				logger: options.logger,
				chunkIndex: i,
			});
			if (chunkSummary.trim()) {
				intermediateSummaries.push(chunkSummary.trim());
				const summaryTokens = estimateTokens(chunkSummary.length);
				options.statusCallback?.(`Чанк ${i + 1}/${packedTexts.length} готов: ${summaryTokens} токенов в summary`);
			}
		}

		if (intermediateSummaries.length === 0) {
			options.logger?.log?.("Agentic compaction: intermediateSummaries is empty, skipping", { severity: "warn" });
			return undefined;
		}

		if (intermediateSummaries.length === 1) {
			rawSummary = intermediateSummaries[0];
		} else {
			// Agentario: извлекаем "Общие картины" из каждого чанка
			const overallPictures: string[] = [];
			const allMessages: string[] = [];
			
			for (const summary of intermediateSummaries) {
				const picture = extractOverallPicture(summary);
				if (picture) {
					overallPictures.push(picture);
				}
				const msgs = extractSummarizedMessages(summary);
				allMessages.push(...msgs);
			}
			
			// Agentario: добавляем "Общие картины" из отфильтрованных сообщений
			for (const msg of overallPictureMessages) {
				const text = typeof msg.content === "string"
					? msg.content
					: serializeMessage(msg);
				// Извлекаем текст после "Общая картина:"
				const match = text.match(/Общая картина[:\s]+(.+)/i);
				if (match) {
					overallPictures.push(match[1].trim());
				}
			}
			
			// Если есть несколько "Общих картин", суммаризируем их в одну
			let finalOverallPicture = "";
			if (overallPictures.length > 1) {
				const picturesText = overallPictures.join("\n");
				const pictureRequest = `Объедини следующие описания общей картины в одно краткое описание. Будь лаконичен.\n\n${picturesText}`;
				options.logger?.debug("Compaction: merging overall pictures", {
					picturesCount: overallPictures.length,
				});
				finalOverallPicture = await generateSummary({
					providerConfig: summarizerProviderConfig,
					request: pictureRequest,
					logger: options.logger,
					chunkIndex: undefined,
				});
			} else if (overallPictures.length === 1) {
				finalOverallPicture = overallPictures[0];
			}
			
			// Собираем финальный результат: Общая картина + сообщения
			const messagesText = allMessages.join("\n");
			rawSummary = finalOverallPicture
				? `Общая картина: ${finalOverallPicture}\n\n${messagesText}`
				: messagesText;
		}
	}

	if (!rawSummary?.trim()) {
		options.logger?.log?.("Agentic compaction: rawSummary is empty, skipping", { severity: "warn" });
		return undefined;
	}
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		options.logger?.log?.(`Agentic compaction: generateSummary failed: ${errMsg}`, { severity: "error" });

		// Agentario: определяем тип ошибки и показываем понятное сообщение
		let userMessage: string;
		if (errMsg.includes("No user query found in messages") || errMsg.includes("Unable to generate parser for this template")) {
			userMessage = "Ошибка совместимости с чат-темплейтом модели. " +
				"Модель суммаризации использует темплейт, который не принимает запрос суммаризации. " +
				"Решение: настройте отдельную модель для суммаризации в Настройки → Сжатие → Модель суммаризации " +
				"(используйте модель без tool-calling темплейта, например, Qwen, Llama, Mistral).";
		} else if (errMsg.includes("context length") || errMsg.includes("max_tokens") || errMsg.includes("context_length_exceeded")) {
			userMessage = "Превышен контекст модели суммаризации. Уменьшите размер чанка в настройках сжатия.";
		} else if (errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed") || errMsg.includes("timeout")) {
			userMessage = "Не удалось подключиться к провайдеру модели суммаризации. Проверьте настройки подключения.";
		} else {
			userMessage = `Ошибка суммаризации: ${errMsg.substring(0, 200)}`;
		}
		options.statusCallback?.(userMessage);
		return undefined;
	}

	const summary = ensureFilesSection(rawSummary, fileOps);
	const tokensBefore = messages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	const resultMessages = [
		buildSummaryMessage({
			summary,
			fileOps,
			tokensBefore,
		}),
		...messages.slice(cutIndex),
	];
	const tokensAfter = resultMessages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	options.logger?.debug("Performed agentic compaction", {
		messagesBefore: messages.length,
		messagesAfter: resultMessages.length,
		messagesSummarized: cutIndex,
		messagesPreserved: messages.length - cutIndex,
		tokensBefore,
		tokensAfter,
		chunked: useChunked,
		maxInputTokens: options.context.maxInputTokens,
	});
	// Agentario: проверяем что результат не пустой
	if (resultMessages.length === 0) {
		options.logger?.log?.("Agentic compaction: result is empty, aborting", { severity: "error" });
		return undefined;
	}
	return { messages: resultMessages };
}
