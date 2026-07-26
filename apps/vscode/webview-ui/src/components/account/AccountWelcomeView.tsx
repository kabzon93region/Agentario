import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { AgentarioAuthStatus } from "@/components/account/AgentarioAuthStatus"
import { useClineSignIn } from "@/context/AgentarioAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { t } from "@/i18n"
import AgentarioLogoVariable from "../../assets/AgentarioLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<AgentarioLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<AgentarioLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				{t("common.signUp")}
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			<AgentarioAuthStatus message={authStatusMessage} />

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				By continuing, you agree to the <VSCodeLink href="https://github.com/kabzon93region/Agentario">Terms of Service</VSCodeLink> and{" "}
				<VSCodeLink href="https://github.com/kabzon93region/Agentario">Privacy Policy.</VSCodeLink>
			</p>
		</div>
	)
}
