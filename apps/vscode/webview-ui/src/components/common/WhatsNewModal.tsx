import { BannerAction, BannerCardData } from "@shared/agentario/banner"
import React from "react"
import { useMount } from "react-use"
import GitHubIcon from "@/assets/GitHubIcon"
import WhatsNewItems from "@/components/common/WhatsNewItems"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"

const AGENTARIO_REPO = "https://github.com/kabzon93region/Agentario"

interface WhatsNewModalProps {
	open: boolean
	onClose: () => void
	version: string
	welcomeBanners?: BannerCardData[]
	onBannerAction?: (action: BannerAction) => void
}

const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ open, onClose, version, welcomeBanners, onBannerAction }) => {
	const { refreshOpenRouterModels } = useExtensionState()

	// Get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	const inlineCodeStyle: React.CSSProperties = {
		backgroundColor: "var(--vscode-textCodeBlock-background)",
		padding: "2px 6px",
		borderRadius: "3px",
		fontFamily: "var(--vscode-editor-font-family)",
		fontSize: "0.9em",
	}

	return (
		<Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
			<DialogContent
				aria-describedby="whats-new-description"
				aria-labelledby="whats-new-title"
				className="pt-5 px-5 pb-4 gap-0">
				<div id="whats-new-description">
					<h2
						className="text-lg font-semibold mb-3 pr-6"
						id="whats-new-title"
						style={{ color: "var(--vscode-editor-foreground)" }}>
						🎉 New in v{version}
					</h2>

					<WhatsNewItems
						inlineCodeStyle={inlineCodeStyle}
						onBannerAction={onBannerAction}
						onClose={onClose}
						welcomeBanners={welcomeBanners}
					/>

					<div className="flex flex-col items-center gap-3 mt-4 pt-4 border-t border-[var(--vscode-widget-border)]">
						<div className="flex items-center gap-4">
							<a
								aria-label="Star us on GitHub"
								className="text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] transition-colors"
								href={AGENTARIO_REPO}
								rel="noopener noreferrer"
								target="_blank">
								<GitHubIcon />
							</a>
						</div>

						<p className="text-sm text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>
							Please support Agentario by{" "}
							<a
								href={AGENTARIO_REPO}
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								starring us on GitHub
							</a>
							.
						</p>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default WhatsNewModal
