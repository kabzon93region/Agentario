import { StringArray, type StringRequest } from "@shared/proto/agentario/common"
import { fetchLmStudioModels } from "@agentario/shared"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches available models from LM Studio
 * @param controller The controller instance
 * @param request The request containing the base URL (optional)
 * @returns Array of model names
 */
export async function getLmStudioModels(_controller: Controller, request: StringRequest): Promise<StringArray> {
	try {
		const baseUrl = request.value || "http://localhost:1234"
		const models = await fetchLmStudioModels(baseUrl, fetch)
		return StringArray.create({
			values: models.map((model) =>
				JSON.stringify({
					id: model.id,
					type: model.type,
					state: model.state,
					key: model.key,
					loadedInstanceIds: model.loadedInstanceIds,
					variants: model.variants,
					max_context_length: model.max_context_length,
					loaded_context_length: model.loaded_context_length,
				}),
			),
		})
	} catch (error) {
		Logger.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
