import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { estimateTokens } from "@agentario/shared"
import { formatMessageStatsLine } from "../shared/message-display"

const VERSION = "0.14.88"

export interface ApiServerOptions {
	port: number
	controller: any
	clineDir?: string
	vscode?: any // vscode module for restart
}

export function startAgentarioApiServer(opts: ApiServerOptions): http.Server {
	const { port, controller, clineDir, vscode } = opts

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || "/", `http://localhost:${port}`)
		const pathname = url.pathname

		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		try {
			const result = await handleRequest(pathname, req, res, url, controller, clineDir, vscode)
			if (result !== undefined) {
				sendJson(res, 200, result)
			}
		} catch (err: any) {
			sendJson(res, 500, { error: err.message || String(err) })
		}
	})

	server.listen(port, "127.0.0.1", () => {
		console.log(`[Agentario API] Listening on http://127.0.0.1:${port}`)
	})

	return server
}

// РІвЂќР‚РІвЂќР‚ Helper: get AgentarioMessage[] from the active controller task РІвЂќР‚РІвЂќР‚
function getAgentarioMessages(controller: any): any[] {
	try {
		const task = controller.task
		if (!task?.messageStateHandler?.getagentarioMessages) return []
		return task.messageStateHandler.getagentarioMessages() || []
	} catch {
		return []
	}
}

// РІвЂќР‚РІвЂќР‚ Helper: get active session РІвЂќР‚РІвЂќР‚
function getActiveSession(controller: any): any {
	try {
		return controller.sessions?.getActiveSession?.() ?? null
	} catch {
		return null
	}
}

function candidateProfileRoots(clineDir?: string): string[] {
	const roots: string[] = []
	const push = (p?: string | null) => {
		if (!p) return
		const n = path.resolve(p)
		if (!roots.includes(n)) roots.push(n)
	}
	push(clineDir)
	push(path.join(os.homedir(), ".agentario"))
	push(path.join(os.homedir(), ".agentario-lab"))
	push(path.join(os.homedir(), ".cline"))
	return roots
}

function findSessionMessagesFile(sessionId: string, clineDir?: string): string | null {
	if (!sessionId) return null
	for (const root of candidateProfileRoots(clineDir)) {
		const candidates = [
			path.join(root, "data", "sessions", sessionId, `${sessionId}.messages.json`),
			path.join(root, "data", "sessions", sessionId, "api_conversation_history.json"),
			path.join(root, "data", "tasks", sessionId, "api_conversation_history.json"),
			path.join(root, "data", "tasks", sessionId, "ui_messages.json"),
		]
		for (const file of candidates) {
			if (fs.existsSync(file)) return file
		}
	}
	return null
}

function loadSessionContext(controller: any, clineDir?: string): any | null {
	const taskId = controller.task?.taskId || getActiveSession(controller)?.sessionId
	if (!taskId) return null
	const file = findSessionMessagesFile(taskId, clineDir)
	if (!file) return null
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"))
		const messages = Array.isArray(raw) ? raw : raw.messages || raw
		return { source: "session_file", path: file, sessionId: taskId, messages }
	} catch {
		return null
	}
}

function findExtensionLogFile(clineDir?: string): { path: string; exists: boolean } {
	const today = new Date()
	const y = today.getFullYear()
	const m = String(today.getMonth() + 1).padStart(2, "0")
	const d = String(today.getDate()).padStart(2, "0")
	const name = `agentario-${y}-${m}-${d}.log`
	for (const root of candidateProfileRoots(clineDir)) {
		const file = path.join(root, "data", "logs", "extension", name)
		if (fs.existsSync(file)) return { path: file, exists: true }
	}
	const fallback = path.join(candidateProfileRoots(clineDir)[0] || path.join(os.homedir(), ".agentario"), "data", "logs", "extension", name)
	return { path: fallback, exists: false }
}

function analyzeChatOutcome(controller: any) {
	const msgs = getAgentarioMessages(controller)
	const phase = getTurnPhase(controller)
	const hasApiFail = msgs.some((m: any) => m.ask === "api_req_failed")
	const hasMistakeLimit = msgs.some((m: any) => m.ask === "mistake_limit_reached")
	const hasCompletion = msgs.some(
		(m: any) => m.say === "completion_result" || m.ask === "completion_result" || m.ask === "resume_completed_task",
	)
	const hasAssistantText = msgs.some(
		(m: any) => m.type === "say" && (m.say === "text" || m.say === "completion_result") && (m.text || "").trim().length > 40,
	)
	let verdict: "ok" | "idle_with_error" | "incomplete" | "running" = "incomplete"
	if (isAgentBusy(controller)) verdict = "running"
	else if (phase === "completed" || hasCompletion) verdict = "ok"
	else if (phase === "error" || hasApiFail || hasMistakeLimit) {
		verdict = hasAssistantText ? "idle_with_error" : "idle_with_error"
	} else if (phase === "awaiting_followup" && hasAssistantText) verdict = "ok"
	else if (!isAgentBusy(controller) && hasAssistantText) verdict = "ok"
	return { verdict, phase, hasApiFail, hasMistakeLimit, hasCompletion, hasAssistantText }
}



// --- Task running / idle helpers (mirrors webview isAgentTaskRunning) ---
function getTurnPhase(controller: any): string {
	try {
		return controller.turnStateTracker?.currentPhase || "idle"
	} catch {
		return "idle"
	}
}

function isSessionRunning(controller: any): boolean {
	try {
		return !!controller.sessions?.getActiveSession?.()?.isRunning
	} catch {
		return false
	}
}

function isAgentBusy(controller: any): boolean {
	const phase = getTurnPhase(controller)
	if (phase === "streaming" || phase === "awaiting_approval") return true
	if (isSessionRunning(controller)) return true
	const msgs = getAgentarioMessages(controller)
	if (msgs.some((m: any) => m.partial === true)) return true
	return false
}

function getStatusSnapshot(controller: any) {
	const task = controller.task
	const taskId = task?.taskId ?? null
	const msgs = getAgentarioMessages(controller)
	const messageCount = msgs.length
	const phase = getTurnPhase(controller)
	const sessionRunning = isSessionRunning(controller)
	const busy = isAgentBusy(controller)
	let lastMessagePreview = ""
	if (messageCount > 0) {
		const lastMsg = msgs[messageCount - 1]
		lastMessagePreview = (lastMsg?.text || "").substring(0, 200)
	}
	const outcome = (() => {
		const hasApiFail = msgs.some((m: any) => m.ask === "api_req_failed")
		const hasMistakeLimit = msgs.some((m: any) => m.ask === "mistake_limit_reached")
		const hasCompletion = msgs.some(
			(m: any) => m.say === "completion_result" || m.ask === "completion_result" || m.ask === "resume_completed_task",
		)
		const hasAssistantText = msgs.some(
			(m: any) => m.type === "say" && (m.say === "text" || m.say === "completion_result") && (m.text || "").trim().length > 40,
		)
		let verdict: string = "incomplete"
		if (busy) verdict = "running"
		else if (phase === "completed" || hasCompletion) verdict = "ok"
		else if (phase === "error" || hasApiFail || hasMistakeLimit) verdict = "idle_with_error"
		else if ((phase === "awaiting_followup" || phase === "idle" || phase === "resumable") && hasAssistantText) verdict = "ok"
		return { verdict, hasApiFail, hasMistakeLimit, hasCompletion, hasAssistantText }
	})()
	return {
		taskId,
		idle: !busy,
		busy,
		phase,
		sessionRunning,
		messageCount,
		lastMessagePreview,
		verdict: outcome.verdict,
		hasApiFail: outcome.hasApiFail,
		hasMistakeLimit: outcome.hasMistakeLimit,
		hasCompletion: outcome.hasCompletion,
		hasAssistantText: outcome.hasAssistantText,
	}
}

async function waitUntilStopped(controller: any, timeoutMs = 60000, pollMs = 500): Promise<{ stopped: boolean; elapsed: number; status: any }> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const status = getStatusSnapshot(controller)
		if (!status.busy) {
			return { stopped: true, elapsed: Date.now() - start, status }
		}
		await sleep(pollMs)
	}
	return { stopped: false, elapsed: Date.now() - start, status: getStatusSnapshot(controller) }
}

/** Stop button equivalent: cancelTask + wait until model is not generating. */
async function stopAgent(controller: any, timeoutMs = 60000) {
	const before = getStatusSnapshot(controller)
	if (before.busy || before.taskId) {
		await controller.cancelTask()
	}
	const wait = await waitUntilStopped(controller, timeoutMs)
	return { ok: wait.stopped, before, ...wait }
}

/** Close chat (home page): clearTask after stop. */
async function closeChat(controller: any) {
	const stop = await stopAgent(controller)
	const taskId = controller.task?.taskId ?? null
	await controller.clearTask()
	await sleep(300)
	return { ok: true, stopped: stop.ok, clearedTaskId: taskId, status: getStatusSnapshot(controller) }
}

/** Delete chat silently (no VS Code modal): stop → clear if active → deleteFromState. */
async function deleteChat(controller: any, taskId?: string | null) {
	const id = taskId || controller.task?.taskId || null
	if (!id) {
		await controller.clearTask?.()
		return { ok: true, deleted: false, reason: "no_task", status: getStatusSnapshot(controller) }
	}
	const stop = await stopAgent(controller)
	if (controller.task?.taskId === id) {
		await controller.clearTask()
		await sleep(300)
	}
	await controller.deleteTaskFromState(id)
	await controller.postStateToWebview?.()
	await sleep(300)
	return { ok: true, deleted: true, taskId: id, stopped: stop.ok, status: getStatusSnapshot(controller) }
}


async function handleRequest(
	pathname: string,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	url: URL,
	controller: any,
	clineDir?: string,
	vscode?: any,
): Promise<any> {
	if (pathname === "/health" && req.method === "GET") {
		return { status: "ok", version: VERSION, port: parseInt(url.port || "19231") }
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/status РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/status" && req.method === "GET") {
		return getStatusSnapshot(controller)
	}

	// РІвЂќР‚РІвЂќР‚ POST /api/new_task РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/new_task" && req.method === "POST") {
		const body = await readBody(req)
		const parsed = JSON.parse(body)
		const { text, images, files } = parsed
		// fresh=true (default): stop → delete current chat → home → then new task
		const fresh = parsed.fresh !== false
		if (!text) throw new Error("text is required")
		let deletedTaskId: string | null = null
		if (fresh) {
			const existingId = controller.task?.taskId ?? null
			if (existingId || isAgentBusy(controller)) {
				const del = await deleteChat(controller, existingId)
				deletedTaskId = del.taskId ?? existingId
				if (getStatusSnapshot(controller).taskId) {
					await controller.clearTask()
					await sleep(300)
				}
			}
			// Ensure we are on the home page (no active task) before starting
			if (controller.task?.taskId) {
				await controller.clearTask()
				await sleep(300)
			}
		}
		const sessionId = await controller.initTask(text, images, files)
		return { ok: true, sessionId, deletedTaskId, fresh, status: getStatusSnapshot(controller) }
	}

	// РІвЂќР‚РІвЂќР‚ POST /api/followup РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/followup" && req.method === "POST") {
		const body = await readBody(req)
		const { text, images, files } = JSON.parse(body)
		if (!text) throw new Error("text is required")
		await controller.askResponse(text, images, files)
		return { ok: true }
	}

	// РІвЂќР‚РІвЂќР‚ POST /api/cancel РІвЂќР‚РІвЂќР‚
	// POST /api/stop вЂ” same as UI Stop button, then wait until generation stopped
	if ((pathname === "/api/stop" || pathname === "/api/cancel") && req.method === "POST") {
		const bodyRaw = await readBody(req)
		let timeoutMs = 60000
		try {
			if (bodyRaw.trim()) {
				const b = JSON.parse(bodyRaw)
				if (b.timeout) timeoutMs = parseInt(b.timeout)
			}
		} catch {}
		const result = await stopAgent(controller, timeoutMs)
		return result
	}

	// POST /api/clear вЂ” close current chat and return to home (chat list)
	if (pathname === "/api/clear" && req.method === "POST") {
		return await closeChat(controller)
	}

	// POST /api/delete_task вЂ” stop + delete chat (no confirmation modal)
	if (pathname === "/api/delete_task" && req.method === "POST") {
		const bodyRaw = await readBody(req)
		let taskId: string | null = null
		try {
			if (bodyRaw.trim()) {
				const b = JSON.parse(bodyRaw)
				taskId = b.taskId || null
			}
		} catch {}
		return await deleteChat(controller, taskId)
	}

	// ═══════ GET /api/messages ═══════
	if (pathname === "/api/messages" && req.method === "GET") {
		const limit = parseInt(url.searchParams.get("limit") || "50")
		const msgs = getAgentarioMessages(controller)
		const recent = msgs.slice(-limit)
		return {
			messages: recent.map((m: any) => {
				const msg: any = {
					role: m.type === "ask" ? "user" : "assistant",
					text: m.text || "",
					ts: m.ts,
					partial: m.partial || false,
					say: m.say,
					ask: m.ask,
				}
				// Include metrics if available (from SDK session messages)
				if (m.metrics) {
					msg.metrics = {
						inputTokens: m.metrics.inputTokens,
						outputTokens: m.metrics.outputTokens,
						cacheReadTokens: m.metrics.cacheReadTokens,
						cacheWriteTokens: m.metrics.cacheWriteTokens,
					}
				}
				return msg
			}),
		}
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/context РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/context" && req.method === "GET") {
		const snap = getStatusSnapshot(controller)
		// Prefer durable session files (works while busy / after error)
		const fromFile = loadSessionContext(controller, clineDir)
		if (fromFile) {
			return { ...fromFile, busy: snap.busy, phase: snap.phase }
		}
		if (snap.busy) {
			return { busy: true, source: "deferred", phase: snap.phase, taskId: snap.taskId, error: "busy" }
		}
		try {
			const ctx = await controller.captureModelContext()
			if (ctx) return { source: "captureModelContext", ...ctx }
		} catch {}
		return { error: "no_context", busy: snap.busy, phase: snap.phase, taskId: snap.taskId }
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/export_chat РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/export_chat" && req.method === "GET") {
		const outPath = url.searchParams.get("outPath") || path.join(os.tmpdir(), "agentario-export.md")
		const msgs = getAgentarioMessages(controller)
		if (msgs.length === 0) throw new Error("No messages found")
		const compact = url.searchParams.get("compact") === "1"
		const md = exportMessagesToMarkdown(msgs, { compact })
		fs.mkdirSync(path.dirname(outPath), { recursive: true })
		fs.writeFileSync(outPath, md, "utf-8")
		return { path: outPath, messageCount: msgs.length, compact }
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/wait_idle РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/wait_idle" && req.method === "GET") {
		const timeout = parseInt(url.searchParams.get("timeout") || "600000")
		const pollMs = parseInt(url.searchParams.get("pollMs") || "3000")
		const start = Date.now()
		while (Date.now() - start < timeout) {
			const snap = getStatusSnapshot(controller)
			if (snap.idle && snap.messageCount >= 2 && snap.phase !== "streaming" && snap.phase !== "awaiting_approval") {
				await sleep(Math.min(2000, pollMs))
				const snap2 = getStatusSnapshot(controller)
				if (snap2.idle && snap2.messageCount === snap.messageCount) {
					const status = snap2.verdict === "idle_with_error" ? "idle_with_error" : snap2.verdict === "ok" ? "idle" : "idle"
					return {
						status,
						verdict: snap2.verdict,
						elapsed: Date.now() - start,
						messageCount: snap2.messageCount,
						phase: snap2.phase,
						taskId: snap2.taskId,
						hasApiFail: snap2.hasApiFail,
						hasMistakeLimit: snap2.hasMistakeLimit,
						hasCompletion: snap2.hasCompletion,
						lastMessagePreview: snap2.lastMessagePreview,
					}
				}
			}
			await sleep(pollMs)
		}
		const finalSnap = getStatusSnapshot(controller)
		return { status: "timeout", elapsed: Date.now() - start, ...finalSnap }
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/logs РІР‚вЂќ read extension log file РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/logs" && req.method === "GET") {
		const linesParam = parseInt(url.searchParams.get("lines") || "200")
		const found = findExtensionLogFile(clineDir)
		if (!found.exists) {
			return { path: found.path, lineCount: 0, lines: [], exists: false, searchedRoots: candidateProfileRoots(clineDir) }
		}
		const content = fs.readFileSync(found.path, "utf-8")
		const allLines = content.split("\n").filter((l: string) => l.length > 0)
		const tail = allLines.slice(-linesParam)
		return { path: found.path, lineCount: allLines.length, lines: tail, exists: true }
	}

	// РІвЂќР‚РІвЂќР‚ GET /api/compaction_files РІР‚вЂќ list/read compaction debug files РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/compaction_files" && req.method === "GET") {
		const phaseFilter = url.searchParams.get("phase") // "map" | "single" | null
		const chunkFilter = url.searchParams.get("chunk") // chunk index | null
		const shouldRead = url.searchParams.get("read") === "true"
		const compactionDir = path.join(os.homedir(), "Documents", "agentario-compaction-debug")
		if (!fs.existsSync(compactionDir)) {
			return { dir: compactionDir, files: [] }
		}
		let files = fs.readdirSync(compactionDir).filter((f) => !f.startsWith("."))
		// Filter by today's files only
		const today = new Date().toISOString().split("T")[0]
		files = files.filter((f) => f.includes(today))
		// Filter by phase
		if (phaseFilter) {
			files = files.filter((f) => f.includes(`_${phaseFilter}_`) || f.startsWith(`${phaseFilter}_`))
		}
		// Filter by chunk
		if (chunkFilter) {
			files = files.filter((f) => f.includes(`_chunk${chunkFilter}_`))
		}
		const result = files.map((f) => {
			const fullPath = path.join(compactionDir, f)
			const stat = fs.statSync(fullPath)
			const entry: any = { name: f, size: stat.size, mtime: stat.mtimeMs }
			if (shouldRead) {
				try {
					entry.content = fs.readFileSync(fullPath, "utf-8").substring(0, 50000)
				} catch {}
			}
			return entry
		})
		return { dir: compactionDir, files: result }
	}

	// ═══════ GET /api/collect — collect session files to export directory ═══════
	if (pathname === "/api/collect" && req.method === "GET") {
		const outDirParam = url.searchParams.get("outDir")
		const timestamp = Date.now()
		const outDir = outDirParam || path.join(process.cwd(), "Exports", `collect-${timestamp}`)
		fs.mkdirSync(outDir, { recursive: true })
		const collected: string[] = []
		const task = controller.task
		const taskId = task?.taskId ?? null
		const compact = url.searchParams.get("compact") === "1"

		const msgs = getAgentarioMessages(controller)
		if (msgs.length > 0) {
			const mdPath = path.join(outDir, "chat-export.md")
			fs.writeFileSync(mdPath, exportMessagesToMarkdown(msgs, { compact }), "utf-8")
			collected.push(mdPath)
			const jsonPath = path.join(outDir, "ui_messages.json")
			fs.writeFileSync(jsonPath, JSON.stringify(msgs, null, 2), "utf-8")
			collected.push(jsonPath)
		}

		const fromFile = loadSessionContext(controller, clineDir)
		if (fromFile) {
			const sessPath = path.join(outDir, "session-messages.json")
			fs.writeFileSync(sessPath, JSON.stringify(fromFile, null, 2), "utf-8")
			collected.push(sessPath)
			try {
				const srcDir = path.dirname(fromFile.path)
				const destDir = path.join(outDir, "session")
				fs.mkdirSync(destDir, { recursive: true })
				for (const name of fs.readdirSync(srcDir)) {
					const src = path.join(srcDir, name)
					if (fs.statSync(src).isFile()) {
						const dest = path.join(destDir, name)
						fs.copyFileSync(src, dest)
						collected.push(dest)
					}
				}
			} catch {}
		}

		if (!isAgentBusy(controller)) {
			try {
				const ctx = await controller.captureModelContext()
				if (ctx) {
					const ctxPath = path.join(outDir, "api_context.json")
					fs.writeFileSync(ctxPath, JSON.stringify(ctx, null, 2), "utf-8")
					collected.push(ctxPath)
				}
			} catch {}
		}

		const logFound = findExtensionLogFile(clineDir)
		if (logFound.exists) {
			const dest = path.join(outDir, "extension.log")
			fs.copyFileSync(logFound.path, dest)
			collected.push(dest)
		}

		const today = new Date().toISOString().split("T")[0]
		const compactionDir = path.join(os.homedir(), "Documents", "agentario-compaction-debug")
		if (fs.existsSync(compactionDir)) {
			const compOutDir = path.join(outDir, "compaction")
			fs.mkdirSync(compOutDir, { recursive: true })
			for (const file of fs.readdirSync(compactionDir).filter((f) => f.includes(today))) {
				const src = path.join(compactionDir, file)
				try {
					if (fs.statSync(src).isFile()) {
						const dest = path.join(compOutDir, file)
						fs.copyFileSync(src, dest)
						collected.push(dest)
					}
				} catch {}
			}
		}

		const outcome = analyzeChatOutcome(controller)
		fs.writeFileSync(path.join(outDir, "outcome.json"), JSON.stringify({ ...outcome, ...getStatusSnapshot(controller) }, null, 2), "utf-8")
		collected.push(path.join(outDir, "outcome.json"))

		return { outDir, taskId, files: collected, verdict: outcome.verdict }
	}

	// ═══════ GET /api/save_run — full run save with quality analysis ═══════
	if (pathname === "/api/save_run" && req.method === "GET") {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
		const outDir = path.join(process.cwd(), "Exports", `lab-run-${timestamp}`)
		fs.mkdirSync(outDir, { recursive: true })
		const collected: string[] = []

		// 1. Export chat markdown
		const msgs = getAgentarioMessages(controller)
		if (msgs.length > 0) {
			const mdPath = path.join(outDir, "chat-export.md")
			fs.writeFileSync(mdPath, exportMessagesToMarkdown(msgs), "utf-8")
			collected.push(mdPath)
		}

		// 2. Save UI messages
		if (msgs.length > 0) {
			const jsonPath = path.join(outDir, "ui_messages.json")
			fs.writeFileSync(jsonPath, JSON.stringify(msgs, null, 2), "utf-8")
			collected.push(jsonPath)
		}

		// 3. Copy session files (session.json, messages.json)
		const fromFile = loadSessionContext(controller, clineDir)
		if (fromFile) {
			try {
				const srcDir = path.dirname(fromFile.path)
				const destDir = path.join(outDir, "session")
				fs.mkdirSync(destDir, { recursive: true })
				for (const name of fs.readdirSync(srcDir)) {
					const src = path.join(srcDir, name)
					if (fs.statSync(src).isFile()) {
						const dest = path.join(destDir, name)
						fs.copyFileSync(src, dest)
						collected.push(dest)
					}
				}
			} catch {}
		}

		// 4. Copy extension logs
		const logFound = findExtensionLogFile(clineDir)
		if (logFound.exists) {
			const dest = path.join(outDir, "extension-logs.txt")
			fs.copyFileSync(logFound.path, dest)
			collected.push(dest)
		}

		// 5. Save final status
		const status = getStatusSnapshot(controller)
		fs.writeFileSync(path.join(outDir, "final-status.json"), JSON.stringify(status, null, 2), "utf-8")
		collected.push(path.join(outDir, "final-status.json"))

		// 6. Save outcome analysis
		const outcome = analyzeChatOutcome(controller)
		fs.writeFileSync(path.join(outDir, "outcome.json"), JSON.stringify(outcome, null, 2), "utf-8")
		collected.push(path.join(outDir, "outcome.json"))

		// 7. Generate SUMMARY.txt with quality analysis
		const summaryLines: string[] = [
			"=== LAB RUN SUMMARY ===",
			`Date: ${new Date().toLocaleString("ru-RU")}`,
			`Session: ${status.taskId || "unknown"}`,
			"",
			"=== METRICS ===",
			`Messages (UI): ${msgs.length}`,
			`Verdict: ${outcome.verdict}`,
			`Completion: ${outcome.hasCompletion}`,
			`API failures: ${outcome.hasApiFail ? "yes" : "no"}`,
			`Mistake limit: ${outcome.hasMistakeLimit ? "reached" : "not reached"}`,
			"",
			"=== FILES ===",
			...collected.map((f) => `  ${path.relative(outDir, f)} (${fs.statSync(f).size} bytes)`),
			"",
		]

		// Add quality analysis from session messages if available
		if (fromFile?.messages) {
			try {
				const sessionMsgs = fromFile.messages as any[]
				const assistantMsgs = sessionMsgs.filter((m: any) => m.role === "assistant" && m.metrics)
				if (assistantMsgs.length > 0) {
					const totalIn = assistantMsgs.reduce((sum: number, m: any) => sum + (m.metrics?.inputTokens || 0), 0)
					const totalOut = assistantMsgs.reduce((sum: number, m: any) => sum + (m.metrics?.outputTokens || 0), 0)
					const lastMsg = assistantMsgs[assistantMsgs.length - 1]
					const contextTokens = lastMsg?.metrics?.inputTokens || 0

					summaryLines.push(
						"=== TOKEN ANALYSIS ===",
						`Total input tokens (aggregate): ${totalIn}`,
						`Total output tokens: ${totalOut}`,
						`Last context size: ${contextTokens} tokens`,
						`Assistant turns: ${assistantMsgs.length}`,
						"",
					)

					// Detect repeated thinking patterns
					let maxConsecutiveIdentical = 0
					let currentStreak = 1
					let lastThinking = ""
					let enoentCount = 0
					let consecutiveEof = 0
					let maxConsecutiveEof = 0

					for (const msg of sessionMsgs) {
						if (msg.role === "assistant") {
							// Check thinking
							const thinking = msg.content?.find((c: any) => c.type === "thinking")?.thinking
							if (thinking) {
								const normalized = thinking.trim().replace(/\s+/g, " ").substring(0, 200)
								if (normalized === lastThinking) {
									currentStreak++
									maxConsecutiveIdentical = Math.max(maxConsecutiveIdentical, currentStreak)
								} else {
									currentStreak = 1
									lastThinking = normalized
								}
							}
						}
						// Check for ENOENT in tool results
						if (msg.role === "user") {
							for (const content of (msg.content || [])) {
								if (content.type === "tool_result") {
									const resultText = JSON.stringify(content.content || "")
									if (resultText.includes("ENOENT") || resultText.includes("no such file")) {
										enoentCount++
										consecutiveEof++
										maxConsecutiveEof = Math.max(maxConsecutiveEof, consecutiveEof)
									} else {
										consecutiveEof = 0
									}
								}
							}
						}
					}

					summaryLines.push(
						"=== QUALITY ANALYSIS ===",
						`ENOENT errors total: ${enoentCount}`,
						`Max consecutive ENOENT: ${maxConsecutiveEof}`,
						`Max consecutive identical thinking: ${maxConsecutiveIdentical}`,
						"",
						"=== RECOMMENDATIONS ===",
					)

					if (maxConsecutiveEof >= 5) {
						summaryLines.push("- WARNING: Agent looped on ENOENT errors. Consider adding file existence checks.")
					}
					if (maxConsecutiveIdentical >= 3) {
						summaryLines.push("- WARNING: Agent repeated same thinking. Possible reasoning loop.")
					}
					if (enoentCount > 10) {
						summaryLines.push("- WARNING: High ENOENT count. Agent may be guessing file paths.")
					}
					if (summaryLines[summaryLines.length - 1] === "=== RECOMMENDATIONS ===") {
						summaryLines.push("- No issues detected.")
					}
				}
			} catch (e: any) {
				summaryLines.push(`Quality analysis failed: ${e.message}`)
			}
		}

		fs.writeFileSync(path.join(outDir, "SUMMARY.txt"), summaryLines.join("\n"), "utf-8")
		collected.push(path.join(outDir, "SUMMARY.txt"))

		return {
			ok: true,
			outDir,
			files: collected,
			verdict: outcome.verdict,
			messageCount: msgs.length,
		}
	}

	// РІвЂќР‚РІвЂќР‚ POST /api/install_vsix РІР‚вЂќ install VSIX via code CLI РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/install_vsix" && req.method === "POST") {
		const body = await readBody(req)
		const { vsixPath } = JSON.parse(body)
		if (!vsixPath) throw new Error("vsixPath is required")
		const resolvedPath = path.resolve(vsixPath)
		if (!fs.existsSync(resolvedPath)) throw new Error(`VSIX not found: ${resolvedPath}`)
		const { execSync } = await import("node:child_process")
		try {
			const stdout = execSync(`code --install-extension="${resolvedPath}"`, {
				encoding: "utf-8",
				timeout: 60000,
				windowHide: true,
			})
			return { ok: true, stdout: stdout.trim() }
		} catch (err: any) {
			return { ok: false, error: err.message, stderr: err.stderr?.trim() || "" }
		}
	}

	// POST /api/compact вЂ” run context/full compaction (summarization)
	if (pathname === "/api/compact" && req.method === "POST") {
		const bodyRaw = await readBody(req)
		let mode: "context" | "full" = "context"
		try {
			if (bodyRaw.trim()) {
				const b = JSON.parse(bodyRaw)
				if (b.mode === "full") mode = "full"
			}
		} catch {}
		if (!controller.task?.taskId) throw new Error("No active task to compact")
		const before = getStatusSnapshot(controller)
		const ctxBefore = loadSessionContext(controller, clineDir)
		const ctxBeforeChars = (ctxBefore && ctxBefore.messages) ? JSON.stringify(ctxBefore.messages).length : 0
		const providerScale = controller.getProviderScale?.() ?? 1
		const ctxBeforeTokens = ctxBeforeChars ? Math.round(estimateTokens(ctxBeforeChars) * providerScale) : 0
		const compactResult = await controller.compactTask(mode)
		await sleep(1500)
		const after = getStatusSnapshot(controller)
		const ctxAfter = loadSessionContext(controller, clineDir)
		const ctxAfterChars = (ctxAfter && ctxAfter.messages) ? JSON.stringify(ctxAfter.messages).length : 0
		const ctxAfterTokens = ctxAfterChars ? Math.round(estimateTokens(ctxAfterChars) * providerScale) : 0
		const ctxBeforeMsgCount = (ctxBefore && ctxBefore.messages) ? ctxBefore.messages.length : null
		const ctxAfterMsgCount = (ctxAfter && ctxAfter.messages) ? ctxAfter.messages.length : null
		return {
			ok: compactResult.compacted,
			compacted: compactResult.compacted,
			reason: compactResult.reason || null,
			mode,
			before: {
				messageCount: before.messageCount,
				phase: before.phase,
				sessionMessages: ctxBeforeMsgCount,
				contextChars: ctxBeforeChars,
				contextTokens: ctxBeforeTokens,
			},
			after: {
				messageCount: after.messageCount,
				phase: after.phase,
				verdict: after.verdict,
				sessionMessages: ctxAfterMsgCount,
				contextChars: ctxAfterChars,
				contextTokens: ctxAfterTokens,
			},
			contextReduction: ctxBeforeChars > 0 ? Math.round((1 - ctxAfterChars / ctxBeforeChars) * 100) : 0,
			status: after,
		}
	}

	// РІвЂќР‚РІвЂќР‚ POST /api/restart вЂ” restart VS Code window РІвЂќР‚РІвЂќР‚
	if (pathname === "/api/restart" && req.method === "POST") {
		if (!vscode) throw new Error("vscode module not available")
		vscode.commands.executeCommand("workbench.action.reloadWindow")
		return { ok: true }
	}

	throw new Error(`Unknown endpoint: ${pathname}`)
}

function sendJson(res: http.ServerResponse, status: number, data: any): void {
	// Always declare charset=utf-8 so clients (especially PowerShell 5.1)
	// decode the response correctly and don't interpret as system codepage.
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
	res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk: Buffer) => chunks.push(chunk))
		req.on("end", () => {
			const buf = Buffer.concat(chunks)
			const contentType = req.headers["content-type"] || ""
			const charsetMatch = contentType.match(/charset=([^\s;]+)/i)
			const declaredCharset = (charsetMatch?.[1] || "").toLowerCase()

			// If client declared a specific charset (e.g. charset=cp1251), use it.
			if (declaredCharset && declaredCharset !== "utf-8") {
				try {
					const decoder = new TextDecoder(declaredCharset)
					resolve(decoder.decode(buf))
					return
				} catch {
					// Unknown charset вЂ” fall through to auto-detection
				}
			}

			// No charset declared (or utf-8 declared): try UTF-8 first.
			const utf8 = buf.toString("utf-8")
			if (!utf8.includes("\uFFFD")) {
				resolve(utf8)
				return
			}

			// UTF-8 produced replacement chars вЂ” the body is likely in the system
			// default ANSI codepage (cp1251 on Russian Windows). PowerShell 5.1
			// sends Invoke-RestMethod bodies this way without declaring charset.
			try {
				const decoder = new TextDecoder("windows-1251")
				resolve(decoder.decode(buf))
			} catch {
				resolve(utf8)
			}
		})
		req.on("error", reject)
	})
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// РІвЂќР‚РІвЂќР‚ Markdown export РІвЂќР‚РІвЂќР‚
const COMMAND_OUTPUT_STRING = "Output:"
const SKIP_SAY = new Set([
	"api_req_started", "api_req_finished", "api_req_retried",
	"mcp_server_request_started", "shell_integration_warning",
	"shell_integration_warning_with_suggestion", "load_mcp_documentation",
	"checkpoint_created", "hook",
])
const SKIP_ASK_TOOL = new Set(["attempt_completion"])

function formatTs(ts: number | undefined): string {
	// MessageIdMinter ids are small counters; only treat values as wall-clock ms.
	if (!ts || !Number.isFinite(ts) || ts < 1e12) return ""
	try { return new Date(ts).toLocaleString("ru-RU") } catch { return "" }
}

function appendBlock(lines: string[], heading: string, body: string, ts?: number): void {
	const when = formatTs(ts)
	lines.push(when ? `${heading} (${when}):` : `${heading}:`)
	if (body.trim()) lines.push(body.trimEnd())
	lines.push("", "=======================", "")
}

function parseTool(text: string | undefined): { tool?: string; path?: string; regex?: string; content?: string } {
	try { return JSON.parse(text || "{}") } catch { return {} }
}

function formatCommandBlock(msg: any): string {
	const raw = msg.text ?? ""
	const [commandPart, ...outputParts] = raw.split(COMMAND_OUTPUT_STRING)
	const command = commandPart.trim()
	const output = outputParts.join(COMMAND_OUTPUT_STRING).trim()
	const status = msg.commandCompleted ? "Completed" : "Running"
	const lines = ["Agentario wants to execute this command:", "", status, ""]
	if (command) lines.push("```shell", command, "```", "")
	if (output) lines.push("```shell", output, "```")
	return lines.join("\n").trimEnd()
}

function formatToolLine(msg: any): string {
	const tool = parseTool(msg.text)
	if (!tool.tool) return msg.text ?? ""
	const label = msg.type === "ask" ? "Agentario wants to use tool" : "Agentario used tool"
	const parts: string[] = [label, tool.tool]
	if (tool.path) parts.push(tool.path)
	if (tool.regex) parts.push(tool.regex)
	if (tool.content?.trim()) parts.push("", tool.content.trim())
	return parts.join("\n")
}

/**
 * Build a map from message index to stats line for all api_req_started messages.
 * Returns a Map<messageIndex, statsLine>.
 */
function buildStatsMap(messages: any[]): Map<number, string> {
	const statsMap = new Map<number, string>()
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				const line = formatMessageStatsLine(info)
				if (line) {
					statsMap.set(i, line)
				}
			} catch {}
		}
	}
	return statsMap
}

/**
 * Find the stats line for a given message index by searching both
 * backward and forward, returning the closest match.
 */
function findStatsForMessage(statsMap: Map<number, string>, messageIndex: number): string | undefined {
	const indices = Array.from(statsMap.keys()).sort((a, b) => a - b)
	let closestIdx: number | undefined
	let closestDist = Infinity
	for (const idx of indices) {
		const dist = Math.abs(idx - messageIndex)
		if (dist < closestDist) {
			closestDist = dist
			closestIdx = idx
		}
	}
	return closestIdx !== undefined ? statsMap.get(closestIdx) : undefined
}

function exportMessagesToMarkdown(messages: any[], options: { title?: string; compact?: boolean } = {}): string {
	const lines: string[] = []
	if (options.title?.trim()) lines.push(`# ${options.title.trim()}`, "")
	lines.push(`Exported: ${new Date().toLocaleString("ru-RU")}`, "", "---", "")

	const taskMessages = messages.filter((m: any) => m.say === "task")
	const otherMessages = messages.filter((m: any) => m.say !== "task")
	const ordered = [
		...taskMessages.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0)),
		...otherMessages.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0)),
	]

	// Build stats map for all api_req_started messages
	const statsMap = buildStatsMap(ordered)

	for (let msgIdx = 0; msgIdx < ordered.length; msgIdx++) {
		const msg = ordered[msgIdx]
		if (msg.partial) continue
		if (msg.type === "say" && msg.say && SKIP_SAY.has(msg.say)) continue
		if (options.compact && msg.type === "say" && msg.say === "reasoning" && !(msg.text || "").trim()) continue
		if (msg.type === "ask" && msg.ask === "tool" && SKIP_ASK_TOOL.has(parseTool(msg.text).tool ?? "")) continue
		if (msg.type === "say" && msg.say === "tool" && SKIP_ASK_TOOL.has(parseTool(msg.text).tool ?? "")) continue

		if (msg.type === "say" && msg.say === "info") {
			const text = (msg.text ?? "").trim()
			if (text) appendBlock(lines, "System", text, msg.ts)
			continue
		}
		if (msg.type === "say" && (msg.say === "user_feedback" || msg.say === "task")) {
			appendBlock(lines, "User", msg.text ?? "", msg.ts)
			continue
		}
		if (msg.type === "say" && msg.say === "reasoning") {
			if (msg.text?.trim()) {
				appendBlock(lines, "Thinking", msg.text, msg.ts)
				// Append stats after Thinking block
				const stats = findStatsForMessage(statsMap, msgIdx)
				if (stats) {
					lines.push(`  ${stats}`, "")
				}
			}
			continue
		}
		if (msg.type === "say" && (msg.say === "text" || msg.say === "completion_result")) {
			appendBlock(lines, "Agent", msg.text ?? "", msg.ts)
			// Append stats after Agent text/completion block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}
		if (msg.type === "say" && msg.say === "command") {
			appendBlock(lines, "Agent", formatCommandBlock(msg), msg.ts)
			// Append stats after command block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}
		if (msg.type === "say" && msg.say === "tool") {
			appendBlock(lines, "Tool", formatToolLine(msg), msg.ts)
			// Append stats after tool block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}
		if (msg.type === "ask" && msg.ask === "tool") {
			appendBlock(lines, "Tool", formatToolLine(msg), msg.ts)
			// Append stats after tool block
			const stats = findStatsForMessage(statsMap, msgIdx)
			if (stats) {
				lines.push(`  ${stats}`, "")
			}
			continue
		}
	}

	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
	return `${lines.join("\n")}\n`
}

