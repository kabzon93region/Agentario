import { CheckpointRestoreRequest } from "@shared/proto/agentario/checkpoints"
import { Empty } from "@shared/proto/agentario/common"
import { AgentarioCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	const sdkRestoreCheckpoint = (
		controller as Controller & {
			restoreCheckpoint?: (input: { checkpointRunCount: number; restoreType: AgentarioCheckpointRestore }) => Promise<void>
		}
	).restoreCheckpoint
	if (sdkRestoreCheckpoint) {
		if (request.number) {
			await sdkRestoreCheckpoint.call(controller, {
				checkpointRunCount: Number(request.number),
				restoreType: request.restoreType as AgentarioCheckpointRestore,
			})
		}
		return Empty.create({})
	}

	return Empty.create({})
}
