import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { t } from "@/i18n"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	const { setShowWelcome } = useExtensionState()
	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					{t("debug.resetWorkspace")}
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					{t("debug.resetGlobal")}
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">{t("debug.resetHint")}</p>
			</Section>
			<Section>
				<Button
					onClick={async () =>
						await StateServiceClient.setWelcomeViewCompleted({ value: false })
							.catch(() => {})
							.finally(() => setShowWelcome(true))
					}
					variant="secondary">
					{t("debug.resetOnboarding")}
				</Button>
			</Section>
		</div>
	)
}

export default DebugSection
