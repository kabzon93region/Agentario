import { type OpenAiCompatibleModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { useCallback, useEffect, useRef, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { parsePrice } from "../utils/pricingUtils"

interface OpenAiCompatibleModelConfigurationProps {
	selectedModelId: string
	committedModelInfo: OpenAiCompatibleModelInfo | undefined
	onModelInfoChange: (modelInfo: OpenAiCompatibleModelInfo) => void
}

/**
 * Model Configuration block for OpenAI-compatible providers.
 * Uses local draft state so checkbox toggles are not overwritten by stale props.
 */
export const OpenAiCompatibleModelConfiguration = ({
	selectedModelId,
	committedModelInfo,
	onModelInfoChange,
}: OpenAiCompatibleModelConfigurationProps) => {
	const [expanded, setExpanded] = useState(false)
	const modelIdRef = useRef(selectedModelId)
	const [modelConfig, setModelConfig] = useState<OpenAiCompatibleModelInfo>(
		() => committedModelInfo ?? openAiModelInfoSafeDefaults,
	)

	useEffect(() => {
		const defaults =
			committedModelInfo ??
			({
				...openAiModelInfoSafeDefaults,
				name: selectedModelId || openAiModelInfoSafeDefaults.name,
			} as OpenAiCompatibleModelInfo)
		modelIdRef.current = selectedModelId
		setModelConfig(defaults)
	}, [selectedModelId, committedModelInfo])

	const commitModelInfo = useCallback(
		(next: OpenAiCompatibleModelInfo) => {
			setModelConfig(next)
			onModelInfoChange(next)
		},
		[onModelInfoChange],
	)

	const patchModelInfo = useCallback(
		(patch: Partial<OpenAiCompatibleModelInfo>) => {
			commitModelInfo({ ...modelConfig, ...patch })
		},
		[commitModelInfo, modelConfig],
	)

	return (
		<>
			<div
				onClick={() => setExpanded((value) => !value)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{ marginRight: "4px" }}
				/>
				<span style={{ fontWeight: 700, textTransform: "uppercase" }}>Model Configuration</span>
			</div>

			{expanded && (
				<>
					<div className="flex items-center gap-2 mb-2">
						<Switch
							checked={!!modelConfig.supportsImages}
							key={`supports-images-${selectedModelId}`}
							onClick={() => patchModelInfo({ supportsImages: !modelConfig.supportsImages })}
						/>
						<span style={{ fontWeight: 500 }}>Supports Images</span>
					</div>

					<div className="flex items-center gap-2 mb-2">
						<Switch
							checked={!!modelConfig.isR1FormatRequired}
							key={`r1-format-${selectedModelId}`}
							onClick={() => patchModelInfo({ isR1FormatRequired: !modelConfig.isR1FormatRequired })}
						/>
						<span style={{ fontWeight: 500 }}>Enable R1 messages format</span>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								modelConfig.contextWindow?.toString() ?? openAiModelInfoSafeDefaults.contextWindow?.toString() ?? ""
							}
							onChange={(value) => patchModelInfo({ contextWindow: Number(value) })}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={modelConfig.maxTokens?.toString() ?? openAiModelInfoSafeDefaults.maxTokens?.toString() ?? ""}
							onChange={(value) => patchModelInfo({ maxTokens: Number(value) })}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={modelConfig.inputPrice?.toString() ?? openAiModelInfoSafeDefaults.inputPrice?.toString() ?? ""}
							onChange={(value) =>
								patchModelInfo({ inputPrice: parsePrice(value, openAiModelInfoSafeDefaults.inputPrice ?? 0) })
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								modelConfig.outputPrice?.toString() ?? openAiModelInfoSafeDefaults.outputPrice?.toString() ?? ""
							}
							onChange={(value) =>
								patchModelInfo({ outputPrice: parsePrice(value, openAiModelInfoSafeDefaults.outputPrice ?? 0) })
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								modelConfig.temperature?.toString() ?? openAiModelInfoSafeDefaults.temperature?.toString() ?? ""
							}
							onChange={(value) =>
								patchModelInfo({ temperature: parsePrice(value, openAiModelInfoSafeDefaults.temperature ?? 0) })
							}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}
		</>
	)
}
