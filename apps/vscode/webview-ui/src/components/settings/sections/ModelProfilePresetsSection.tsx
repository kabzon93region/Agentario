import type { ModelProfilePreset } from "@shared/model-profile-presets"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useMemo, useState } from "react"
import Section from "@/components/settings/Section"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import { logAgentarioUiClick } from "@/utils/agentario-ui-logger"

async function persistModelProfilePresets(presets: ModelProfilePreset[], activePresetId?: string) {
	await StateServiceClient.updateSettings(
		UpdateSettingsRequest.create({
			modelProfilePresetsJson: JSON.stringify({ presets, activePresetId }),
		}),
	)
}

export const ModelProfilePresetsSection = () => {
	const { modelProfilePresets = [], activeModelProfilePresetId, apiConfiguration } = useExtensionState()
	const [draftName, setDraftName] = useState("")
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editingName, setEditingName] = useState("")
	const canSave = Boolean(apiConfiguration) && draftName.trim().length > 0

	const sortedPresets = useMemo(
		() => [...modelProfilePresets].sort((a, b) => a.name.localeCompare(b.name, "ru")),
		[modelProfilePresets],
	)

	const handleSaveCurrent = async () => {
		const name = draftName.trim()
		if (!name) {
			return
		}
		await StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				captureModelProfilePresetName: name,
			}),
		)
		setDraftName("")
	}

	const handleApply = async (presetId: string) => {
		const preset = modelProfilePresets.find((entry) => entry.id === presetId)
		logAgentarioUiClick("settings.modelPresets", preset?.name ?? presetId, `apply preset ${presetId}`)
		await StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				applyModelProfilePresetId: presetId,
			}),
		)
	}

	const handleDelete = async (presetId: string) => {
		const next = modelProfilePresets.filter((preset) => preset.id !== presetId)
		await persistModelProfilePresets(
			next,
			activeModelProfilePresetId === presetId ? undefined : activeModelProfilePresetId,
		)
	}

	const handleRename = async (presetId: string) => {
		const name = editingName.trim()
		if (!name) {
			return
		}
		const next = modelProfilePresets.map((preset) => (preset.id === presetId ? { ...preset, name } : preset))
		await persistModelProfilePresets(next, activeModelProfilePresetId)
		setEditingId(null)
		setEditingName("")
	}

	return (
		<Section>
			<div style={{ fontWeight: 600, marginBottom: 8 }}>{t("api.modelPresetsTitle")}</div>
			<p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginTop: 0 }}>
				{t("api.modelPresetsHint")}
			</p>

			<div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "end" }}>
				<VSCodeTextField
					onInput={(event) => setDraftName((event.target as HTMLInputElement).value)}
					placeholder={t("api.modelPresetNamePlaceholder")}
					style={{ flex: 1 }}
					value={draftName}>
					{t("api.modelPresetNameLabel")}
				</VSCodeTextField>
				<VSCodeButton disabled={!canSave} onClick={() => void handleSaveCurrent()}>
					{t("api.modelPresetSaveCurrent")}
				</VSCodeButton>
			</div>

			{sortedPresets.length === 0 ? (
				<div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>{t("api.modelPresetsEmpty")}</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					{sortedPresets.map((preset) => (
						<div
							key={preset.id}
							style={{
								display: "flex",
								gap: 8,
								alignItems: "center",
								padding: "8px 10px",
								borderRadius: 4,
								background: "var(--vscode-textBlockBackground)",
							}}>
							{editingId === preset.id ? (
								<VSCodeTextField
									onInput={(event) => setEditingName((event.target as HTMLInputElement).value)}
									style={{ flex: 1 }}
									value={editingName}
								/>
							) : (
								<button
									className="text-left flex-1 min-w-0 truncate bg-transparent border-0 p-0 cursor-pointer"
									onClick={() => void handleApply(preset.id)}
									style={{
										color:
											activeModelProfilePresetId === preset.id
												? "var(--vscode-textLink-foreground)"
												: "var(--vscode-foreground)",
										fontWeight: activeModelProfilePresetId === preset.id ? 600 : 400,
									}}
									title={t("api.modelPresetApply")}
									type="button">
									{preset.name}
								</button>
							)}
							{editingId === preset.id ? (
								<>
									<VSCodeButton appearance="secondary" onClick={() => void handleRename(preset.id)}>
										{t("api.modelPresetSave")}
									</VSCodeButton>
									<VSCodeButton appearance="secondary" onClick={() => setEditingId(null)}>
										{t("api.modelPresetCancel")}
									</VSCodeButton>
								</>
							) : (
								<>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											setEditingId(preset.id)
											setEditingName(preset.name)
										}}>
										{t("api.modelPresetEdit")}
									</VSCodeButton>
									<VSCodeButton appearance="secondary" onClick={() => void handleDelete(preset.id)}>
										{t("api.modelPresetDelete")}
									</VSCodeButton>
								</>
							)}
						</div>
					))}
				</div>
			)}
		</Section>
	)
}
