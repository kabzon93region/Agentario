import { Empty, StringRequest } from "@shared/proto/agentario/common"
import { appendAgentarioUiLog } from "@/shared/agentario-file-logger"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/** Записывает событие UI webview в ~/.agentario/data/logs/ui/ */
export async function logAgentarioUiEvent(_controller: Controller, request: StringRequest): Promise<Empty> {
	const raw = request.value?.trim()
	if (!raw) {
		return Empty.create()
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>
		await appendAgentarioUiLog(parsed)
		Logger.log(`[Agentario UI] ${parsed.screen ?? "?"} :: ${parsed.action ?? "?"} ${parsed.detail ?? ""}`.trim())
	} catch (error) {
		Logger.warn("[logAgentarioUiEvent] Invalid payload:", error)
	}

	return Empty.create()
}
