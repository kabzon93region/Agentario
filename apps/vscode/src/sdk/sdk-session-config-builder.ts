import type { CoreSessionConfig } from "@agentario/core"
import { type AgentTool, createTool } from "@agentario/shared"
import type { StateManager } from "@/core/storage/StateManager"
import { buildSessionConfig, type SessionConfigInput } from "./agentario-session-factory"
import { buildAgentHooks, type HookMessageEmitter } from "./hooks-adapter"
import { createAgentModeTools } from "./agent-tools"

/**
 * The full model request captured from the beforeModel hook — this is the
 * exact context (system prompt, messages, tools) that would be sent to the LLM.
 */
export interface CapturedModelContext {
	systemPrompt: string
	// biome-ignore lint/suspicious/noExplicitAny: AgentMessage[] from SDK runtime
	messages: readonly any[]
	// biome-ignore lint/suspicious/noExplicitAny: AgentToolDefinition[] from SDK runtime
	tools: readonly any[]
}

export interface SdkSessionConfigBuilderOptions {
	stateManager: StateManager
	emitHookMessage: HookMessageEmitter
	onSwitchToActMode: () => void
	shouldStopAfterModeSwitch?: () => boolean
	onConsecutiveMistakeLimitReached?: CoreSessionConfig["onConsecutiveMistakeLimitReached"]
	/**
	 * When this returns a non-undefined callback, the NEXT beforeModel invocation
	 * will capture the full model request, invoke the callback with it, and abort
	 * the turn (stop: true) so the model is never called.
	 */
	consumeContextCapture?: () => ((data: CapturedModelContext) => void) | undefined
}

export class SdkSessionConfigBuilder {
	constructor(private readonly options: SdkSessionConfigBuilderOptions) {}

	async build(input: SessionConfigInput): Promise<Awaited<ReturnType<typeof buildSessionConfig>>> {
		const config = await buildSessionConfig(input)

		// Wire statusCallback for auto-compaction progress messages
		if (config.compaction) {
			const emitHook = this.options.emitHookMessage
			config.compaction.statusCallback = (message: string) => {
				emitHook({
					ts: Date.now(),
					type: "say",
					say: "info",
					text: message,
					partial: false,
				})
			}
		}

		if (this.options.onConsecutiveMistakeLimitReached) {
			config.onConsecutiveMistakeLimitReached = this.options.onConsecutiveMistakeLimitReached
		}

		const baseHooks = buildAgentHooks(this.options.stateManager, this.options.emitHookMessage)
		config.hooks = {
			...baseHooks,
			beforeModel: async (ctx) => {
				// Check for context capture FIRST — before any other logic.
				// When capture is requested, grab the full model request and
				// abort the turn so the model is never called.
				const captureHandler = this.options.consumeContextCapture?.()
				if (captureHandler) {
					captureHandler({
						systemPrompt: ctx.request.systemPrompt ?? "",
						messages: ctx.request.messages,
						tools: ctx.request.tools,
					})
					return { stop: true }
				}

				const baseControl = await baseHooks.beforeModel?.(ctx)
				if (this.options.shouldStopAfterModeSwitch?.()) {
					return {
						...baseControl,
						stop: true,
					}
				}
				return baseControl
			},
		}
		if (input.mode === "plan") {
			// Match the CLI interactive runtime: plan-mode sessions expose a
			// switch_to_act_mode tool in addition to the read-only planning tools.
			config.extraTools = [...(config.extraTools ?? []), this.createSwitchToActModeTool()]
		} else if (input.mode === "agent") {
			// Agent mode: remove plan-only switch tool, add agent-specific tools
			config.extraTools = [
				...(config.extraTools?.filter((tool) => tool.name !== "switch_to_act_mode") ?? []),
				...createAgentModeTools(input.cwd),
			]
		} else {
			// The switch tool is plan-only in the CLI and should disappear after
			// rebuilding the session in act mode.
			config.extraTools = config.extraTools?.filter((tool) => tool.name !== "switch_to_act_mode")
		}

		return config
	}

	private createSwitchToActModeTool(): AgentTool {
		return createTool({
			name: "switch_to_act_mode",
			description:
				"Switch from plan mode to act mode. Switching to act mode immediately starts executing the plan, so only call this after the user has explicitly approved the plan in a message sent AFTER you presented it (e.g. 'looks good', 'go ahead', 'switch to act mode'). " +
				"Never call this in the same turn you present a plan, never call it proactively, and never treat the original task request as approval.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			timeoutMs: 5000,
			retryable: false,
			maxRetries: 0,
			// End the run cleanly right after the tool result instead of letting the
			// loop start another iteration that the beforeModel stop hook would abort.
			// An aborted run leaves a dangling api_req_started spinner behind, which the
			// webview renders as "API Request Cancelled".
			lifecycle: {
				completesRun: true,
			},
			execute: async () => {
				const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
				if (currentMode === "act") {
					return "Already in act mode."
				}
				this.options.onSwitchToActMode()
				return "You successfully switched to act mode, proceed with the plan. You now have access to editing files and running commands. (The switch_to_act_mode tool is only available in plan mode.)"
			},
		})
	}
}
