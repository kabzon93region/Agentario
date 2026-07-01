import {
	CodebaseIndex,
	IndexedFile,
	IndexedFileStatus,
} from "@shared/proto/cline/indexing"
import type { CodebaseIndexState, IndexedFileRecord } from "@/services/indexing/CodebaseIndexService"

function toProtoStatus(status: IndexedFileRecord["status"]): IndexedFileStatus {
	switch (status) {
		case "indexed":
			return IndexedFileStatus.INDEXED_FILE_STATUS_INDEXED
		case "partial":
			return IndexedFileStatus.INDEXED_FILE_STATUS_PARTIAL
		case "skipped":
			return IndexedFileStatus.INDEXED_FILE_STATUS_SKIPPED
		case "error":
			return IndexedFileStatus.INDEXED_FILE_STATUS_ERROR
		default:
			return IndexedFileStatus.INDEXED_FILE_STATUS_PENDING
	}
}

export function toProtoCodebaseIndex(state: CodebaseIndexState): CodebaseIndex {
	const files = state.files.map((file) =>
		IndexedFile.create({
			path: file.path,
			status: toProtoStatus(file.status),
			size: file.size,
			mtimeMs: Math.trunc(file.mtimeMs),
			chunks: file.chunks.length,
			embeddingCount: file.chunks.filter((chunk) => chunk.embedding.length > 0).length,
			error: file.error,
		}),
	)
	return CodebaseIndex.create({
		workspacePath: state.workspacePath,
		indexPath: state.indexPath,
		embeddingModel: state.embeddingModel,
		baseUrl: state.baseUrl,
		updatedAtMs: state.updatedAtMs,
		isIndexing: state.isIndexing,
		totalFiles: files.length,
		indexedFiles: state.files.filter((file) => file.status === "indexed" || file.status === "partial").length,
		skippedFiles: state.files.filter((file) => file.status === "skipped").length,
		errorFiles: state.files.filter((file) => file.status === "error").length,
		lastError: state.lastError,
		files,
	})
}
