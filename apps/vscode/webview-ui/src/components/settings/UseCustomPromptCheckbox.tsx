import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { updateSetting } from "./utils/settingsHandlers"

interface CustomPromptCheckboxProps {
	providerId: string
}

const UseCustomPromptCheckbox: React.FC<CustomPromptCheckboxProps> = ({ providerId }) => {
	const { customPrompt } = useExtensionState()
	const [isCompactPromptEnabled, setIsCompactPromptEnabled] = useState<boolean>(customPrompt === "compact")

	const toggleCompactPrompt = useCallback((isChecked: boolean) => {
		setIsCompactPromptEnabled(isChecked)
		updateSetting("customPrompt", isChecked ? "compact" : "")
	}, [])

	return (
		<div id={providerId}>
			<VSCodeCheckbox checked={isCompactPromptEnabled} onChange={() => toggleCompactPrompt(!isCompactPromptEnabled)}>
				{t("api.useCompactPrompt")}
			</VSCodeCheckbox>
			<div className="text-xs text-description">
				{t("api.compactPromptHint")}
				<div className="text-error flex align-middle">
					<i className="codicon codicon-x" />
					{t("api.compactPromptLimit")}
				</div>
			</div>
		</div>
	)
}

export default UseCustomPromptCheckbox
