import { EmptyRequest } from "@shared/proto/cline/common"
import { Button } from "@/components/ui/button"
import { isStandaloneEnvironment } from "@/constants/standalone"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

const AgentarioMaintenanceSection = () => {
	const { environment } = useExtensionState()

	if (!isStandaloneEnvironment(environment)) {
		return null
	}

	return (
		<Section>
			<h3 className="text-md font-medium mb-1">{t("general.agentarioMaintenanceTitle")}</h3>
			<p className="text-sm text-description mb-3">{t("general.agentarioResetHint")}</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				<Button
					onClick={async () => {
						try {
							await StateServiceClient.resetAgentario(EmptyRequest.create({}))
						} catch (error) {
							console.error("Failed to reset Agentario:", error)
						}
					}}
					variant="error">
					{t("general.agentarioReset")}
				</Button>
				<Button
					onClick={async () => {
						try {
							await StateServiceClient.openAgentarioLogsFolder(EmptyRequest.create({}))
						} catch (error) {
							console.error("Failed to open logs folder:", error)
						}
					}}
					variant="secondary">
					{t("general.agentarioOpenLogs")}
				</Button>
			</div>
			<p className="text-xs mt-2 text-description">{t("general.agentarioLogsHint")}</p>
		</Section>
	)
}

export default AgentarioMaintenanceSection
