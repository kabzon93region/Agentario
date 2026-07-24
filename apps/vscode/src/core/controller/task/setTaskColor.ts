import { Empty } from "@shared/proto/agentario/common"
import { TaskColorRequest } from "@shared/proto/agentario/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

export async function setTaskColor(controller: Controller, request: TaskColorRequest): Promise<Empty> {
	Logger.log(`[setTaskColor] request: taskId=${request.taskId}, taskColor=${request.taskColor || "(empty)"}`)
	if (!request.taskId) {
		Logger.error(`[setTaskColor] Invalid request: taskId missing`)
		return Empty.create({})
	}

	try {
		Logger.log(`[setTaskColor] calling controller.setTaskColor...`)
		await controller.setTaskColor(request.taskId, request.taskColor || undefined)
		Logger.log(`[setTaskColor] controller.setTaskColor completed OK`)
		return Empty.create({})
	} catch (error) {
		Logger.error("Error in setTaskColor:", error)
		throw error
	}
}
