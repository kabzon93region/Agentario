// Replaces classic manual-condense handling from src/core/task (see origin/main)


//


// Coordinates a manual "/compact" (alias "/smol") request triggered from the


// VSCode compact button or slash command. This mirrors the CLI's


// `compactCurrentSession` (apps/cli/src/runtime/interactive/session-runtime.ts):


//


//   1. Read the active session's transcript.


//   2. Run a manual SDK compaction over it (sdk-compaction.ts).


//   3. Restart the session with the compacted messages as initialMessages, so


//      the model's working context is actually reduced (reusing the mode-rebuild


//      replaceActiveSession path, which lazily persists on the next turn).


//


// Before this, the VSCode button sent the literal text "/compact" to the model,


// which the SDK does not treat as a runtime command, so the model improvised a


// fake "Conversation Summary" instead of compacting (CLINE-2503).





import type { Message as SdkMessage } from "@agentario/llms"


import type { AgentarioMessage } from "@shared/ExtensionMessage"


import type { Mode } from "@shared/storage/types"


import { estimateTokens } from "@agentario/shared"


import { createTokenEstimator } from "@agentario/core"


import type { StateManager } from "@/core/storage/StateManager"


import { Logger } from "@/shared/services/Logger"


import { compactSessionMessages } from "./sdk-compaction"


import type { SdkMessageCoordinator } from "./sdk-message-coordinator"


import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"


import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"


import type { SdkSessionHost } from "./session-host"


import type { TaskProxy } from "./task-proxy"


import type { VscodeSessionHost } from "./vscode-session-host"


import { writeFileSync } from "node:fs"


import { join } from "node:path"


import { homedir } from "node:os"


import { saveDisplayMessages, loadDisplayMessages } from "@core/storage/disk"


import type { AgentarioMessage as AgentarioMessageType } from "@shared/ExtensionMessage"





type StartInput = Parameters<VscodeSessionHost["start"]>[0]


type InitialMessages = StartInput["initialMessages"]


type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>





export interface CompactTaskResult {


	compacted: boolean


	reason?: string


	messagesBefore?: number


	messagesAfter?: number


}





export interface SdkCompactionCoordinatorOptions {


	stateManager: StateManager


	sessions: SdkSessionLifecycle


	messages: SdkMessageCoordinator


	sessionConfigBuilder: SdkSessionConfigBuilder


	getTask: () => TaskProxy | undefined


	getWorkspaceRoot: () => Promise<string>


	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput


	resetMessageTranslator: () => void


	postStateToWebview: () => Promise<void>


	/** Создаёт временный sdkHost для чтения истории (dispose вызывается автоматически). */


	createTempHost: () => Promise<{ host: SdkSessionHost; dispose: () => Promise<void> }>


	/** EMA scale: provider tokensIn / char-estimate. Масштабирует chars/3 к реальным токенам провайдера. */


	getProviderScale?: () => number


}





export class SdkCompactionCoordinator {


	private compactInFlight = false


	/** Timestamp of last completed compaction (for dedup and post-compaction result). */


	private lastCompactCompletedAt = 0

	private emitInfoCounter = 0
	private emitInfoStateTimer: ReturnType<typeof setTimeout> | null = null





	constructor(private readonly options: SdkCompactionCoordinatorOptions) {}





	/**


	 * Compact the active session's conversation. Mirrors the CLI's `/compact`


	 * (alias `/smol`) local command. No-ops with a status message when there is


	 * no active session or nothing to compact.


	 *


	 * Supports compacting inactive/history tasks: if no active session exists


	 * but a task is loaded, creates a session on-the-fly, compacts, and saves.


	 *


	 * Agentario: supports two modes:


	 * - "context" (default): summarize context only


	 * - "full": re-summarize entire chat history


	 */


	async compactTask(compactionMode: "context" | "full" = "context"): Promise<CompactTaskResult> {


		if (this.compactInFlight) {


			// Ждём завершения текущей компакции вместо немедленного отклонения.


			// Это решает проблему false positive когда API-клиент вызывает compact


			// пока предыдущий вызов ещё выполняется (LLM суммаризация 30-60с).


			Logger.log("[SdkController] compactTask: compaction in progress, waiting for completion...")


			const start = Date.now()


			while (this.compactInFlight && (Date.now() - start) < 120_000) {


				await new Promise(r => setTimeout(r, 1000))


			}


			if (!this.compactInFlight) {


				// Компакция завершилась пока ждали — возвращаем результат на основе текущего состояния


				Logger.log("[SdkController] compactTask: previous compaction completed while waiting")


				return this.buildPostCompactionResult()


			}


			return { compacted: false, reason: "compaction_already_in_progress" }


		}





		const activeSession = this.options.sessions.getActiveSession()


		const task = this.options.getTask()





		// No active session, but we have a task loaded from history


		if (!activeSession && task?.taskId) {


			Logger.log(`[SdkController] compactTask: No active session, but task ${task.taskId} is loaded вЂ” creating session for compaction`)


			this.compactInFlight = true


			try {


				const result = await this.compactHistoryTask(task.taskId, compactionMode)


				return result


			} catch (error) {


				Logger.error("[SdkController] compactTask (history) failed:", error)


				this.emitInfo(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`)


				await this.options.postStateToWebview()


				return { compacted: false, reason: error instanceof Error ? error.message : String(error) }


			} finally {


				this.compactInFlight = false


				this.lastCompactCompletedAt = Date.now()


			}


		}





		if (!activeSession) {


			Logger.warn("[SdkController] compactTask: No active task to compact")


			this.emitInfo("Нет активной задачи для сжатия.")


			await this.options.postStateToWebview()


			return { compacted: false, reason: "no_active_task" }


		}





		// A turn is still running; compacting mid-turn would race the live agent


		// loop's own message persistence. Ask the user to wait until it finishes.


		if (activeSession.isRunning) {


			this.emitInfo("Cannot compact while a response is in progress. Try again once the current turn finishes.")


			await this.options.postStateToWebview()


			return { compacted: false, reason: "session_busy" }


		}





		this.compactInFlight = true


		try {


			const result = await this.runCompaction(activeSession.sdkHost, activeSession.sessionId, compactionMode)


			return result


		} catch (error) {


			Logger.error("[SdkController] compactTask failed:", error)


			this.emitInfo(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`)


			await this.options.postStateToWebview()


			return { compacted: false, reason: error instanceof Error ? error.message : String(error) }


		} finally {


			this.compactInFlight = false


			this.lastCompactCompletedAt = Date.now()


		}


	}





	private async runCompaction(sdkHost: SdkSessionHost, sessionId: string, compactionMode: "context" | "full" = "context"): Promise<CompactTaskResult> {


		// Agentario: логируем режим суммаризации


		Logger.log(`[SdkCompaction] runCompaction: compactionMode=${compactionMode}, sessionId=${sessionId}`)


		


		// Agentario: для full режима читаем display messages (полная история)


		let messages: SdkMessage[]


		if (compactionMode === "full") {


			const task = this.options.getTask()


			const agentarioMessages = task?.messageStateHandler.getagentarioMessages() ?? []


			Logger.log(`[SdkCompaction] full mode: task=${task ? 'exists' : 'undefined'}, agentarioMessages.length=${agentarioMessages.length}`)


			


			// Логируем типы сообщений


			const typeCounts: Record<string, number> = {}


			for (const m of agentarioMessages) {


				const key = `${m.type}/${m.say || 'none'}`


				typeCounts[key] = (typeCounts[key] || 0) + 1


			}


			Logger.log(`[SdkCompaction] full mode: message types: ${JSON.stringify(typeCounts)}`)


			


			// Конвертируем AgentarioMessage в SDK Message (включаем все значимые типы)


			messages = agentarioMessages


				.filter(m => m.type === "say" && (


					m.say === "task" || m.say === "user_feedback" || m.say === "text" ||


					m.say === "reasoning" || m.say === "command" || m.say === "tool"


				))


				.map(m => ({


					role: (m.say === "task" || m.say === "user_feedback") ? "user" as const : "assistant" as const,


					content: m.text || "",


				})) as SdkMessage[]


			Logger.log(`[SdkCompaction] full mode: converted ${agentarioMessages.length} cline messages to ${messages.length} sdk messages`)





			// Agentario: считаем токены по ВСЕМ display сообщениям (более точно)


			const displayTotalChars = agentarioMessages.reduce((sum, m) => {


				let chars = (m.text || "").length


				if (m.images) chars += m.images.length * 500 // ~500 chars per image


				return sum + chars


			}, 0)


			Logger.log(`[SdkCompaction] full mode: display total chars=${displayTotalChars}, estimated tokens=${Math.ceil(displayTotalChars / 3)}`)


		} else {


			messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]


		}


		


		const messagesBefore = messages.length


		if (messagesBefore === 0) {


			this.emitInfo("No messages to compact.")


			await this.options.postStateToWebview()


			return { compacted: false, reason: "no_messages" }


		}





		const cwd = await this.options.getWorkspaceRoot()


		const mode = this.getCurrentMode()


		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })





		const result = await compactSessionMessages({


			config: {


				providerConfig: config.providerConfig,


				providerId: config.providerId,


				modelId: config.modelId,


				knownModels: config.knownModels,


				compaction: config.compaction,


				logger: config.logger,


				telemetry: config.telemetry,


			},


			sessionId,


			messages,


			compactionMode, // Agentario: передаём режим суммаризации


			statusCallback: (msg) => this.emitInfo(msg), // Agentario: callback для статусов в UI


			providerScale: this.options.getProviderScale?.(), // Agentario: EMA scale для согласования токенов с UI


		})





		if (!result.compacted) {


			// Agentario: prefer SDK-provided reason over catch-all diagnoseCompactionFailure.


			// SDK reason is specific (e.g. "no_foldable_middle", "empty_summary").


			// diagnoseCompactionFailure is a fallback for cases where SDK didn't provide a reason.


			const reason = result.reason || this.diagnoseCompactionFailure((await sdkHost.readMessages(sessionId)) as SdkMessage[])


			this.emitInfo(reason)


			await this.options.postStateToWebview()


			return { compacted: false, reason, messagesBefore }


		}





		// Persist the compacted messages to disk BEFORE restarting the session.


		// This ensures the compacted transcript survives session restarts and


		// is loaded when the task is reopened from history.


		try {


			await sdkHost.writeMessages(sessionId, result.messages as SdkMessage[])


			Logger.log(`[SdkCompaction] Persisted ${result.messages.length} compacted messages to disk for session ${sessionId}`)


		} catch (error) {


			Logger.error("[SdkCompaction] Failed to persist compacted messages to disk:", error)


			// Continue with session restart even if persistence fails


		}





		// Restart the session with the compacted transcript. Reusing the


		// sessionId keeps the task identity (history item, task header) stable;


		// replaceActiveSession waits for the old session's stop before starting


		// the replacement (same sequencing as a mode rebuild).


		config.sessionId = sessionId


		const startInput = this.options.buildStartSessionInput(config, { cwd, mode })


		const rebuildResult = await this.options.sessions.replaceActiveSession({


			startInput,


			initialMessages: result.messages as InitialMessages,


			disposeReason: "compactTask",


		})


		if (!rebuildResult) {


			this.emitInfo("Compaction could not be applied because the session was replaced.")


			await this.options.postStateToWebview()


			return { compacted: false, reason: "session_replaced", messagesBefore, messagesAfter: result.messages.length }


		}





		const { startResult } = rebuildResult


		const task = this.options.getTask()


		if (task && task.taskId !== startResult.sessionId) {


			task.taskId = startResult.sessionId


		}





		// Рассчитываем токены до и после для статистики (единый estimator с кэпами)


		const estimator = createTokenEstimator("compaction")


		const scale = this.options.getProviderScale?.() ?? 1


		const tokensBefore = Math.round(messages.reduce((total, msg) => total + estimator(msg), 0) * scale)





		// Agentario: сохраняем display messages (полная история) ПЕРЕД изменениями


		if (task) {


			const displayMessages = filterCompactionInfoMessages(task.messageStateHandler.getagentarioMessages())


			await saveDisplayMessages(sessionId, displayMessages).catch(err =>


				Logger.error("[SdkCompaction] Failed to save display messages:", err)


			)


			Logger.log(`[SdkCompaction] Saved ${displayMessages.length} display messages to disk`)


		}





		// Convert compacted SDK messages to agentarioMessages for context (model).


		// Display messages remain unchanged вЂ” user sees full history.


		const { sdkMessagesToagentarioMessages } = await import("./message-translator")


		const compactedagentarioMessages: AgentarioMessage[] = sdkMessagesToagentarioMessages(result.messages)


			.filter((m) => !(m.type === "ask" && m.ask === "completion_result"))





		const chatTokens = Math.round(result.messages.reduce((total, msg) => total + estimator(msg), 0) * scale)





		// Agentario: более детальные категории context budget


		const systemPrompt = config.systemPrompt ?? ""


		const systemTokens = estimateTokens(systemPrompt.length)


		const rulesTokens = 3000 // Agentario rules + .clinerules


		const toolsTokens = 3000 // Built-in tools


		const mcpTokens = 1500 // MCP tools (estimate, actual depends on connected servers)


		const skillsTokens = 500 // Skills/rules


		const pinnedTokens = systemTokens + rulesTokens + toolsTokens + mcpTokens + skillsTokens


		const totalTokens = pinnedTokens + chatTokens


		const contextWindow = config.providerConfig?.modelInfo?.contextWindow ?? 65500





		const contextBudget = {


			contextWindow,


			totalEstimated: totalTokens,


			pinnedEstimated: pinnedTokens,


			compressibleEstimated: chatTokens,


			categories: { system: systemTokens, rules: rulesTokens, tools: toolsTokens, chat: chatTokens, mcp: mcpTokens, skills: skillsTokens },


			measuredAt: Date.now(),


		}





		// Agentario: обновляем ТОЛЬКО context messages (для модели), display не трогаем


		if (task) {


			// Обновляем context messages (то что видит модель)


			task.messageStateHandler.replaceContextMessages(compactedagentarioMessages)





			// Добавляем context budget в display для обновления прогресс-бара


			const contextBudgetMsg: AgentarioMessage = {


				ts: Date.now(),


				type: "say",


				say: "api_req_started",


				text: JSON.stringify({ contextBudget, cost: 0, tokensIn: 0, tokensOut: 0 }),


				partial: false,


			}


			task.messageStateHandler.addMessages([contextBudgetMsg])


		}





		// Сохраняем обновлённые display messages на диск (фильтруем info-сообщения)


		if (task) {


			const updatedDisplay = filterCompactionInfoMessages(task.messageStateHandler.getagentarioMessages())


			await saveDisplayMessages(sessionId, updatedDisplay).catch(err =>


				Logger.error("[SdkCompaction] Failed to save updated display messages:", err)


			)


		}





		this.options.resetMessageTranslator()





		// Сохраняем summary в файл


		const summaryPath = this.saveSummaryToFile(result.messages, sessionId)





		this.emitInfo(this.formatCompactionStatus(messagesBefore, result.messages.length, tokensBefore, chatTokens, sessionId, summaryPath))


		await this.options.postStateToWebview()


		this.options.sessions.setRunning(false)


		await this.options.postStateToWebview()


		setTimeout(async () => { await this.options.postStateToWebview() }, 200)





		Logger.log(


			`[SdkController] Compacted session ${sessionId}: ${messagesBefore} -> ${result.messages.length} messages (new session ${startResult.sessionId})`,


		)


		return { compacted: true, messagesBefore, messagesAfter: result.messages.length }


	}





	/**


	 * Compact a task loaded from history without an active session.


	 * Creates a temporary sdkHost, reads messages, compacts, starts a new session


	 * and restores compacted messages back into the UI.


	 */


	private async compactHistoryTask(taskId: string, compactionMode: "context" | "full" = "context"): Promise<CompactTaskResult> {


		const temp = await this.options.createTempHost()


		try {


			const task = this.options.getTask()


			if (!task) {


				this.emitInfo("Нет загруженной задачи.")


				await this.options.postStateToWebview()


				return { compacted: false, reason: "no_task" }


			}





			// Индикация начала компакта


			this.emitInfo(compactionMode === "full" ? "Полная суммаризация чата..." : "Сжатие контекста...")


			await this.options.postStateToWebview()





			// Agentario: для full режима читаем display messages (полная история)


			let messages: SdkMessage[]


			if (compactionMode === "full") {


				const agentarioMessages = task.messageStateHandler.getagentarioMessages() ?? []


				Logger.log(`[SdkCompaction] full mode (history): agentarioMessages.length=${agentarioMessages.length}`)


				


				// Логируем типы сообщений


				const typeCounts: Record<string, number> = {}


				for (const m of agentarioMessages) {


					const key = `${m.type}/${m.say || 'none'}`


					typeCounts[key] = (typeCounts[key] || 0) + 1


				}


				Logger.log(`[SdkCompaction] full mode (history): message types: ${JSON.stringify(typeCounts)}`)


				


				// Конвертируем AgentarioMessage в SDK Message (включаем все значимые типы)


				messages = agentarioMessages


					.filter(m => (


						(m.type === "say" && (


							m.say === "task" || m.say === "user_feedback" || m.say === "text" ||


							m.say === "reasoning" || m.say === "command" || m.say === "tool"


						)) ||


						(m.type === "ask" && m.ask === "followup")


					))


					.map(m => ({


						role: (m.say === "task" || m.say === "user_feedback" || (m.type === "ask" && m.ask === "followup")) ? "user" as const : "assistant" as const,


						content: m.text || "",


					})) as SdkMessage[]


				Logger.log(`[SdkCompaction] full mode (history): converted ${agentarioMessages.length} cline messages to ${messages.length} sdk messages`)





				// Agentario: считаем токены по конвертированным SDK сообщениям (как в суммаризации)


				const convertedTotalChars = messages.reduce((sum, m) => {


					let chars = (m.content || "").length


					return sum + chars


				}, 0)


				Logger.log(`[SdkCompaction] full mode (history): converted messages chars=${convertedTotalChars}, estimated tokens=${Math.ceil(convertedTotalChars / 3)}`)





				// Agentario: сохраняем полный текст чата в отладочный файл


				try {


					const { mkdir, writeFile } = await import("fs/promises")


					const { join } = await import("path")


					const debugDir = "Y:\\Documents\\agentario-compaction-debug"


					await mkdir(debugDir, { recursive: true })


					const timestamp = new Date().toISOString().replace(/[:.]/g, '-')


					const fullChatPath = join(debugDir, `full_chat_${timestamp}.txt`)


					const fullChatContent = messages.map((m, i) => `=== РЎРћРћР‘Р©Р•РќРР• ${i + 1} [${m.role}] ===\n\n${m.content}`).join('\n\n\n')


					await writeFile(fullChatPath, fullChatContent, 'utf-8')


					Logger.log(`[SdkCompaction] full mode (history): saved full chat to ${fullChatPath}`)


				} catch (err) {


					Logger.log(`[SdkCompaction] full mode (history): failed to save full chat: ${err}`)


				}


			} else {


				messages = (await temp.host.readMessages(taskId)) as SdkMessage[]


			}


			


			const messagesBefore = messages.length


			if (messagesBefore === 0) {


				this.emitInfo("Нет сообщений для сжатия.")


				await this.options.postStateToWebview()


				return { compacted: false, reason: "no_messages" }


			}





			const cwd = await this.options.getWorkspaceRoot()


			const mode = this.getCurrentMode()


			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })





			const result = await compactSessionMessages({


				config: {


					providerConfig: config.providerConfig,


					providerId: config.providerId,


					modelId: config.modelId,


					knownModels: config.knownModels,


					compaction: config.compaction,


					logger: config.logger,


					telemetry: config.telemetry,


				},


				sessionId: taskId,


				messages,


				compactionMode, // Agentario: передаём режим суммаризации


				statusCallback: (msg) => this.emitInfo(msg), // Agentario: callback для статусов в UI


			})





			if (!result.compacted) {


				// Agentario: prefer SDK-provided reason over catch-all diagnoseCompactionFailure


				const reason = result.reason || this.diagnoseCompactionFailure(messages)


				this.emitInfo(reason)


				await this.options.postStateToWebview()


				return { compacted: false, reason, messagesBefore }


			}





			// Persist the compacted messages to disk BEFORE starting the new session.


			// This ensures the compacted transcript survives session restarts.


			try {


				await temp.host.writeMessages(taskId, result.messages as SdkMessage[])


				Logger.log(`[SdkCompaction] Persisted ${result.messages.length} compacted messages to disk for history task ${taskId}`)


			} catch (error) {


				Logger.error("[SdkCompaction] Failed to persist compacted messages to disk:", error)


				// Continue with session restart even if persistence fails


			}





			// 1. Стартуем новую сессию с compact'нутыми сообщениями


			config.sessionId = taskId


			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })


			const startResult = await this.options.sessions.startNewSession({


				...startInput,


				initialMessages: result.messages as InitialMessages,


			})


			this.options.sessions.setRunning(false)





			task.taskId = startResult.startResult.sessionId





			// Рассчитываем токены до и после (единый estimator с кэпами)


			const estimator = createTokenEstimator("compaction")


			const histScale = this.options.getProviderScale?.() ?? 1


			const tokensBefore = Math.round(messages.reduce((total, msg) => total + estimator(msg), 0) * histScale)





			// Agentario: сохраняем display messages (полная история) ПЕРЕД изменениями (фильтруем info)


			const displayMessages = filterCompactionInfoMessages(task.messageStateHandler.getagentarioMessages())


			await saveDisplayMessages(taskId, displayMessages).catch(err =>


				Logger.error("[SdkCompaction] Failed to save display messages (history):", err)


			)


			Logger.log(`[SdkCompaction] Saved ${displayMessages.length} display messages to disk (history)`)





			// 2. Конвертируем compact'нутые SDK-сообщения в AgentarioMessage[] для контекста (модель)


			// Display messages remain unchanged вЂ” user sees full history.


			const { sdkMessagesToagentarioMessages } = await import("./message-translator")


			const compactedagentarioMessages: AgentarioMessage[] = sdkMessagesToagentarioMessages(result.messages)


				.filter((m) => !(m.type === "ask" && m.ask === "completion_result"))





			// 3. Рассчитываем новый contextBudget


			const chatTokens = Math.round(result.messages.reduce((total, msg) => total + estimator(msg), 0) * scale)





			// Agentario: более детальные категории context budget


			const systemPrompt = config.systemPrompt ?? ""


			const systemTokens = estimateTokens(systemPrompt.length)


			const rulesTokens = 3000 // Agentario rules + .clinerules


			const toolsTokens = 3000 // Built-in tools


			const mcpTokens = 1500 // MCP tools (estimate)


			const skillsTokens = 500 // Skills/rules


			const pinnedTokens = systemTokens + rulesTokens + toolsTokens + mcpTokens + skillsTokens


			const totalTokens = pinnedTokens + chatTokens


			const contextWindow = config.providerConfig?.modelInfo?.contextWindow ?? 65500





			const contextBudget = {


				contextWindow,


				totalEstimated: totalTokens,


				pinnedEstimated: pinnedTokens,


				compressibleEstimated: chatTokens,


				categories: { system: systemTokens, rules: rulesTokens, tools: toolsTokens, chat: chatTokens, mcp: mcpTokens, skills: skillsTokens },


				measuredAt: Date.now(),


			}





			// Agentario: обновляем ТОЛЬКО context messages (для модели), display не трогаем


			task.messageStateHandler.replaceContextMessages(compactedagentarioMessages)





			// Добавляем context budget в display для обновления прогресс-бара


			const contextBudgetMsg: AgentarioMessage = {


				ts: Date.now(),


				type: "say",


				say: "api_req_started",


				text: JSON.stringify({ contextBudget, cost: 0, tokensIn: 0, tokensOut: 0 }),


				partial: false,


			}


			task.messageStateHandler.addMessages([contextBudgetMsg])





			// Сохраняем обновлённые display messages на диск (фильтруем info)


			const updatedDisplay = filterCompactionInfoMessages(task.messageStateHandler.getagentarioMessages())


			await saveDisplayMessages(taskId, updatedDisplay).catch(err =>


				Logger.error("[SdkCompaction] Failed to save updated display messages (history):", err)


			)





			this.options.resetMessageTranslator()





			// Сохраняем summary в файл


			const summaryPath = this.saveSummaryToFile(result.messages, taskId)





			this.emitInfo(this.formatCompactionStatus(messagesBefore, result.messages.length, tokensBefore, chatTokens, taskId, summaryPath))


			await this.options.postStateToWebview()


			this.options.sessions.setRunning(false)


			await this.options.postStateToWebview()


			setTimeout(async () => { await this.options.postStateToWebview() }, 200)





			Logger.log(


				`[SdkController] Compacted history task ${taskId}: ${messagesBefore} -> ${result.messages.length} messages (session ${startResult.startResult.sessionId})`,


			)


			return { compacted: true, messagesBefore, messagesAfter: result.messages.length }


		} finally {


			await temp.dispose()


		}


	}











	private diagnoseCompactionFailure(messages: SdkMessage[]): string {

		if (messages.length === 0) {

			return "Нет сообщений для сжатия."

		}

		if (messages.length <= 2) {

			return `Слишком мало сообщений (${messages.length}) для сжатия. Нужно минимум 3.`

		}

		// Check if all messages are in the protected tail (last turn)

		// Basic compaction protects the last user message and everything after it

		return "Сообщения уже минимальны или все в текущем диалоге — сжимать нечего. Попробуйте позже, когда будет больше истории."

	}



	private getCurrentMode(): Mode {


		const m = this.options.stateManager.getGlobalSettingsKey("mode")


		return m === "plan" ? m : "act"


	}





	/**


	 * Builds a result for when compaction just completed while we were waiting.


	 * Returns compacted=false with a distinct reason so callers know it was a legitimate skip.


	 */


	private buildPostCompactionResult(): CompactTaskResult {


		return { compacted: false, reason: "compaction_just_completed" }


	}





	private formatCompactionStatus(messagesBefore: number, messagesAfter: number, tokensBefore?: number, tokensAfter?: number, sessionId?: string, summaryPath?: string): string {


		let status = `Сжатие выполнено`


		if (tokensBefore !== undefined && tokensAfter !== undefined) {


			const saved = tokensBefore - tokensAfter


			const percent = tokensBefore > 0 ? Math.round((saved / tokensBefore) * 100) : 0


			status += `: ${messagesBefore}→${messagesAfter} сообщ., ${tokensBefore.toLocaleString()}→${tokensAfter.toLocaleString()} ток. (освобождено ${saved.toLocaleString()}, ${percent}%)`


		} else if (messagesBefore === messagesAfter) {


			status += `: ${messagesAfter} сообщений (контекст сжат)`


		} else {


			status += `: ${messagesBefore}→${messagesAfter} сообщений`


		}


		if (summaryPath) {


			status += `\nФайл: ${summaryPath}`


		}


		if (sessionId) {


			status += `\nСессия: ${sessionId}`


		}


		return status


	}





	private saveSummaryToFile(messages: SdkMessage[], sessionId: string): string | undefined {


		try {


			// Ищем summary-сообщение в результатах сжатия


			const summaryMsg = messages.find((m: any) => m.metadata?.kind === "compaction_summary")


			if (!summaryMsg) {


				// Если нет summary-метаданных, сохраняем весь диалог


				const transcript = messages.map((m: SdkMessage) => {


					const role = m.role ?? "unknown"


					const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content)


					return `[${role}] ${text}`


				}).join("\n\n---\n\n")





				const docsDir = join(homedir(), "Documents")


				const fileName = `compaction_${sessionId}_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`


				const filePath = join(docsDir, fileName)


				writeFileSync(filePath, transcript, "utf-8")


				Logger.log(`[SdkCompaction] Saved transcript to ${filePath}`)


				return filePath


			}





			const summaryText = (summaryMsg as any).metadata?.summary


				?? (typeof summaryMsg.content === "string" ? summaryMsg.content : JSON.stringify(summaryMsg.content))


			const docsDir = join(homedir(), "Documents")


			const fileName = `summary_${sessionId}_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`


			const filePath = join(docsDir, fileName)


			writeFileSync(filePath, summaryText, "utf-8")


			Logger.log(`[SdkCompaction] Saved summary to ${filePath}`)


			return filePath


		} catch (error) {


			Logger.error("[SdkCompaction] Failed to save summary file:", error)


			return undefined


		}


	}





	private emitInfo(text: string): void {
		const sessionId = this.options.sessions.getActiveSession()?.sessionId ?? ""

		// Monotonic ts to avoid message merge collisions
		const ts = Date.now() + (++this.emitInfoCounter)

		const infoMessage: AgentarioMessage = {
			ts,
			type: "say",
			say: "info",
			text,
			partial: false,
		}

		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId, status: "idle" },
		})

		// Push state update immediately to ensure UI renders progress messages
		// The appendAndEmit with type "status" doesn't trigger a state update in the bridge,
		// so we need to push it explicitly. Use immediate push for first message,
		// debounced for subsequent rapid calls to avoid spam.
		if (!this.emitInfoStateTimer) {
			// First message: push immediately
			this.options.postStateToWebview().catch(() => {})
		} else {
			// Subsequent messages: debounce to avoid overwhelming the webview
			clearTimeout(this.emitInfoStateTimer)
		}
		this.emitInfoStateTimer = setTimeout(() => {
			this.emitInfoStateTimer = null
			this.options.postStateToWebview().catch(() => {})
		}, 150)
	}



}





/** Фильтрует compaction-info сообщения из display messages перед сохранением в историю.


 *  Временные сообщения ("auto-compacting", "compacting") НЕ сохраняются.


 *  Статистика (📊) и результат (✅) СОХРАНЯЮТСЯ для истории. */


export function filterCompactionInfoMessages(messages: AgentarioMessage[]): AgentarioMessage[] {


	return messages.filter((m) => {


		if (m.type !== "say" || m.say !== "info") return true


		const text = m.text || ""


		// Сохраняем статистику контекста и результат компакции


		if (text.startsWith("\U0001f4ca") || text.startsWith("\u2705") || text.startsWith("\U0001f504") || text.startsWith("\u274c")) return true


		// Фильтруем временные индикаторы прогресса


		return false


	})


}











