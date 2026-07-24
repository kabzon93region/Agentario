import type { ModelInfo } from "@shared/api"
import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { buildClinePassSubscriptionPageUrl } from "@/components/onboarding/AgentarioPassSubscribe"
import { useClineAuth } from "@/context/AgentarioAuthContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { AgentarioAccountInfoCard } from "../AgentarioAccountInfoCard"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface AgentarioPassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const CLINE_PASS_PROVIDER_ID = "agentario-pass"

function clinePassFallbackModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

/**
 * ClinePass is a first-class SDK provider whose credentials are backed by the
 * user's Cline OAuth account. Keep the UX close to the Cline provider (account
 * card + model selection), but resolve and persist selections through the SDK
 * provider catalog under providerId="agentario-pass".
 */
export const AgentarioPassProvider = ({ showModelOptions, isPopup, currentMode }: AgentarioPassProviderProps) => {
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(CLINE_PASS_PROVIDER_ID)
	const { config, write, commitSelection } = useProviderConfig(CLINE_PASS_PROVIDER_ID)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(CLINE_PASS_PROVIDER_ID, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
		customModelInfo: clinePassFallbackModelInfo,
	})
	const { clineUser } = useClineAuth()

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) => console.error("Failed to commit ClinePass model selection:", err))
	}

	return (
		<div>
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<AgentarioAccountInfoCard usageLink={buildClinePassSubscriptionPageUrl(clineUser?.appBaseUrl)} />
			</div>

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={false}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error("Failed to update ClinePass reasoning effort:", err))
							}}
						/>
					)}

					<ModelInfoView
						hideUsageCost={true}
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
