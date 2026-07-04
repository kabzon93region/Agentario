import type { McpServer } from "@shared/mcp"

export const AGENTARIO_MCP_DISPLAY_LABELS: Record<string, string> = {
	memory: "Memory (standard)",
	"memory-slim": "memory-slim (alternate light)",
	"sequential-thinking": "sequential-thinking (standard)",
	"sequential-thinking-slim": "sequential-thinking-slim (alternate light)",
	context7: "Context7 (standard)",
	charlotte: "Charlotte (alternate light)",
	playwright: "Playwright (standard)",
	trueline: "Trueline (standard)",
	github: "GitHub (optional)",
}

const AGENTARIO_MCP_SORT_ORDER = [
	"memory",
	"memory-slim",
	"sequential-thinking",
	"sequential-thinking-slim",
	"context7",
	"charlotte",
	"playwright",
	"trueline",
	"github",
]

export function getAgentarioMcpDisplayName(serverName: string): string {
	return AGENTARIO_MCP_DISPLAY_LABELS[serverName] ?? serverName
}

export function sortAgentarioMcpServers(servers: McpServer[]): McpServer[] {
	const order = new Map(AGENTARIO_MCP_SORT_ORDER.map((name, index) => [name, index]))
	return [...servers].sort((left, right) => {
		const leftOrder = order.get(left.name) ?? 999
		const rightOrder = order.get(right.name) ?? 999
		if (leftOrder !== rightOrder) {
			return leftOrder - rightOrder
		}
		return left.name.localeCompare(right.name)
	})
}
