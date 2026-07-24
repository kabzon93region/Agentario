import { McpDisplayMode, UpdateSettingsRequest } from "@shared/proto/agentario/state"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Converts values to their corresponding proto format
 * @param field - The field name
 * @param value - The value to convert
 * @returns The converted value
 * @throws Error if the value is invalid for the field
 */
const convertToProtoValue = (field: keyof UpdateSettingsRequest, value: any): any => {
	if (field === "mcpDisplayMode" && typeof value === "string") {
		switch (value) {
			case "rich":
				return McpDisplayMode.RICH
			case "plain":
				return McpDisplayMode.PLAIN
			case "markdown":
				return McpDisplayMode.MARKDOWN
			default:
				throw new Error(`Invalid MCP display mode value: ${value}`)
		}
	}
	return value
}

/**
 * Updates a single field in the settings.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateSetting = (field: keyof UpdateSettingsRequest, value: any) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {}

	const convertedValue = convertToProtoValue(field, value)
	updateRequest[field] = convertedValue

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}

/** Patch settings fields that may exist in proto before TS types are regenerated.
 *  Uses `as any` to bypass strict proto typing for custom Agentario fields
 *  (compactionChunkSize, compactionDoubleSummarization, etc.). */
export const updateSettingsPatch = (patch: Record<string, unknown>) => {
	StateServiceClient.updateSettings(
		UpdateSettingsRequest.create(patch as any),
	).catch((error) => {
		console.error("Failed to update settings patch:", error)
	})
}
