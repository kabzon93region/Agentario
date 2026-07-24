import {
	captureCompactionExecuted,
	captureCompactionSkipped,
	type TelemetryCompactionStrategy,
} from "../../services/telemetry/core-events";
import type {
	CoreCompactionConfig,
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionStrategy,
	CoreSessionConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import { runAgenticCompaction } from "./agentic-compaction";
import { runBasicCompaction } from "./basic-compaction";
import {
	createTokenEstimator,
	DEFAULT_MAX_INPUT_TOKENS,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	DEFAULT_RESERVE_TOKENS,
	DEFAULT_TARGET_RATIO,
	DEFAULT_THRESHOLD_RATIO,
	estimateTokens,
} from "./compaction-shared";

export interface ContextPipelinePrepareTurnInput {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: CoreCompactionContext["messages"];
	apiMessages: CoreCompactionContext["messages"];
	abortSignal: AbortSignal;
	systemPrompt: string;
	tools: unknown[];
	model: CoreCompactionContext["model"];
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
	/** Agentario: реальные inputTokens от модели (из предыдущего ответа). Если доступны — используются вместо estimate. */
	lastInputTokens?: number;
}

export interface ContextPipelinePrepareTurnResult {
	messages: CoreCompactionContext["messages"];
	systemPrompt?: string;
}

type EstimateMessageTokens = ReturnType<typeof createTokenEstimator>;

type BuiltinCompactionStrategyOptions = {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	compaction: CoreCompactionConfig | undefined;
	mode: ContextCompactionMode;
	estimateMessageTokens: EstimateMessageTokens;
	logger: Pick<CoreSessionConfig, "logger">["logger"];
	/** Agentario: compaction mode - "context" uses previous summary, "full" re-summarizes all */
	compactionMode?: "context" | "full";
	/** Agentario: callback for status updates in UI */
	statusCallback?: (message: string) => void;
};

type BuiltinCompactionStrategyRunner = (
	options: BuiltinCompactionStrategyOptions,
) =>
	| Promise<CoreCompactionResult | undefined>
	| CoreCompactionResult
	| undefined;

export type ContextCompactionMode = "auto" | "manual";

export interface ContextCompactionPrepareTurnOptions {
	mode?: ContextCompactionMode;
	manualTargetRatio?: number;
	/** Agentario: compaction mode - "context" uses previous summary, "full" re-summarizes all */
	compactionMode?: "context" | "full";
	/** Agentario: callback for status updates in UI */
	statusCallback?: (message: string) => void;
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function resolveMaxInputTokens(input: {
	configMaxInputTokens?: number;
	modelMaxInputTokens?: number;
	contextWindow?: number;
	modelMaxTokens?: number;
	providerMaxInputTokens?: number;
}): number {
	const candidates: number[] = [];
	if (isPositiveFiniteNumber(input.configMaxInputTokens)) {
		candidates.push(input.configMaxInputTokens);
	}
	if (isPositiveFiniteNumber(input.modelMaxInputTokens)) {
		candidates.push(input.modelMaxInputTokens);
	}
	if (isPositiveFiniteNumber(input.contextWindow)) {
		candidates.push(input.contextWindow);
		if (
			isPositiveFiniteNumber(input.modelMaxTokens) &&
			input.modelMaxTokens < input.contextWindow
		) {
			candidates.push(input.contextWindow - input.modelMaxTokens);
		}
	}
	// Agentario: fallback на настройки провайдера (context window из LM Studio/Ollama)
	if (isPositiveFiniteNumber(input.providerMaxInputTokens)) {
		candidates.push(input.providerMaxInputTokens);
	}
	return candidates.length > 0
		? Math.min(...candidates)
		: DEFAULT_MAX_INPUT_TOKENS;
}

// summarizeToolResults removed — was only used in debug logging

const BUILTIN_COMPACTION_STRATEGIES = {
	basic: ({ context, estimateMessageTokens, logger }) =>
		runBasicCompaction({
			context,
			estimateMessageTokens,
			logger,
		}),
	agentic: ({
		context,
		providerConfig,
		compaction,
		mode,
		estimateMessageTokens,
		logger,
		compactionMode,
		statusCallback,
	}) =>
		runAgenticCompaction({
			context,
			providerConfig,
			summarizer: compaction?.summarizer,
			// Agentario: для full режима отключаем защиту preserveRecentTokens
			preserveRecentTokens: compactionMode === "full" ? 0 : resolveAdaptivePreserveRecentTokens({
				maxInputTokens: context.maxInputTokens,
				configPreserve: compaction?.preserveRecentTokens,
				mode,
				triggerTokens: context.triggerTokens,
			}),
			estimateMessageTokens,
			chunkSize: compaction?.chunkSize,
			doubleSummarization: compaction?.doubleSummarization,
			promptTemplateBefore: compaction?.promptTemplateBefore,
			promptTemplateAfter: compaction?.promptTemplateAfter,
			logger,
			compactionMode, // Agentario: передаём режим суммаризации
			statusCallback, // Agentario: callback для статусов в UI
		}),
} satisfies Record<CoreCompactionStrategy, BuiltinCompactionStrategyRunner>;

export function resolveAdaptivePreserveRecentTokens(input: {
	maxInputTokens: number;
	configPreserve?: number;
	mode: ContextCompactionMode;
	triggerTokens: number;
}): number {
	const configured = input.configPreserve ?? DEFAULT_PRESERVE_RECENT_TOKENS;
	// Agentario: максимум 8к токенов (или configured), но не больше чем triggerTokens
	// чтобы освободить место для reserve (8к свободных токенов)
	const maxPreserve = Math.min(configured, 8_000);
	// triggerTokens = maxInputTokens - reserveTokens
	// Если нужно освободить место, сохраняем меньше
	const adaptiveCap = Math.max(
		1_024,
		Math.min(maxPreserve, input.triggerTokens),
	);
	const base = Math.min(configured, adaptiveCap);
	if (input.mode === "manual") {
		// Для manual режима — сохраняем минимум, чтобы максимально сжать
		return Math.min(base, input.triggerTokens, 2_000);
	}
	return base;
}

async function runBuiltinStrategyWithFallback(
	options: BuiltinCompactionStrategyOptions,
): Promise<CoreCompactionResult | undefined> {
	const strategy = options.compaction?.strategy ?? "basic";
	if (strategy !== "agentic") {
		const result = BUILTIN_COMPACTION_STRATEGIES.basic(options);
		return result instanceof Promise ? await result : result;
	}

	try {
		const agenticResult = await BUILTIN_COMPACTION_STRATEGIES.agentic(options);
		if (agenticResult?.messages) {
			return agenticResult;
		}
		options.logger?.log?.(
			"Agentic compaction returned no result; falling back to basic",
			{ severity: "warn" },
		);
	} catch (error) {
		options.logger?.error?.(
			"Agentic compaction failed; falling back to basic",
			{ error, severity: "warn" },
		);
		if (!options.logger?.error) {
			options.logger?.log?.(
				"Agentic compaction failed; falling back to basic",
				{ severity: "warn" },
			);
		}
	}

	const basicResult = BUILTIN_COMPACTION_STRATEGIES.basic(options);
	return basicResult instanceof Promise ? await basicResult : basicResult;
}

function resolveTriggerState(input: {
	inputTokens: number;
	maxInputTokens: number;
	config: CoreCompactionConfig;
}): { shouldCompact: boolean; triggerTokens: number; thresholdRatio: number } {
	// Agentario: prefer dynamic resolver over static value — reads from settings on every check
	const reserveTokensValue = typeof input.config.reserveTokensResolver === "function"
		? input.config.reserveTokensResolver()
		: input.config.reserveTokens;

	if (typeof reserveTokensValue === "number") {
		const reserveTokens = Math.max(0, reserveTokensValue);
		const triggerTokens = Math.max(0, input.maxInputTokens - reserveTokens);
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio:
				input.maxInputTokens > 0 ? triggerTokens / input.maxInputTokens : 0,
		};
	}

	if (typeof input.config.thresholdRatio === "number") {
		const thresholdRatio = input.config.thresholdRatio;
		const triggerTokens = input.maxInputTokens * thresholdRatio;
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio,
		};
	}

	const triggerTokens = Math.max(
		0,
		Math.min(
			input.maxInputTokens - DEFAULT_RESERVE_TOKENS,
			input.maxInputTokens * DEFAULT_THRESHOLD_RATIO,
		),
	);
	return {
		shouldCompact: input.inputTokens > triggerTokens,
		triggerTokens,
		thresholdRatio:
			input.maxInputTokens > 0 ? triggerTokens / input.maxInputTokens : 0,
	};
}

function resolveManualTargetState(input: {
	inputTokens: number;
	maxInputTokens: number;
	autoTriggerTokens: number;
	manualTargetRatio: number | undefined;
}): { triggerTokens: number; thresholdRatio: number } {
	const ratio =
		typeof input.manualTargetRatio === "number" &&
		Number.isFinite(input.manualTargetRatio)
			? input.manualTargetRatio
			: 0.5;
	const targetRatio = Math.min(0.95, Math.max(0.05, ratio));
	// Keep manual compaction at least as aggressive as the configured auto
	// threshold; very low thresholdRatio values intentionally dominate here.
	const targetTokens = Math.max(
		1,
		Math.floor(
			Math.min(input.autoTriggerTokens, input.inputTokens * targetRatio),
		),
	);
	return {
		triggerTokens: targetTokens,
		thresholdRatio:
			input.maxInputTokens > 0 ? targetTokens / input.maxInputTokens : 0,
	};
}

function resolveBasicTargetTokens(input: {
	maxInputTokens: number;
	modelMaxTokens?: number;
	triggerTokens: number;
}): number {
	const targetBaseTokens =
		typeof input.modelMaxTokens === "number" &&
		Number.isFinite(input.modelMaxTokens) &&
		input.modelMaxTokens < input.maxInputTokens
			? input.maxInputTokens - input.modelMaxTokens
			: input.triggerTokens;
	return Math.max(
		1,
		Math.min(
			Math.floor(targetBaseTokens * DEFAULT_TARGET_RATIO),
			input.maxInputTokens,
		),
	);
}

/**
 * Build the `prepareTurn` callback used by the agent runtime to compact the
 * transcript before each model request.
 *
 * Telemetry: emits `task.compaction_executed` on a successful compaction and
 * `task.compaction_skipped` when the configured strategy returns `undefined`.
 * Telemetry is keyed by `config.sessionId` (falling back to the per-turn
 * `conversationId`) and tagged with `provider` / `modelId`.
 *
 * Known gap: compactions performed via plugin `registerMessageBuilder()` or
 * via the `beforeModel` runtime hook bypass this wrapper entirely, so they
 * do not emit compaction telemetry. If we want coverage there too, the
 * plugin/hook pipelines must be instrumented separately.
 */
export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "compaction"
		| "logger"
		| "telemetry"
		| "sessionId"
	>,
	options: ContextCompactionPrepareTurnOptions = {},
):
	| ((
			context: ContextPipelinePrepareTurnInput,
	  ) => Promise<ContextPipelinePrepareTurnResult | undefined>)
	| undefined {
	const userCompaction = config.compaction;
	if (userCompaction?.enabled !== true) {
		return undefined;
	}

	const providerConfig =
		config.providerConfig ??
		({
			providerId: config.providerId,
			modelId: config.modelId,
		} as ProviderConfig);
	const estimateMessageTokens = createTokenEstimator();
	const strategy = userCompaction?.strategy ?? "basic";
	const mode = options.mode ?? "auto";
	const telemetryStrategy: TelemetryCompactionStrategy = userCompaction?.compact
		? "custom"
		: strategy;

	return async (context) => {
		// Agentario: считаем токены сообщений (chat) по символам
		const chatTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		// Agentario: диагностическое логирование — сколько токенов занимают tool results
		let toolResultTokens = 0;
		try {
			toolResultTokens = context.apiMessages
				.filter((m: { role?: string }) => m.role === "tool")
				.reduce((sum: number, m: { content?: unknown }) => {
					const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
					return sum + estimateTokens(content.length);
				}, 0);
		} catch { /* diagnostic only — ignore malformed messages */ }
		if (toolResultTokens > 0 && chatTokens > 0) {
			config.logger?.log?.(`Context compaction diagnostics: toolResults=${toolResultTokens} tokens (${Math.round(toolResultTokens / chatTokens * 100)}% of chat)`, { severity: "info" });
		}
		// Считаем токены системного промпта и инструментов
		const systemPromptTokens = context.systemPrompt ? estimateTokens(context.systemPrompt.length) : 0;
		const toolChars = (context.tools as Array<{ name?: string; description?: string; inputSchema?: unknown }>)?.reduce((sum: number, t) => {
			const nameLen = t.name?.length || 0;
			const descLen = t.description?.length || 0;
			let schemaLen = 0;
			try { schemaLen = t.inputSchema ? JSON.stringify(t.inputSchema).length : 0; } catch { /* ignore */ }
			return sum + nameLen + descLen + schemaLen;
		}, 0) || 0;
		const toolTokens = estimateTokens(toolChars);
		// Оценка по символам (fallback)
		const estimatedInputTokens = chatTokens + systemPromptTokens + toolTokens;
		// Agentario: используем МАКСИМУМ из model-reported и estimate.
		// lastInputTokens — из предыдущего API-запроса, не включает НОВЫЕ tool results, добавленные после.
		// estimatedInputTokens — оценка по символам, включает tool results.
		// Берём max, чтобы не занизить размер контекста (пропуск компакции).
		const inputTokens = Math.max(
			(typeof context.lastInputTokens === "number" && Number.isFinite(context.lastInputTokens) && context.lastInputTokens > 0) ? context.lastInputTokens : 0,
			estimatedInputTokens,
		);
		// Agentario: вызываем maxInputTokensResolver если есть (динамическое значение из настроек)
		const resolvedMaxInputTokens = typeof userCompaction?.maxInputTokensResolver === "function"
			? userCompaction.maxInputTokensResolver()
			: undefined;
		const maxInputTokens = resolveMaxInputTokens({
			configMaxInputTokens: resolvedMaxInputTokens ?? userCompaction?.maxInputTokens,
			modelMaxInputTokens: context.model.info?.maxInputTokens,
			contextWindow: context.model.info?.contextWindow,
			modelMaxTokens: context.model.info?.maxTokens,
			providerMaxInputTokens: providerConfig.maxInputTokens,
		});
		// Agentario: cap inputTokens на maxInputTokens.
		// lastInputTokens может быть от суммаризатора (30k+) и превышать реальный контекст.
		// Модель не может обработать больше токенов чем контекст-окно.
		const cappedInputTokens = maxInputTokens > 0 ? Math.min(inputTokens, maxInputTokens) : inputTokens;
		if (cappedInputTokens < inputTokens) {
			config.logger?.log?.(`Context compaction: capped inputTokens from ${inputTokens} to ${cappedInputTokens} (maxInputTokens=${maxInputTokens})`, { severity: "info" });
		}
		config.logger?.log?.(`Context compaction: mode=${mode}, strategy=${strategy}, inputTokens=${cappedInputTokens}, estimatedInputTokens=${estimatedInputTokens}, lastInputTokens=${context.lastInputTokens ?? "n/a"}, maxInputTokens=${maxInputTokens}, chat=${chatTokens}, sys=${systemPromptTokens}, tools=${toolTokens}, messages=${context.messages.length}`, { severity: "info" });
		const triggerState = resolveTriggerState({
			inputTokens: cappedInputTokens,
			maxInputTokens,
			config: {
				maxInputTokens: userCompaction?.maxInputTokens,
				reserveTokens: userCompaction?.reserveTokens,
				reserveTokensResolver: userCompaction?.reserveTokensResolver,
				thresholdRatio: userCompaction?.thresholdRatio,
			},
		});
		config.logger?.log?.(`Context compaction trigger: triggerTokens=${triggerState.triggerTokens}, shouldCompact=${triggerState.shouldCompact}, thresholdRatio=${triggerState.thresholdRatio}`, { severity: "info" });
		if (mode === "auto" && !triggerState.shouldCompact) {
			return undefined;
		}
		// Agentario: минимальная полезная threshold — не компактировать если chat слишком мал.
		// После первой компакции: pinned (~9k) + маленький chat (~400) = ~9.4k total.
		// Если chat < 5% контекст-окна (min 500) — компакция бессмысленна.
		// Адаптивный порог: для 32k → 1600, для 24.5k → 1225, для 200 → 500 (floor).
		const MIN_USEFUL_CHAT_TOKENS = Math.max(500, Math.floor(maxInputTokens * 0.05));
		if (mode === "auto" && chatTokens < MIN_USEFUL_CHAT_TOKENS) {
			config.logger?.log?.(`Context compaction skipped: chat too small (${chatTokens} tokens < ${MIN_USEFUL_CHAT_TOKENS} minimum). Nothing useful to compact.`, { severity: "info" });
			return undefined;
		}
		const targetState =
			mode === "manual"
				? resolveManualTargetState({
						inputTokens: cappedInputTokens,
						maxInputTokens,
					autoTriggerTokens: triggerState.triggerTokens,
					manualTargetRatio: options.manualTargetRatio,
				})
				: triggerState;
		const targetTokens =
			mode === "auto"
				? resolveBasicTargetTokens({
						maxInputTokens,
						modelMaxTokens: context.model.info?.maxTokens,
						triggerTokens: targetState.triggerTokens,
					})
				: undefined;

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
		parentAgentId: context.parentAgentId,
		iteration: context.iteration,
		messages: context.messages,
			model: context.model,
			maxInputTokens,
			triggerTokens: targetState.triggerTokens,
			targetTokens,
			thresholdRatio: targetState.thresholdRatio,
			utilizationRatio: maxInputTokens > 0 ? cappedInputTokens / maxInputTokens : 0,
		};

	const statusReason =
		mode === "manual" ? "manual_compaction" : "auto_compaction";
	// Agentario: эмитим статистику контекста ПЕРЕД "auto-compacting"
	// Для отображения используем estimatedInputTokens (реальная оценка), а не cappedInputTokens
	const displayInputTokens = estimatedInputTokens;
	const contextPercent = maxInputTokens > 0 ? Math.round((displayInputTokens / maxInputTokens) * 100) : 0;
	const statsMessage = `📊 Контекст: ${displayInputTokens.toLocaleString()} / ${maxInputTokens.toLocaleString()} токенов (${contextPercent}%)`;
	context.emitStatusNotice?.(statsMessage, {
		kind: "context_stats",
		reason: statusReason,
		inputTokens: displayInputTokens,
		maxInputTokens,
		contextPercent,
	});
		// Agentario: эмитим "auto-compacting" с анимацией
		context.emitStatusNotice?.(
			mode === "manual" ? "compacting" : "auto-compacting",
			{
				kind: statusReason,
				reason: statusReason,
				iteration: context.iteration,
				triggerTokens: targetState.triggerTokens,
				maxInputTokens,
				animate: true, // Agentario: флаг для UI чтобы показать анимацию
			},
		);

		const beforeMessageCount = context.messages.length;
		const startedAt = Date.now();

		const result = userCompaction?.compact
			? await userCompaction.compact(compactionContext)
			: await runBuiltinStrategyWithFallback({
					context: compactionContext,
					providerConfig: {
						...providerConfig,
						abortSignal: context.abortSignal,
					},
					compaction: userCompaction,
					mode,
					estimateMessageTokens,
					logger: config.logger,
					compactionMode: options.compactionMode, // Agentario: передаём режим суммаризации
					statusCallback: options.statusCallback, // Agentario: callback для статусов в UI
				});

		const durationMs = Date.now() - startedAt;
		// Telemetry identity: surface the agent/conversation passed into the
		// prepareTurn so multi-agent runs can attribute compactions correctly.
		// `sessionId` is the host-owned session id (ulid). We fall back to the
		// conversation id when no sessionId is supplied (e.g. ad-hoc callers).
		const telemetryUlid = config.sessionId ?? context.conversationId;
		const telemetryIdentity = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId ?? undefined,
		};

		if (result?.messages) {
			const afterTokens = result.messages.reduce(
				(total: number, message) => total + estimateMessageTokens(message),
				0,
			);
		config.logger?.log("Context compaction completed", {
			severity: "info",
			strategy: strategy,
			maxInputTokens,
			inputTokens: displayInputTokens,
			afterTokens,
			tokensSaved: displayInputTokens - afterTokens,
			utilizationBefore: `${((displayInputTokens / maxInputTokens) * 100).toFixed(1)}%`,
			utilizationAfter: `${((afterTokens / maxInputTokens) * 100).toFixed(1)}%`,
			thresholdTrigger: `${(targetState.thresholdRatio * 100).toFixed(1)}%`,
			messagesBefore: beforeMessageCount,
			messagesAfter: result.messages.length,
			messagesRemoved: beforeMessageCount - result.messages.length,
		} as Record<string, unknown>);
		// Agentario: эмитим статистику ПОСЛЕ компакции
		const tokensSaved = displayInputTokens - afterTokens;
		const afterPercent = maxInputTokens > 0 ? Math.round((afterTokens / maxInputTokens) * 100) : 0;
		const durationSec = (durationMs / 1000).toFixed(1);
		const resultMessage = `✅ Компакция завершена за ${durationSec}с: ${displayInputTokens.toLocaleString()} → ${afterTokens.toLocaleString()} токенов (−${tokensSaved.toLocaleString()}, ${afterPercent}%)`;
		context.emitStatusNotice?.(resultMessage, {
			kind: "compaction_result",
			reason: statusReason,
			inputTokens: displayInputTokens,
			afterTokens,
			tokensSaved,
			afterPercent,
			durationMs,
			durationSec,
		});
		captureCompactionExecuted(config.telemetry, {
				ulid: telemetryUlid,
				strategy: telemetryStrategy,
				mode,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			tokensBefore: displayInputTokens,
			tokensAfter: afterTokens,
			tokensSaved: displayInputTokens - afterTokens,
				triggerTokens: targetState.triggerTokens,
				maxInputTokens,
				thresholdRatio: targetState.thresholdRatio,
				durationMs,
				// Matches the field name used by other TASK telemetry helpers
				// (e.g. captureTaskCompleted, captureToolUsage).
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		} else {
			captureCompactionSkipped(config.telemetry, {
				ulid: telemetryUlid,
				strategy: telemetryStrategy,
				mode,
				reason: "no_result",
			tokensBefore: displayInputTokens,
			triggerTokens: targetState.triggerTokens,
				maxInputTokens,
				thresholdRatio: targetState.thresholdRatio,
				durationMs,
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		}

		return result;
	};
}
