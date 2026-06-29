import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { t } from "@/i18n"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("ollama")

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const ollamaBaseUrl = config?.baseUrl ?? apiConfiguration?.ollamaBaseUrl
	const ollamaModelInfo = useMemo(() => {
		const contextWindow = Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
		return {
			...openAiModelInfoSafeDefaults,
			...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
		}
	}, [apiConfiguration?.ollamaApiOptionsCtxNum])
	const ollamaModelInfoById = useMemo(
		() => Object.fromEntries(ollamaModels.map((modelId) => [modelId, { ...ollamaModelInfo, name: modelId }])),
		[ollamaModelInfo, ollamaModels],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("ollama", currentMode, {
		models: ollamaModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: ollamaModelInfo,
		customModelInfo: (modelId) => ({ ...ollamaModelInfo, name: modelId }),
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Ollama",
		write,
	})

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update Ollama base URL:", error))
		},
		[write],
	)

	// Poll ollama models
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	useInterval(requestOllamaModels, 2000)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={ollamaBaseUrl}
				label={t("api.useCustomBaseUrl")}
				onChange={handleBaseUrlChange}
				placeholder={t("providers.ollama.baseUrlPlaceholder")}
			/>

			{ollamaBaseUrl && (
				<ApiKeyField
					helpText={t("providers.ollama.apiKeyHelp")}
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder={t("providers.ollama.apiKeyPlaceholder")}
					providerName="Ollama"
				/>
			)}

			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">{t("api.model")}</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={(modelId) => {
					const trimmedModelId = modelId.trim()
					if (!trimmedModelId) {
						return
					}
					void commitModelSelection({
						modelId: trimmedModelId,
						modelInfo: { ...ollamaModelInfo, name: trimmedModelId },
					}).catch((error) => console.error("Failed to update Ollama model selection:", error))
				}}
				placeholder={ollamaModels.length > 0 ? t("providers.ollama.searchModel") : t("providers.ollama.modelPlaceholder")}
				selectedModelId={selectedModel.modelId || ""}
			/>

			{ollamaModels.length === 0 && <p className="text-sm mt-1 text-description italic">{t("providers.ollama.noModels")}</p>}

			<DebouncedTextField
				initialValue={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				onChange={(v) => {
					handleFieldChange("ollamaApiOptionsCtxNum", v || undefined)

					const contextWindow = Number.parseInt(v, 10)
					if (selectedModel.modelId) {
						void commitModelSelection({
							modelId: selectedModel.modelId,
							modelInfo: {
								...openAiModelInfoSafeDefaults,
								name: selectedModel.modelId,
								...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
							},
						}).catch((error) => console.error("Failed to update Ollama context window:", error))
					}
				}}
				placeholder={t("providers.ollama.contextPlaceholder")}
				style={{ width: "100%" }}>
				<span className="font-semibold">{t("providers.ollama.contextWindow")}</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						onChange={(value) => {
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder={t("providers.ollama.timeoutPlaceholder")}
						style={{ width: "100%" }}>
						<span className="font-semibold">{t("providers.ollama.requestTimeout")}</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">{t("providers.ollama.timeoutHint")}</p>
				</>
			)}

			<UseCustomPromptCheckbox providerId="ollama" />

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("providers.ollama.introBefore")}{" "}
				<VSCodeLink href="https://ollama.com" style={{ display: "inline", fontSize: "inherit" }}>
					{t("providers.ollama.ollamaSite")}
				</VSCodeLink>{" "}
				{t("providers.ollama.introAfter")}
			</p>
		</div>
	)
}
