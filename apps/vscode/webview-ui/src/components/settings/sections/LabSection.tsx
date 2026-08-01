import { memo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import Section from "../Section"
import { updateSettingsPatch } from "../utils/settingsHandlers"

function labApiFetch(apiPath: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const requestId = `lab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const timeout = setTimeout(() => {
			window.removeEventListener("message", handler)
			reject(new Error("timeout"))
		}, 5000)
		function handler(event: MessageEvent) {
			const msg = event.data
			if (msg?.type === "lab_api_response" && msg.lab_api_response?.request_id === requestId) {
				clearTimeout(timeout)
				window.removeEventListener("message", handler)
				if (msg.lab_api_response.error) {
					reject(new Error(msg.lab_api_response.error))
				} else {
					resolve(msg.lab_api_response.data)
				}
			}
		}
		window.addEventListener("message", handler)
		PLATFORM_CONFIG.postMessage({
			type: "lab_api_request",
			lab_api_request: { request_id: requestId, path: apiPath },
		})
	})
}

interface LabSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const LabSection = ({ renderSectionHeader }: LabSectionProps) => {
	const { labApiEnabled, labApiPort, labClineDir } = useExtensionState()
	const [portInput, setPortInput] = useState(String(labApiPort || 19231))
	const [clineDirInput, setClineDirInput] = useState(labClineDir || "")
	const [apiStatus, setApiStatus] = useState<string | null>(null)
	const [testing, setTesting] = useState(false)

	const handleToggle = (enabled: boolean) => {
		updateSettingsPatch({ labApiEnabled: enabled })
	}

	const handlePortChange = () => {
		const port = parseInt(portInput)
		if (port > 0 && port < 65536) {
			updateSettingsPatch({ labApiPort: port })
		}
	}

	const handleClineDirChange = () => {
		updateSettingsPatch({ labClineDir: clineDirInput.trim() })
	}

	const testConnection = async () => {
		setTesting(true)
		setApiStatus(null)
		try {
			const data = await labApiFetch("/health")
			setApiStatus(`OK — v${data.version}, port ${data.port}`)
		} catch (err: any) {
			setApiStatus(`${t("lab.unavailable")}: ${err.message || "connection refused"}`)
		} finally {
			setTesting(false)
		}
	}

	return (
		<div>
			{renderSectionHeader("lab")}
			<Section>
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<div className="flex flex-col">
							<Label className="text-sm font-medium">{t("lab.enableApiServer")}</Label>
							<p className="text-xs text-(--vscode-descriptionForeground)">{t("lab.enableApiDesc")}</p>
						</div>
						<Switch checked={!!labApiEnabled} onCheckedChange={handleToggle} />
					</div>

					{labApiEnabled && (
						<>
							<div className="flex flex-col gap-1.5">
								<Label className="text-sm">{t("lab.port")}</Label>
								<div className="flex gap-2">
									<Input
										type="number"
										value={portInput}
										onChange={(e) => setPortInput(e.target.value)}
										onBlur={handlePortChange}
										onKeyDown={(e) => e.key === "Enter" && handlePortChange()}
										className="w-32"
										min={1}
										max={65535}
									/>
									<span className="text-xs self-center text-(--vscode-descriptionForeground)">
										http://127.0.0.1:{labApiPort || 19231}
									</span>
								</div>
							</div>

							<div className="flex flex-col gap-1.5">
								<Label className="text-sm">{t("lab.clineDir")}</Label>
								<Input
									value={clineDirInput}
									onChange={(e) => setClineDirInput(e.target.value)}
									onBlur={handleClineDirChange}
									onKeyDown={(e) => e.key === "Enter" && handleClineDirChange()}
									placeholder="C:\Users\Admin\.agentario-lab"
									className="w-full"
								/>
								<p className="text-xs text-(--vscode-descriptionForeground)">{t("lab.clineDirDesc")}</p>
							</div>

							<div className="flex flex-col gap-2">
								<Button onClick={testConnection} disabled={testing} variant="secondary" className="w-fit">
									{testing ? t("lab.testing") : t("lab.testConnection")}
								</Button>
								{apiStatus && (
									<p className={`text-xs ${apiStatus.startsWith("OK") ? "text-green-500" : "text-red-500"}`}>
										{apiStatus}
									</p>
								)}
							</div>

							<div className="mt-2 p-3 rounded bg-(--vscode-editor-inactiveSelectionBackground)">
								<p className="text-xs text-(--vscode-descriptionForeground) whitespace-pre-line">
									{t("lab.howToUse")}
								</p>
							</div>
						</>
					)}
				</div>
			</Section>
		</div>
	)
}

export default memo(LabSection)
