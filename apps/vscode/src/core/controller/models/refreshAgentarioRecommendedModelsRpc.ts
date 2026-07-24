import { EmptyRequest } from "@shared/proto/agentario/common"
import { AgentarioRecommendedModel, AgentarioRecommendedModelsResponse } from "@shared/proto/agentario/models"
import type { Controller } from "../index"
import { refreshAgentarioRecommendedModels } from "./refreshAgentarioRecommendedModels"

export async function refreshAgentarioRecommendedModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<AgentarioRecommendedModelsResponse> {
	const models = await refreshAgentarioRecommendedModels()
	return AgentarioRecommendedModelsResponse.create({
		recommended: models.recommended.map((model) =>
			AgentarioRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		free: models.free.map((model) =>
			AgentarioRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		clinePass: (models.clinePass ?? []).map((model) =>
			AgentarioRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
	})
}
