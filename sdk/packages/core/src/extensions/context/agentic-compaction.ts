import { createHandlerAsync } from "@agentario/llms";
import type { BasicLogger, MessageWithMetadata } from "@agentario/shared";
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
	type EstimateMessageTokens,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	isOverallPictureMessage,
	resolveSummarizerConfig,
	serializeConversation,
	serializeMessage,
} from "./compaction-shared";

const DEFAULT_CHUNK_SIZE = 16000;

// Agentario: директория для отладочных файлов суммаризации
const DEBUG_DIR = join(homedir(), "Documents", "agentario-compaction-debug");

// Agentario: функция для записи отладочного текста в файл
async function writeDebugFile(phase: string, chunkIndex: number | undefined, request: string, response: string): Promise<void> {
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `compaction_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		const content = `=== ЗАПРОС К МОДЕЛИ ===\n\n${request}\n\n\n=== ОТВЕТ МОДЕЛИ ===\n\n${response}`;
		await writeFile(filepath, content, 'utf-8');
		console.log(`[CompactionDebug] Wrote debug: ${filepath}`);
	} catch (err) {
		console.error(`[CompactionDebug] Failed to write debug file: ${err}`);
	}
}

// Agentario: сохранение запроса в отдельный файл (до отправки модели)
async function writeRequestFile(phase: string, chunkIndex: number | undefined, request: string): Promise<string> {
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `REQUEST_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		await writeFile(filepath, request, 'utf-8');
		console.log(`[CompactionDebug] Wrote request: ${filepath}`);
		return filepath;
	} catch (err) {
		console.error(`[CompactionDebug] Failed to write request file: ${err}`);
		return `error: ${err}`;
	}
}

// Agentario: сохранение всех чанков ответа в файл
async function writeRawResponseFile(phase: string, chunkIndex: number | undefined, rawChunks: string[], textResult: string): Promise<void> {
	try {
		await mkdir(DEBUG_DIR, { recursive: true });
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const chunkSuffix = chunkIndex !== undefined ? `_chunk${chunkIndex + 1}` : '';
		const filename = `RESPONSE_${phase}${chunkSuffix}_${timestamp}.txt`;
		const filepath = join(DEBUG_DIR, filename);
		const content = `=== RAW CHUNKS (${rawChunks.length}) ===\n\n${rawChunks.join('\n---\n')}\n\n\n=== ASSEMBLED TEXT (${textResult.length} chars) ===\n\n${textResult}`;
		await writeFile(filepath, content, 'utf-8');
		console.log(`[CompactionDebug] Wrote response: ${filepath}`);
	} catch (err) {
		console.error(`[CompactionDebug] Failed to write response file: ${err}`);
	}
}

// Agentario: сборка streaming чанков с разделением reasoning и text
async function collectStreamingChunks(options: {
	providerConfig: ProviderConfig;
	request: string;
	logger?: BasicLogger;
	chunkIndex?: number;
}): Promise<{ text: string; reasoning: string; chunkCount: number; textChunkCount: number; reasoningChunkCount: number; rawChunks: string[] }> {
	const handler = await createHandlerAsync(options.providerConfig);

	let text = "";
	let reasoning = "";
	let chunkCount = 0;
	let textChunkCount = 0;
	let reasoningChunkCount = 0;
	const rawChunks: string[] = [];

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
		// Agentario: сохраняем RAW данные каждого чанка
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

	return { text, reasoning, chunkCount, textChunkCount, reasoningChunkCount, rawChunks };
}

async function generateSummary(options: {
	providerConfig: ProviderConfig;
	request: string;
	logger?: BasicLogger;
	chunkIndex?: number; // Agentario: индекс чанка для отладки
}): Promise<string> {
	const phase = options.chunkIndex !== undefined ? 'map' : 'single';
	options.logger?.log?.(`generateSummary: starting phase=${phase}, chunk=${options.chunkIndex ?? 'N/A'}, provider=${options.providerConfig.providerId}/${options.providerConfig.modelId}, requestLen=${options.request.length}`, { severity: "info" });

	// Agentario: сохраняем запрос в файл ДО отправки
	const requestFilePath = await writeRequestFile(phase, options.chunkIndex, options.request);
	options.logger?.log?.(`generateSummary: request saved to ${requestFilePath}`, { severity: "info" });

	// Agentario: добавляем /no_think к запросу СРАЗУ, чтобы модель не тратила время
	// на размышления. Размышления не нужны для суммаризации — только итоговый текст.
	// Это значительно ускоряет суммаризацию (в 2-5 раз).
	const noThinkRequest = options.request + "\n\n/no_think";
	await writeRequestFile(phase + '_nothink', options.chunkIndex, noThinkRequest);

	let result = await collectStreamingChunks({
		...options,
		request: noThinkRequest,
	});

	options.logger?.log?.(`generateSummary: done. chunks=${result.chunkCount}, textChunks=${result.textChunkCount}, reasoningChunks=${result.reasoningChunkCount}, textLen=${result.text.length}, reasoningLen=${result.reasoning.length}`, { severity: "info" });

	// Fallback: если модель всё ещё выдала только reasoning — retry без /no_think
	if (!result.text.trim() && result.reasoning.trim()) {
		options.logger?.log?.(`generateSummary: model produced only reasoning even with /no_think. Retrying without it.`, { severity: "warn" });

		await writeRequestFile(phase + '_fallback', options.chunkIndex, options.request);

		result = await collectStreamingChunks({
			...options,
			request: options.request,
		});

		options.logger?.log?.(`generateSummary: fallback done. chunks=${result.chunkCount}, textChunks=${result.textChunkCount}, reasoningChunks=${result.reasoningChunkCount}, textLen=${result.text.length}, reasoningLen=${result.reasoning.length}`, { severity: "info" });
	}

	// Agentario: сохраняем ВСЕ чанки ответа в файл (используем text, а НЕ reasoning)
	await writeRawResponseFile(phase, options.chunkIndex, result.rawChunks, result.text);

	const finalText = result.text.trim();
	options.logger?.log?.(`[CompactionSummary] model=${options.providerConfig.modelId}, inputChars=${options.request.length}, outputChars=${finalText.length}, textChunks=${result.textChunkCount}/${result.chunkCount}, reasoningChunks=${result.reasoningChunkCount}, preview=${finalText.substring(0, 200)}...`, { severity: "info" });

	if (!finalText) {
		// Agentario: если и после retry нет text — используем последнюю часть reasoning как fallback
		if (result.reasoning.trim()) {
			options.logger?.log?.(`generateSummary: no text even after retry. Using last 500 chars of reasoning as fallback.`, { severity: "warn" });
			const fallback = result.reasoning.trim().slice(-500);
			await writeDebugFile(phase, options.chunkIndex, options.request, `[FALLBACK from reasoning]\n${fallback}`);
			return fallback;
		}
		const errorMsg = `Model returned empty response (${result.chunkCount} chunks, ${result.textChunkCount} text, ${result.reasoningChunkCount} reasoning). Provider: ${options.providerConfig.providerId}, Model: ${options.providerConfig.modelId}, BaseUrl: ${options.providerConfig.baseUrl || "default"}`;
		options.logger?.error?.(errorMsg);
		throw new Error(errorMsg);
	}

	// Agentario: убираем markdown разметку и thinking-теги из ответа модели
	const cleaned = finalText
		// Убираем thinking-теги (модели могут отправлять thinking как text чанки)
		.replace(/<think>[\s\S]*?<\/think>/gi, '')
		.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
		.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
		// Убираем markdown код-блоки
		.replace(/^```(?:markdown|md|json|text)?\s*\n?/g, '')
		.replace(/\n?```\s*$/g, '')
		.trim();
	// Agentario: записываем комбинированный файл (запрос + ответ)
	await writeDebugFile(phase, options.chunkIndex, options.request, cleaned);
	return cleaned;
}

/**
 * Split messages into chunks by token count.
 * Each chunk respects message boundaries (never splits a single message).
 */
function chunkMessages(
	messages: MessageWithMetadata[],
	chunkSizeTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): MessageWithMetadata[][] {
	if (chunkSizeTokens <= 0 || messages.length === 0) {
		return [messages];
	}
	const chunks: typeof messages[] = [];
	let currentChunk: typeof messages = [];
	let currentTokens = 0;
	for (const msg of messages) {
		const msgTokens = estimateMessageTokens(msg);
		if (currentChunk.length > 0 && currentTokens + msgTokens > chunkSizeTokens) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentTokens = 0;
		}
		currentChunk.push(msg);
		currentTokens += msgTokens;
	}
	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}
	return chunks;
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
		if (/^(?:User|Agent|Пользователь|Агент)[:\s]+/i.test(trimmed)) {
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
	doubleSummarization?: boolean;
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
	
	// Agentario: статус в UI
	options.statusCallback?.(`Расчёт cutIndex: ${cutIndex} из ${messages.length}, preserveRecentTokens=${effectivePreserveRecentTokens}`)
	
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

	// Agentario: динамический лимит output токенов — x2 от размера входного чанка
	const dynamicMaxOutputTokens = chunkSize > 0 ? chunkSize * 2 : undefined;
	options.logger?.log?.(`Agentic compaction: dynamicMaxOutputTokens=${dynamicMaxOutputTokens} (chunkSize=${chunkSize})`, { severity: "info" });

	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: options.providerConfig,
		summarizer: options.summarizer,
		maxOutputTokensOverride: dynamicMaxOutputTokens,
	});

	let rawSummary: string;

	// Agentario: логируем параметры для суммаризации
	options.logger?.log?.(`Agentic compaction: useChunked=${useChunked}, chunkSize=${chunkSize}, summarizerProvider=${summarizerProviderConfig.providerId}/${summarizerProviderConfig.modelId}`, { severity: "info" });

	try {
	if (!useChunked) {
		// Single-pass (unlimited) mode
		const conversationText = serializeConversation(newMessagesToFold);
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
		// Map-reduce mode
		// Agentario: логируем токены каждого сообщения для диагностики
		let totalTokensToChunk = 0;
		for (let i = 0; i < newMessagesToFold.length; i++) {
			const tokens = options.estimateMessageTokens(newMessagesToFold[i]);
			totalTokensToChunk += tokens;
			if (i < 5 || tokens > 1000) { // логируем первые 5 и большие
				options.logger?.log?.(`Agentic compaction: message[${i}] tokens=${tokens}, role=${newMessagesToFold[i].role}`, { severity: "info" });
			}
		}
		options.logger?.log?.(`Agentic compaction: totalTokensToChunk=${totalTokensToChunk}, chunkSize=${chunkSize}`, { severity: "info" });
		
		const chunks = chunkMessages(
			newMessagesToFold,
			chunkSize,
			options.estimateMessageTokens,
		);
		
		// Agentario: статус в UI
		options.statusCallback?.(`Лимит чанка: ${chunkSize} токенов, рассчитано чанков: ${chunks.length}, сообщений для суммаризации: ${newMessagesToFold.length}`)
		
		options.logger?.debug("Agentic compaction: map-reduce mode", {
			totalMessages: newMessagesToFold.length,
			chunks: chunks.length,
			chunkSizeTokens: chunkSize,
			doubleSummarization: options.doubleSummarization,
		});
		// Agentario: логируем размеры чанков
		for (let i = 0; i < chunks.length; i++) {
			const chunkTokens = chunks[i].reduce((sum, m) => sum + options.estimateMessageTokens(m), 0);
			options.logger?.log?.(`Agentic compaction: chunk[${i}] messages=${chunks[i].length}, tokens=${chunkTokens}`, { severity: "info" });
		}

		// Map phase: summarize each chunk
		const intermediateSummaries: string[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const chunkText = serializeConversation(chunks[i]);
			const chunkTokens = chunks[i].reduce((sum, m) => sum + options.estimateMessageTokens(m), 0);
			const chunkRequest = buildSummaryRequest({
				previousSummary: i === 0 ? previousSummary : undefined,
				conversationText: chunkText,
				fileOps: i === 0 ? fileOps : { readFiles: [], modifiedFiles: [] },
				promptTemplateBefore: options.promptTemplateBefore,
				promptTemplateAfter: options.promptTemplateAfter,
			});
			
			// Agentario: статус в UI
			options.statusCallback?.(`Отправка чанка ${i + 1}/${chunks.length}: ${chunks[i].length} сообщений, ${chunkTokens} токенов`)
			
			options.logger?.debug(`Compaction map phase chunk ${i + 1}/${chunks.length}`, {
				chunkMessages: chunks[i].length,
				chunkChars: chunkText.length,
			});
			const chunkSummary = await generateSummary({
				providerConfig: summarizerProviderConfig,
				request: chunkRequest,
				logger: options.logger,
				chunkIndex: i,
			});
			if (chunkSummary.trim()) {
				intermediateSummaries.push(chunkSummary.trim());
				// Agentario: статус в UI
				const summaryTokens = estimateTokens(chunkSummary.length);
				options.statusCallback?.(`Чанк ${i + 1}/${chunks.length} готов: ${summaryTokens} токенов в summary`)
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
		doubleSummarization: options.doubleSummarization,
		maxInputTokens: options.context.maxInputTokens,
	});
	// Agentario: проверяем что результат не пустой
	if (resultMessages.length === 0) {
		options.logger?.log?.("Agentic compaction: result is empty, aborting", { severity: "error" });
		return undefined;
	}
	return { messages: resultMessages };
}
