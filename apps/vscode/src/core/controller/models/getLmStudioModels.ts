import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { StringArray, type StringRequest } from "@shared/proto/cline/common"
import { fetchLmStudioModels } from "@cline/shared"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
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
				}),
			),
		})
	} catch (error) {
		Logger.error("Failed to fetch LM Studio models:", error)
		return StringArray.create({ values: [] })
	}
}
