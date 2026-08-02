import type { ModelProfilePreset } from "@shared/model-profile-presets"
import { UpdateSettingsRequest } from "@shared/proto/agentario/state"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ChevronDownIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"

async function persistModelProfilePresets(presets: ModelProfilePreset[], activePresetId?: string) {
	await StateServiceClient.updateSettings(
		UpdateSettingsRequest.create({
			modelProfilePresetsJson: JSON.stringify({ presets, activePresetId }),
		} as any),
	)
}

export const ModelPresetPickerModal = () => {
	const { modelProfilePresets = [], activeModelProfilePresetId, navigateToSettings } = useExtensionState()
	const [isVisible, setIsVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	const activePreset = modelProfilePresets.find((preset) => preset.id === activeModelProfilePresetId)
	const sortedPresets = useMemo(
		() => [...modelProfilePresets].sort((a, b) => a.name.localeCompare(b.name, "ru")),
		[modelProfilePresets],
	)

	useClickAway(modalRef, () => setIsVisible(false))

	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			setArrowPosition(document.documentElement.clientWidth - buttonCenter - 5)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	const handleApply = async (presetId: string) => {
		await StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				applyModelProfilePresetId: presetId,
			} as any),
		)
		setIsVisible(false)
	}

	const handleDelete = async (presetId: string) => {
		const next = modelProfilePresets.filter((preset) => preset.id !== presetId)
		await persistModelProfilePresets(
			next,
			activeModelProfilePresetId === presetId ? undefined : activeModelProfilePresetId,
		)
	}

	return (
		<div className="inline-flex min-w-0 max-w-[9rem] items-center" ref={modalRef}>
			<div className="inline-flex w-full items-center" ref={buttonRef}>
				<Tooltip>
					{!isVisible && <TooltipContent>{t("api.modelPresetPickerTooltip")}</TooltipContent>}
					<TooltipTrigger>
						<button
							aria-label={t("api.modelPresetPickerTooltip")}
							className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground) hover:bg-(--vscode-toolbar-hoverBackground) border-0 bg-transparent cursor-pointer"
							onClick={() => setIsVisible((value) => !value)}
							type="button">
							<span className="truncate">{activePreset?.name ?? t("api.modelPresetPickerDefault")}</span>
							<ChevronDownIcon className="size-3 shrink-0" />
						</button>
					</TooltipTrigger>
				</Tooltip>
			</div>

			{isVisible && (
				<PopupModalContainer $arrowPosition={arrowPosition} $menuPosition={menuPosition}>
					<div className="flex-shrink-0 px-3 pt-2 pb-1">
						<div className="flex justify-between items-center mb-2">
							<div className="m-0 text-sm font-medium">{t("api.modelPresetsTitle")}</div>
							<VSCodeButton
								appearance="icon"
								aria-label={t("settings.title")}
								onClick={() => {
									setIsVisible(false)
									navigateToSettings?.("api-config")
								}}
								title={t("api.modelPresetManage")}>
								<PencilIcon className="size-3.5" />
							</VSCodeButton>
						</div>
					</div>
					<div className="max-h-56 overflow-y-auto px-2 pb-2">
						{sortedPresets.length === 0 ? (
							<div className="px-2 py-3 text-xs text-description">{t("api.modelPresetsEmpty")}</div>
						) : (
							sortedPresets.map((preset) => (
								<div
									className="flex items-center gap-2 rounded px-2 py-2 hover:bg-(--vscode-list-hoverBackground)"
									key={preset.id}>
									<button
										className="flex-1 min-w-0 truncate text-left text-xs bg-transparent border-0 p-0 cursor-pointer"
										onClick={() => void handleApply(preset.id)}
										style={{
											fontWeight: activeModelProfilePresetId === preset.id ? 600 : 400,
											color:
												activeModelProfilePresetId === preset.id
													? "var(--vscode-textLink-foreground)"
													: "var(--vscode-foreground)",
										}}
										type="button">
										{preset.name}
									</button>
									<button
										aria-label={t("api.modelPresetDelete")}
										className="shrink-0 border-0 bg-transparent p-0 cursor-pointer text-description hover:text-foreground"
										onClick={() => void handleDelete(preset.id)}
										type="button">
										<Trash2Icon className="size-3.5" />
									</button>
								</div>
							))
						)}
					</div>
				</PopupModalContainer>
			)}
		</div>
	)
}
