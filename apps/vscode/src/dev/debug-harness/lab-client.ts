/**
 * Agentario Lab — TypeScript HTTP Client
 *
 * Programmatic client for the debug harness `lab.*` API.
 * Can be imported from test scripts or used as a CLI.
 *
 * Usage (import):
 *   import { LabClient } from "./lab-client"
 *   const lab = new LabClient()
 *   await lab.launch({ workspace: "/path/to/fixture" })
 *   await lab.newTask("Hello, analyze this project")
 *   const result = await lab.waitIdle()
 *
 * Usage (CLI):
 *   bun apps/vscode/src/dev/debug-harness/lab-client.ts status
 *   bun apps/vscode/src/dev/debug-harness/lab-client.ts new-task "Hello"
 *   bun apps/vscode/src/dev/debug-harness/lab-client.ts wait-idle --timeout 600000
 */

const DEFAULT_PORT = 19229

export interface LabClientOptions {
	port?: number
	host?: string
}

export class LabClient {
	private baseUrl: string

	constructor(opts: LabClientOptions = {}) {
		const port = opts.port ?? DEFAULT_PORT
		const host = opts.host ?? "localhost"
		this.baseUrl = `http://${host}:${port}/api`
	}

	private async call(method: string, params: Record<string, any> = {}): Promise<any> {
		const resp = await fetch(this.baseUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method, params }),
		})
		if (!resp.ok) {
			const text = await resp.text()
			throw new Error(`Harness error ${resp.status}: ${text}`)
		}
		return resp.json()
	}

	// ── Lifecycle ──

	async launch(opts: { workspace?: string; vsix?: string; skipBuild?: boolean } = {}): Promise<any> {
		return this.call("launch", opts)
	}

	async shutdown(): Promise<any> {
		return this.call("shutdown")
	}

	async status(): Promise<any> {
		return this.call("status")
	}

	// ── Lab API ──

	async labStatus(): Promise<{
		vscodeRunning: boolean
		clineDir: string
		taskCount?: number
		idle?: boolean
		lastMessagePreview?: string
		vsixMode: boolean
	}> {
		return this.call("lab.status")
	}

	async newTask(text: string): Promise<any> {
		return this.call("lab.new_task", { text })
	}

	async followup(text: string): Promise<any> {
		return this.call("lab.followup", { text })
	}

	async waitIdle(opts: { timeout?: number; pollMs?: number } = {}): Promise<{
		status: "idle" | "timeout"
		elapsed: number
		messageCount?: number
		lastMessagePreview?: string
	}> {
		return this.call("lab.wait_idle", opts)
	}

	async getMessages(opts: { count?: number } = {}): Promise<{
		taskDir?: string
		total: number
		shown: number
		messages: Array<{
			role: string
			say?: string
			text: string
			partial?: boolean
			ts?: number
		}>
	}> {
		return this.call("lab.get_messages", opts)
	}

	async exportChat(opts: { outPath?: string } = {}): Promise<{
		path: string
		taskDir: string
		messageCount: number
	}> {
		return this.call("lab.export_chat", opts)
	}

	async screenshot(): Promise<{ path: string; counter: number }> {
		return this.call("lab.screenshot")
	}

	async exportContext(opts: { outPath?: string } = {}): Promise<any> {
		return this.call("lab.export_context", opts)
	}

	async collectSessionFiles(opts: { outDir?: string } = {}): Promise<any> {
		return this.call("lab.collect_session_files", opts)
	}

	async run(params: { text: string; workspace?: string; timeout?: number; outDir?: string }): Promise<{
		status: string
		steps?: Array<{ step: string; status: string; detail?: any }>
		outDir?: string
		taskId?: string
		error?: string
	}> {
		return this.call("lab.run", params)
	}

	// ── UI helpers ──

	async openSidebar(): Promise<any> {
		return this.call("ui.open_sidebar")
	}

	async sendMessage(text: string): Promise<any> {
		return this.call("ui.send_message", { text })
	}

	async commandPalette(command: string): Promise<any> {
		return this.call("ui.command_palette", { command })
	}
}

// ── CLI mode ──
async function main() {
	const args = process.argv.slice(2)
	const cmd = args[0]
	if (!cmd || cmd === "--help" || cmd === "-h") {
		console.log(`Agentario Lab Client

Usage: bun lab-client.ts <command> [args...]

Commands:
  status                              Show lab status
  launch [--workspace PATH] [--vsix PATH]  Launch VS Code
  new-task "text"                     Create a new task
  followup "text"                     Send followup
  wait-idle [--timeout MS]            Wait for agent idle
  get-messages [--count N]            Get recent messages
  export [outPath]                    Export chat to markdown (full)
  export-context [outPath]            Export model context
  collect [outDir]                    Collect session files
  run --text "..." [--workspace] [--timeout] [--outDir]  Full cycle
  screenshot                          Take screenshot
  shutdown                            Stop harness
`)
		process.exit(0)
	}

	const portIdx = args.indexOf("--port")
	const port = portIdx >= 0 ? Number(args[portIdx + 1]) : DEFAULT_PORT
	const lab = new LabClient({ port })

	function getArg(name: string): string | undefined {
		const idx = args.indexOf(name)
		return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
	}

	try {
		let result: any
		switch (cmd) {
			case "status":
				result = await lab.labStatus()
				break
			case "launch":
				result = await lab.launch({
					workspace: getArg("--workspace"),
					vsix: getArg("--vsix"),
					skipBuild: args.includes("--skip-build"),
				})
				break
			case "new-task":
				if (!args[1]) throw new Error("Usage: new-task 'text'")
				result = await lab.newTask(args[1])
				break
			case "followup":
				if (!args[1]) throw new Error("Usage: followup 'text'")
				result = await lab.followup(args[1])
				break
			case "wait-idle":
				result = await lab.waitIdle({
					timeout: getArg("--timeout") ? Number(getArg("--timeout")) : undefined,
				})
				break
			case "get-messages":
				result = await lab.getMessages({
					count: getArg("--count") ? Number(getArg("--count")) : undefined,
				})
				break
			case "export":
				result = await lab.exportChat({ outPath: args[1] })
				break
			case "export-context":
				result = await lab.exportContext({ outPath: args[1] })
				break
			case "collect":
				result = await lab.collectSessionFiles({ outDir: args[1] })
				break
			case "run":
				result = await lab.run({
					text: getArg("--text") || "",
					workspace: getArg("--workspace"),
					timeout: getArg("--timeout") ? Number(getArg("--timeout")) : undefined,
					outDir: getArg("--outDir"),
				})
				break
			case "screenshot":
				result = await lab.screenshot()
				break
			case "shutdown":
				result = await lab.shutdown()
				break
			default:
				console.error(`Unknown command: ${cmd}`)
				process.exit(1)
		}
		console.log(JSON.stringify(result, null, 2))
	} catch (e: any) {
		console.error(`Error: ${e.message}`)
		process.exit(1)
	}
}

// Run CLI if invoked directly
if (import.meta.main || process.argv[1]?.endsWith("lab-client.ts")) {
	main()
}
