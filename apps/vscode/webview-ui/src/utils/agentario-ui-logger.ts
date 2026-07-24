export type AgentarioUiLogPayload = {
	screen: string
	action: string
	detail?: string
	meta?: Record<string, unknown>
}

// Agentario UI event logger — logs to console (visible in VS Code devtools)
// Future: wire to host via gRPC when proto definitions are added.
export function logAgentarioUiEvent(payload: AgentarioUiLogPayload): void {
	try {
		console.log("[Agentario UI]", JSON.stringify(payload))
	} catch {
		// swallow
	}
}

export function logAgentarioScreenView(screen: string, detail?: string, meta?: Record<string, unknown>): void {
	logAgentarioUiEvent({ screen, action: "view", detail, meta })
}

export function logAgentarioUiClick(screen: string, target: string, detail?: string): void {
	logAgentarioUiEvent({ screen, action: "click", detail: `${target}${detail ? `: ${detail}` : ""}` })
}

// Captures a text-based snapshot of the current DOM tree for diagnostics
function captureDomSnapshot(): string {
	try {
		const root = document.getElementById("root") ?? document.body
		if (!root) return "<no root>"
		const snapshot: string[] = []
		const walk = (node: Node, depth: number) => {
			if (depth > 6 || snapshot.length > 300) return
			const indent = "  ".repeat(depth)
			if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as Element
				const tag = el.tagName.toLowerCase()
				const id = el.id ? `#${el.id}` : ""
				const cls = el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}` : ""
				const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE
					? ` "${(el.childNodes[0].textContent ?? "").slice(0, 40)}"`
					: ""
				snapshot.push(`${indent}<${tag}${id}${cls}>${text}`)
				for (const child of Array.from(el.children)) {
					walk(child, depth + 1)
				}
			}
		}
		walk(root, 0)
		return snapshot.join("\n")
	} catch (e) {
		return `<snapshot error: ${e}>`
	}
}

// Global click handler — logs every user click with element info and DOM snapshot
function handleGlobalClick(event: MouseEvent): void {
	try {
		const target = event.target as Element | null
		if (!target) return
		const tag = target.tagName?.toLowerCase() ?? "unknown"
		const id = target.id ? `#${target.id}` : ""
		const cls = target.className && typeof target.className === "string"
			? `.${target.className.split(/\s+/).slice(0, 3).join(".")}`
			: ""
		const text = (target as HTMLElement).innerText?.slice(0, 60) ?? ""
		const detail = `<${tag}${id}${cls}>${text ? ` "${text}"` : ""} @(${Math.round(event.clientX)},${Math.round(event.clientY)})`
		logAgentarioUiEvent({
			screen: detectCurrentScreen(),
			action: "click",
			detail,
			meta: { snapshot: captureDomSnapshot() },
		})
	} catch {
		// swallow
	}
}

// Detects the currently active screen/view based on DOM content
function detectCurrentScreen(): string {
	try {
		if (document.querySelector("[data-screen='settings']")) return "settings"
		if (document.querySelector("[data-screen='chat']")) return "chat"
		if (document.querySelector("[data-screen='history']")) return "history"
		if (document.querySelector("[data-screen='mcp']")) return "mcp"
		if (document.querySelector("[data-screen='indexing']")) return "indexing"
		if (document.querySelector("[data-screen='account']")) return "account"
		return "unknown"
	} catch {
		return "unknown"
	}
}

// Initialize global UI event listeners
let initialized = false
export function initAgentarioUiLogger(): void {
	if (initialized) return
	initialized = true
	document.addEventListener("click", handleGlobalClick, { capture: true })
	console.log("[Agentario UI] Global event logger initialized")
}

// Log a DOM snapshot on demand
export function logDomSnapshot(label: string): void {
	logAgentarioUiEvent({
		screen: detectCurrentScreen(),
		action: "snapshot",
		detail: label,
		meta: { snapshot: captureDomSnapshot() },
	})
}
