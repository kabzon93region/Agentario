// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Manual context compaction for the VSCode SDK adapter. This mirrors the CLI's
// apps/cli/src/runtime/interactive/compaction.ts (`compactInteractiveMessages`):
// it builds a manual-mode compaction `prepareTurn` via the SDK's
// `createContextCompactionPrepareTurn` and runs it against the current session
// transcript, returning the compacted messages.
//
// The CLI then restarts the session with the compacted messages; the VSCode
// adapter does the same in SdkCompactionCoordinator. Keeping the actual
// compaction effect in the SDK (rather than asking the model to "summarize the
// conversation") is what makes the compact button real instead of improvised.

import { type CoreSessionConfig, createContextCompactionPrepareTurn } from "@agentario/core"
import type { Message as SdkMessage, ModelInfo as SdkModelInfo } from "@agentario/llms"
import { Logger } from "@/shared/services/Logger"

// When the active model does not declare a context window, fall back to a
// conservative input budget so manual compaction still has a target to shrink
// toward. Matches the CLI's FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS.
const FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS = 64_000

export interface CompactSessionMessagesInput {
	/** Provider/model/compaction config for the active session. */
	config: Pick<
		CoreSessionConfig,
		"providerConfig" | "providerId" | "modelId" | "knownModels" | "compaction" | "logger" | "telemetry"
	>
	/** The active session id (used for telemetry keying). */
	sessionId: string
	/** The conversation transcript to compact (SDK message shape). */
	messages: SdkMessage[]
	/** Agentario: compaction mode - "context" uses previous summary, "full" re-summarizes all */
	compactionMode?: "context" | "full"
	/** Agentario: callback for status updates in UI */
	statusCallback?: (message: string) => void
}

export interface CompactSessionMessagesResult {
	compacted: boolean
	messages: SdkMessage[]
	/** Agentario: specific reason when compaction was skipped or failed */
	reason?: string
}

/**
 * Run a manual context compaction over the supplied messages.
 *
 * Returns `{ compacted: false }` (with the original messages) when there is
 * nothing to compact or the configured strategy declines to compact.
 */
export async function compactSessionMessages(input: CompactSessionMessagesInput): Promise<CompactSessionMessagesResult> {
	if (input.messages.length === 0) {
		return { compacted: false, messages: input.messages }
	}

	// Agentario: логируем входные параметры
	Logger.info(`[SdkCompaction] input: messages.length=${input.messages.length}, providerId=${input.config.providerId}, modelId=${input.config.modelId}`)
	Logger.info(`[SdkCompaction] compaction config: enabled=${input.config.compaction?.enabled}, maxInputTokens=${input.config.compaction?.maxInputTokens}, strategy=${input.config.compaction?.strategy}`)

	const modelInfo: SdkModelInfo | undefined = input.config.knownModels?.[input.config.modelId]
	// Agentario: динамический расчёт maxInputTokens
	// Цель: сжать контекст до ~25% от окна модели для адекватной суммаризации
	const contextWindow = modelInfo?.contextWindow ?? FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS
	const maxInputTokens = Math.floor(contextWindow * 0.25)

	Logger.info(`[SdkCompaction] modelInfo: maxInputTokens=${maxInputTokens}, contextWindow=${contextWindow}`)

	const compact = createContextCompactionPrepareTurn(
		{
			providerConfig: input.config.providerConfig,
			providerId: input.config.providerId,
			modelId: input.config.modelId,
			// Force-enable compaction for this manual request even when
			// auto-condense is off — the user explicitly asked for it.
			compaction: {
				...input.config.compaction,
				enabled: true,
			},
			logger: input.config.logger,
			// Forward telemetry + sessionId so manual compactions emit
			// `task.compaction_executed` / `task.compaction_skipped` events,
			// matching the CLI and auto-compaction.
			telemetry: input.config.telemetry,
			sessionId: input.sessionId,
		},
		{ mode: "manual", compactionMode: input.compactionMode, statusCallback: input.statusCallback }, // Agentario: передаём режим и callback
	)
	if (!compact) {
		Logger.warn("[SdkCompaction] Compaction prepareTurn unavailable; skipping manual compaction")
		return { compacted: false, messages: input.messages, reason: "prepareTurn_unavailable" }
	}

	const result = await compact({
		agentId: "cline-vscode",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 0,
		messages: input.messages,
		apiMessages: input.messages,
		abortSignal: new AbortController().signal,
		systemPrompt: "",
		tools: [],
		model: {
			id: input.config.modelId,
			provider: input.config.providerId,
			info: {
				...(modelInfo ?? {}),
				id: modelInfo?.id ?? input.config.modelId,
				maxInputTokens,
			},
		},
	})

	// Agentario: логируем результат для диагностики
	Logger.info(`[SdkCompaction] compact() returned: ${result ? "object" : "null"}, input.messages.length=${input.messages.length}`)
	if (result) {
		Logger.info(`[SdkCompaction] result.messages.length=${result.messages.length}, sameRef=${result.messages === input.messages}, skipReason=${result.skipReason ?? "none"}`)
	}

	if (!result) {
		Logger.warn("[SdkCompaction] compact() returned null/undefined")
		return { compacted: false, messages: input.messages, reason: "compact_returned_null" }
	}
	// Если messages - та же ссылка, считаем что не сжато
	if (result.messages === input.messages) {
		Logger.warn(`[SdkCompaction] compact() returned same reference (${result.messages.length} items)`)
		return { compacted: false, messages: input.messages, reason: result.skipReason ?? "same_reference" }
	}
	Logger.info(`[SdkCompaction] compact() succeeded: ${input.messages.length} -> ${result.messages.length} messages, skipReason=${result.skipReason ?? "none"}`)
	return { compacted: true, messages: result.messages, reason: result.skipReason }
}
