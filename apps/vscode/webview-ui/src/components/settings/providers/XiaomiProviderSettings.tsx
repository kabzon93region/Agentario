import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import {
	createMimoTokenPlanModelInfo,
	getMimoPresetApiKeyHint,
	getMimoPresetBaseUrl,
	MIMO_PRESET_LABELS,
	MIMO_TOKEN_PLAN_MODEL_ID,
	type MimoPresetId,
} from "./mimo-presets"
import { OpenAiCompatibleModelConfiguration } from "./OpenAiCompatibleModelConfiguration"

interface XiaomiProviderSettingsProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const XiaomiProviderSettings = ({ showModelOptions, isPopup, currentMode }: XiaomiProviderSettingsProps) => {
	const providerId = "xiaomi"
	const { apiConfiguration } = useExtensionState()
	const { config, write, commitSelection, isLoading } = useProviderConfig(providerId)
	const { selectedModelId: legacySelectedModelId, selectedModelInfo: legacySelectedModelInfo } = useDynamicProviderSelection(
		providerId,
		apiConfiguration,
		currentMode,
	)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = committedSelection?.modelId ?? legacySelectedModelId ?? ""
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: legacySelectedModelInfo

	const [availableModels, setAvailableModels] = useState<string[]>([])
	const [isRefreshingModels, setIsRefreshingModels] = useState(false)
	const [modelsError, setModelsError] = useState<string | undefined>(undefined)
	const latestBaseUrlRef = useRef(config?.baseUrl || "")
	const latestApiKeyRef = useRef("")
	const modelsRequestRef = useRef(0)

	useEffect(() => {
		latestBaseUrlRef.current = config?.baseUrl || ""
	}, [config?.baseUrl])

	const commitModel = useCallback(
		(modelId: string, modelInfo: ModelInfo) => {
			if (!modelId.trim()) {
				return
			}
			void commitSelection(currentMode, {
				providerId,
				modelId,
				modelInfo: {
					...modelInfo,
					supportsPromptCache: modelInfo.supportsPromptCache ?? openAiModelInfoSafeDefaults.supportsPromptCache,
				},
			}).catch((error) => console.error("Failed to commit Xiaomi model selection:", error))
		},
		[commitSelection, currentMode],
	)

	const handleModelInfoChange = useCallback(
		(modelInfo: ModelInfo) => {
			commitModel(selectedModelId || MIMO_TOKEN_PLAN_MODEL_ID, modelInfo)
		},
		[commitModel, selectedModelId],
	)

	const refreshModels = useCallback(async (baseUrl?: string, apiKey?: string) => {
		const trimmedBaseUrl = baseUrl?.trim()
		const requestId = modelsRequestRef.current + 1
		modelsRequestRef.current = requestId

		if (!trimmedBaseUrl) {
			setAvailableModels([])
			setModelsError(undefined)
			setIsRefreshingModels(false)
			return
		}

		setIsRefreshingModels(true)
		setModelsError(undefined)

		try {
			const response = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({ baseUrl: trimmedBaseUrl, apiKey, providerId: "xiaomi" }),
			)
			if (modelsRequestRef.current === requestId) {
				setAvailableModels(response.values)
			}
		} catch (error) {
			console.error("Failed to refresh Xiaomi models:", error)
			if (modelsRequestRef.current === requestId) {
				setAvailableModels([])
				setModelsError(error instanceof Error ? error.message : String(error))
			}
		} finally {
			if (modelsRequestRef.current === requestId) {
				setIsRefreshingModels(false)
			}
		}
	}, [])

	useEffect(() => {
		void refreshModels(config?.baseUrl, latestApiKeyRef.current)
	}, [config?.baseUrl, config?.apiKeyLength, refreshModels])

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		canWrite: config !== undefined,
		onApiKeyChange: (apiKey) => {
			latestApiKeyRef.current = apiKey
			void refreshModels(latestBaseUrlRef.current, apiKey)
		},
		providerName: "Xiaomi",
		write,
	})

	const applyMimoPreset = useCallback(
		async (preset: MimoPresetId) => {
			const baseUrl = getMimoPresetBaseUrl(preset)
			const modelId = MIMO_TOKEN_PLAN_MODEL_ID
			const modelInfo = createMimoTokenPlanModelInfo(modelId)

			latestBaseUrlRef.current = baseUrl
			try {
				await write({ baseUrl })
				commitModel(modelId, modelInfo)
				void refreshModels(baseUrl, latestApiKeyRef.current)
			} catch (error) {
				console.error("Failed to apply MiMo preset:", error)
			}
		},
		[commitModel, refreshModels, write],
	)

	const handleModelIdChange = useCallback(
		(modelId: string) => {
			const modelInfo = selectedModelInfo
				? { ...selectedModelInfo, name: modelId }
				: createMimoTokenPlanModelInfo(modelId)
			commitModel(modelId, modelInfo)
		},
		[commitModel, selectedModelInfo],
	)

	return (
		<div>
			{isLoading && (
				<div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginBottom: 8 }}>
					Загрузка настроек провайдера…
				</div>
			)}
			{!isLoading && (
				<>
			<div style={{ marginBottom: 12 }}>
				<div style={{ fontWeight: 500, marginBottom: 6 }}>Быстрая настройка MiMo</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					{(["token-plan", "payg"] as MimoPresetId[]).map((preset) => (
						<VSCodeButton key={preset} appearance="secondary" onClick={() => void applyMimoPreset(preset)}>
							{MIMO_PRESET_LABELS[preset]}
						</VSCodeButton>
					))}
				</div>
				<p
					style={{
						fontSize: 12,
						marginTop: 8,
						color: "var(--vscode-descriptionForeground)",
					}}>
					Token Plan: Base URL <code>{getMimoPresetBaseUrl("token-plan")}</code>, модель{" "}
					<code>{MIMO_TOKEN_PLAN_MODEL_ID}</code>, контекст 1M, Supports Images — выкл. {getMimoPresetApiKeyHint("token-plan")}
				</p>
			</div>

			<BaseUrlField
				initialValue={config?.baseUrl}
				label="Base URL"
				onChange={(value) => {
					latestBaseUrlRef.current = value
					void write({ baseUrl: value }).catch((error) => console.error("Failed to update Xiaomi base URL:", error))
					void refreshModels(value, latestApiKeyRef.current)
				}}
				placeholder="https://token-plan-cn.xiaomimimo.com/v1"
			/>

			<ApiKeyField initialValue={savedApiKeyMask} onChange={handleApiKeyChange} providerName="Xiaomi" />

			{isRefreshingModels && <div role="status">Загрузка моделей…</div>}
			{modelsError && <div role="alert">{modelsError}</div>}

			{availableModels.length > 0 ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
					<label htmlFor="xiaomi-model-picker">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</label>
					<select
						aria-label="Model ID"
						id="xiaomi-model-picker"
						onChange={(event) => handleModelIdChange(event.target.value)}
						style={{ width: "100%" }}
						value={selectedModelId && availableModels.includes(selectedModelId) ? selectedModelId : ""}>
						{selectedModelId && !availableModels.includes(selectedModelId) && (
							<option value="">{selectedModelId} (нет в списке)</option>
						)}
						{availableModels.map((modelId) => (
							<option key={modelId} value={modelId}>
								{modelId}
							</option>
						))}
					</select>
				</div>
			) : (
				<DebouncedTextField
					initialValue={selectedModelId}
					onChange={handleModelIdChange}
					placeholder={MIMO_TOKEN_PLAN_MODEL_ID}
					style={{ width: "100%", marginBottom: 10 }}>
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</DebouncedTextField>
			)}

			<OpenAiCompatibleModelConfiguration
				committedModelInfo={selectedModelInfo}
				onModelInfoChange={handleModelInfoChange}
				selectedModelId={selectedModelId}
			/>

			{showModelOptions && (
				<>
					<ReasoningEffortSelector
						currentMode={currentMode}
						defaultEffort="none"
						onEffortChange={(effort) => {
							void write({
								reasoning: {
									enabled: effort !== "none",
									effort: effort !== "none" ? effort : undefined,
								},
							}).catch((err) => console.error("Failed to update Xiaomi reasoning effort:", err))
						}}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
				</>
			)}
		</div>
	)
}
