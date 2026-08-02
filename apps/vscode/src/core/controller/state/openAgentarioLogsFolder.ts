import * as vscode from "vscode"
import { Empty, EmptyRequest } from "@shared/proto/agentario/common"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { resolveAgentarioLogsRootDirectory } from "@/shared/agentario-file-logger"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/** Открывает корневую папку логов Agentario в проводнике ОС. */
export async function openAgentarioLogsFolder(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const logsDir = await resolveAgentarioLogsRootDirectory()
		const uri = vscode.Uri.file(logsDir)
		const opened = await vscode.env.openExternal(uri)
		if (!opened) {
			await HostProvider.workspace.openInFileExplorerPanel({ path: logsDir })
		}
		Logger.log(`[openAgentarioLogsFolder] Opened ${logsDir}`)
		return Empty.create()
	} catch (error) {
		Logger.error("[openAgentarioLogsFolder] Failed:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Не удалось открыть папку логов: ${error instanceof Error ? error.message : String(error)}`,
		})
		throw error
	}
}
