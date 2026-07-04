import { StringRequest } from "@shared/proto/cline/common"
import { StateServiceClient } from "@/services/grpc-client"

export type AgentarioUiLogPayload = {
	screen: string
	action: string
	detail?: string
	meta?: Record<string, unknown>
}

export function logAgentarioUiEvent(payload: AgentarioUiLogPayload): void {
	void StateServiceClient.logAgentarioUiEvent(StringRequest.create({ value: JSON.stringify(payload) })).catch((error) => {
		console.error("[Agentario UI log]", error)
	})
}

export function logAgentarioScreenView(screen: string, detail?: string, meta?: Record<string, unknown>): void {
	logAgentarioUiEvent({ screen, action: "view", detail, meta })
}

export function logAgentarioUiClick(screen: string, target: string, detail?: string): void {
	logAgentarioUiEvent({ screen, action: "click", detail: `${target}${detail ? `: ${detail}` : ""}` })
}
