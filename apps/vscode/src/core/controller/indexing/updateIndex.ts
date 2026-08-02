import type { EmptyRequest } from "@shared/proto/agentario/common"
import type { CodebaseIndex } from "@shared/proto/agentario/indexing"
import { CodebaseIndexService } from "@/services/indexing/CodebaseIndexService"
import type { Controller } from "../index"
import { toProtoCodebaseIndex } from "./shared"

export async function updateIndex(_controller: Controller, _request: EmptyRequest): Promise<CodebaseIndex> {
	return toProtoCodebaseIndex(await CodebaseIndexService.updateNew())
}
