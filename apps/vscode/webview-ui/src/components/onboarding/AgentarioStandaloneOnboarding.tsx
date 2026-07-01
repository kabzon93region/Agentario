import { BooleanRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const AgentarioStandaloneOnboarding = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		setIsSubmitting(true)
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to complete welcome view:", error)
		} finally {
			setIsSubmitting(false)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto flex flex-col gap-2.5">
				<h2 className="text-lg font-semibold">Добро пожаловать в Agentario</h2>
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					Agentario работает автономно: локальные модели через LM Studio или Ollama. Интернет и аккаунт Cline не
					нужны.
				</p>
				<p className="text-(--vscode-descriptionForeground)">
					Запустите LM Studio, включите Local Server (по умолчанию http://127.0.0.1:1234), выберите модель и нажмите
					«Начать».
				</p>
				<div className="mt-4">
					<ApiOptions currentMode={mode} showModelOptions={true} />
					<VSCodeButton className="mt-3 w-full" disabled={disableLetsGoButton || isSubmitting} onClick={handleSubmit}>
						{t("welcome.letsGo")}
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
})

export default AgentarioStandaloneOnboarding
