import { StringArray } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import type { AxiosRequestConfig } from "axios"
import axios from "axios"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Fetches available models from the OpenAI API
 * @param controller The controller instance
 * @param request Request containing the base URL, optional API key, and provider id for stored secrets
 * @returns Array of model names
 */
export async function refreshOpenAiModels(controller: Controller, request: OpenAiModelsRequest): Promise<StringArray> {
	try {
		const requestedProviderId = request.providerId?.trim()
		const providerId = requestedProviderId ? parseProviderId(requestedProviderId) : parseProviderId("openai")
		const providerConfig = controller.getProviderConfigStore().read(providerId)
		const baseUrl = request.baseUrl?.trim() || providerConfig.baseUrl
		const requestApiKey = request.apiKey?.trim()
		const apiKey = requestApiKey || providerConfig.apiKey

		if (!baseUrl) {
			return StringArray.create({ values: [] })
		}

		if (!URL.canParse(baseUrl)) {
			return StringArray.create({ values: [] })
		}

		const config: AxiosRequestConfig = {
			headers: {
				...(providerConfig.headers ?? {}),
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
			},
		}

		const response = await axios.get(`${baseUrl}/models`, { ...config, ...getAxiosSettings() })
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		const models = [...new Set<string>(modelsArray)]

		return StringArray.create({ values: models })
	} catch (error) {
		Logger.error("Error fetching OpenAI models:", error)
		return StringArray.create({ values: [] })
	}
}
