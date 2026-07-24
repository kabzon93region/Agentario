import { StringRequest } from "@shared/proto/agentario/common"
import {
	type AwsProviderConfig,
	CommitModelSelectionRequest,
	type GcpProviderConfig,
	type ProviderConfigResponse,
	WriteProviderConfigPatch,
	WriteProviderConfigRequest,
} from "@shared/proto/agentario/models"
import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import type { ModelInfo } from "../../../src/shared/api"
import type { Mode } from "../../../src/shared/storage/types"

export type ProviderConfigWritePatch = Partial<Omit<WriteProviderConfigPatch, "headers" | "aws" | "gcp">> & {
	headers?: Record<string, string>
	aws?: Partial<AwsProviderConfig>
	gcp?: Partial<GcpProviderConfig>
}

export interface ProviderModelSelection {
	providerId: ProviderId
	modelId: string
	modelInfo: ModelInfo
}

function toWriteProviderConfigPatch(patch: ProviderConfigWritePatch): WriteProviderConfigPatch {
	const headers = patch.headers ?? {}
	const shouldClearHeaders = patch.headers !== undefined && Object.keys(headers).length === 0

	return WriteProviderConfigPatch.create({
		...patch,
		headers,
		clearHeaders: shouldClearHeaders || undefined,
	})
}

export function useProviderConfig(providerId: ProviderId) {
	const { activeModelProfilePresetId, apiConfiguration } = useExtensionState()
	const providerStateKey = [
		activeModelProfilePresetId ?? "",
		apiConfiguration?.planModeApiProvider ?? "",
		apiConfiguration?.planModeApiModelId ?? "",
		apiConfiguration?.actModeApiProvider ?? "",
		apiConfiguration?.actModeApiModelId ?? "",
	].join("|")
	const [config, setConfig] = useState<ProviderConfigResponse | undefined>(undefined)
	const [isLoading, setIsLoading] = useState(true)
	const isFirstLoadRef = useRef(true)

	const read = useCallback(async () => {
		if (isFirstLoadRef.current) {
			setIsLoading(true)
		}
		const response = await ModelsServiceClient.readProviderConfig(StringRequest.create({ value: providerId }))
		setConfig(response)
		if (isFirstLoadRef.current) {
			setIsLoading(false)
			isFirstLoadRef.current = false
		}
		return response
	}, [providerId])

	useEffect(() => {
		void read()
	}, [read, providerStateKey])

	const write = useCallback(
		async (patch: ProviderConfigWritePatch) => {
			const response = await ModelsServiceClient.writeProviderConfig(
				WriteProviderConfigRequest.create({
					providerId,
					patch: toWriteProviderConfigPatch(patch),
				}),
			)
			setConfig(response)
			return response
		},
		[providerId],
	)

	const commitSelection = useCallback(
		async (mode: Mode, selection: ProviderModelSelection) => {
			const providerMode = mode === "agent" ? "act" as const : mode
			if (selection.providerId !== providerId) {
				throw new Error(`selection providerId ${selection.providerId} does not match hook providerId ${providerId}`)
			}

			await ModelsServiceClient.commitModelSelection(
				CommitModelSelectionRequest.create({
					providerId,
					mode: providerMode,
					modelId: selection.modelId,
					modelInfo: toProtobufModelInfo(selection.modelInfo),
				}),
			)
			await read()
		},
		[providerId, read],
	)

	return { config, isLoading, read, write, commitSelection }
}
