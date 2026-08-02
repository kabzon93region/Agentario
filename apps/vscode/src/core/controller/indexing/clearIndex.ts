import type { EmptyRequest } from "@shared/proto/agentario/common"
import type { CodebaseIndex } from "@shared/proto/agentario/indexing"
import { CodebaseIndexService } from "@/services/indexing/CodebaseIndexService"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { toProtoCodebaseIndex } from "./shared"

export async function clearIndex(_controller: Controller, _request: EmptyRequest): Promise<CodebaseIndex> {
	Logger.info("[clearIndex] clearIndex called from UI")
	try {
		const result = await CodebaseIndexService.clear()
		Logger.info(`[clearIndex] clear() returned: ${JSON.stringify({ workspacePath: result.workspacePath, filesCount: result.files.length, isIndexing: result.isIndexing })}`)
		const proto = toProtoCodebaseIndex(result)
		Logger.info(`[clearIndex] toProtoCodebaseIndex returned: ${JSON.stringify({ workspacePath: proto.workspacePath, filesCount: proto.files.length, totalFiles: proto.totalFiles })}`)
		return proto
	} catch (error) {
		Logger.error(`[clearIndex] Error: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}
