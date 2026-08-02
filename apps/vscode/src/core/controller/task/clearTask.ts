import { Empty, EmptyRequest } from "@shared/proto/agentario/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const startedAt = Date.now()
	Logger.log(`[TaskService.clearTask] starting...`)
	try {
		await controller.clearTask()
		const afterClearTask = Date.now()
		Logger.log(`[TaskService.clearTask] controller.clearTask done in ${afterClearTask - startedAt}ms`)
		await controller.postStateToWebview()
		const totalElapsed = Date.now() - startedAt
		Logger.log(`[TaskService.clearTask] total ${totalElapsed}ms (postState=${Date.now() - afterClearTask}ms)`)

		if (totalElapsed > 250) {
			Logger.warn(
				`[TaskService.clearTask] SLOW: took ${totalElapsed}ms (controller.clearTask=${afterClearTask - startedAt}ms, postStateToWebview=${Date.now() - afterClearTask}ms)`,
			)
		}
	} catch (error) {
		Logger.error(`[TaskService.clearTask] FAILED:`, error)
		throw error
	}

	return Empty.create()
}
