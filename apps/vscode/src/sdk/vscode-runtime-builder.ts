import { createDefaultShellExecutor, createMcpTools } from "@agentario/core"
import { type AgentTool, type AgentToolContext, createTool } from "@agentario/shared"
import type { ITerminalManager } from "@/integrations/terminal/types"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { createVscodeRunCommandsTool } from "./vscode-run-commands-tool"

interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
}

class McpHubToolProvider {
	constructor(private readonly mcpHub: McpHub) {}

	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		const servers = this.mcpHub.getServers()
		const server = servers.find((entry) => entry.name === serverName)
		if (!server) {
			Logger.warn(`[McpHubToolProvider] Server not found: ${serverName}`)
			return []
		}

		return (server.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? undefined,
			inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
				type: "object",
				properties: {},
			},
		}))
	}

	async callTool(request: {
		serverName: string
		toolName: string
		arguments?: Record<string, unknown>
		context?: AgentToolContext
	}): Promise<unknown> {
		const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		return this.mcpHub.callTool(request.serverName, request.toolName, request.arguments ?? {}, ulid)
	}
}

/**
 * Lazily-created shell executor for attempt_completion commands.
 * Re-uses the SDK's built-in shell executor which
 * already handles cross-platform shells, timeout, abort signals, and output truncation.
 */
const getCompletionCommandExecutor = (() => {
	let executor: ReturnType<typeof createDefaultShellExecutor> | undefined
	return () => {
		if (!executor) {
			executor = createDefaultShellExecutor({
				timeoutMs: 15_000, // showcase commands, not long-running builds
				maxOutputBytes: 256_000,
			})
		}
		return executor!
	}
})()

function createAttemptCompletionTool(options: { cwd?: string } = {}): AgentTool {
	return createTool({
		name: "attempt_completion",
		description:
			"Once you've completed the user's task, use this tool to present the result to the user. " +
			"REQUIRED: put the FULL final report in the result string (markdown ok). Never call with empty {} / missing result. " +
			"result must summarize what you actually did or found — NEVER paste the user's request back. " +
			"Do NOT call this after reading only one file when the task asks to review docs/history/rules — explore first. " +
			"Omit command unless you need to run a showcase shell command (do not send null).",
		// Must complete the run: without this the UI shows "Task Completed" while the agent
		// keeps looping (SYSTEM still demands submit_and_exit) and small models re-call this tool.
		lifecycle: {
			completesRun: true,
		},
		retryable: false,
		maxRetries: 0,
		inputSchema: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: "A clear, brief summary of the final result of the task.",
				},
				command: {
					type: "string",
					description:
						"An optional terminal command to showcase the result (e.g. open a dev server). " +
						"Do not use commands like echo or cat that merely print text.",
				},
			},
			// result is validated in execute (clearer error than JSON Schema for empty {}).
		},
		execute: async (input: unknown, context: AgentToolContext) => {
			const parsedInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
			const resultText = typeof parsedInput.result === "string" ? parsedInput.result.trim() : ""
			const command = typeof parsedInput.command === "string" ? parsedInput.command.trim() : undefined

			if (resultText.length < 20) {
				throw new Error(
					"attempt_completion requires a non-empty result (full report in the result field). " +
						"Do not call with {}. Put the analysis text into result, then retry.",
				)
			}

			if (!command) {
				return resultText
			}

			// Execute the command and include its output in the result
			const cwd = options.cwd || process.cwd()
			Logger.log(`[attempt_completion] Executing command: ${command} (cwd: ${cwd})`)

			try {
				const shellExecutor = getCompletionCommandExecutor()
				const commandOutput = await shellExecutor(command, cwd, context)
				const trimmedOutput = commandOutput.trim()

				if (trimmedOutput) {
					return `${resultText}\n\n[Command: ${command}]\n${trimmedOutput}`
				}
				return `${resultText}\n\n[Command executed: ${command}]`
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				Logger.warn(`[attempt_completion] Command failed: ${errorMsg}`)
				return `${resultText}\n\n[Command failed: ${command}]\n${errorMsg}`
			}
		},
	})
}

export interface VscodeExtraToolsOptions {
	cwd?: string
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the custom `run_commands` tool replaces the SDK's
	 * built-in version with foreground/background terminal support.
	 */
	getTerminalManager?: () => ITerminalManager
}

export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
	const provider = new McpHubToolProvider(mcpHub)
	const mcpTools = await Promise.all(
		mcpHub.getServers().map(async (server) => {
			try {
				return await createMcpTools({
					serverName: server.name,
					provider,
				})
			} catch (error) {
				Logger.warn(
					`[VscodeRuntimeTools] Failed to load tools from MCP server "${server.name}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
				return []
			}
		}),
	)

	const tools: AgentTool[] = [createAttemptCompletionTool({ cwd: options?.cwd }), ...mcpTools.flat()]

	// Add the custom run_commands tool when a terminal manager is available.
	// This replaces the SDK's built-in run_commands, which is suppressed via
	// tool executor capabilities in VscodeSessionHost.
	if (options?.getTerminalManager) {
		tools.push(
			createVscodeRunCommandsTool({
				cwd: options.cwd ?? process.cwd(),
				getTerminalManager: options.getTerminalManager,
			}),
		)
		Logger.log("[VscodeRuntimeTools] Added custom run_commands tool (foreground/background terminal)")
	}

	// Add semantic_search tool if index exists for workspace
	if (options?.cwd) {
		try {
			const { createSemanticSearchExecutor } = await import("./semantic-search-executor")
			const { createSemanticSearchTool } = await import("./semantic-search-tool")
			const executor = await createSemanticSearchExecutor({ workspacePath: options.cwd })
			if (executor) {
				tools.push(createSemanticSearchTool(executor))
				Logger.log("[VscodeRuntimeTools] Added semantic_search tool")
			}
		} catch (error) {
			Logger.warn(
				`[VscodeRuntimeTools] Failed to create semantic_search tool: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	Logger.log(`[VscodeRuntimeTools] Prepared ${tools.length} VSCode extra tools`)
	return tools
}
