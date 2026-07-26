import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"
import AgentarioMaintenanceSection from "./AgentarioMaintenanceSection"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							{t("general.telemetryRemoteLocked")}
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting !== "disabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									{t("general.telemetry")}
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						{t("general.telemetryHintBefore")}{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://github.com/kabzon93region/Agentario"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							{t("general.telemetryOverview")}
						</VSCodeLink>{" "}
						{t("general.and")}{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://github.com/kabzon93region/Agentario"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							{t("general.privacyPolicy")}
						</VSCodeLink>{" "}
						{t("general.telemetryHintAfter")}
					</p>
				</div>
			</Section>

			<AgentarioMaintenanceSection />
		</div>
	)
}

export default GeneralSettingsSection
