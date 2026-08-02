import type { AgentarioMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import { AgentarioAuthStatus } from "@/components/account/AgentarioAuthStatus"
import CreditLimitError from "@/components/chat/CreditLimitError"
import EntitlementError from "@/components/chat/EntitlementError"
import OrgAgentarioPassRestrictionError from "@/components/chat/OrgAgentarioPassRestrictionError"
import SpendLimitError from "@/components/chat/SpendLimitError"
import { Button } from "@/components/ui/button"
import { t } from "@/i18n"
import { useClineAuth, useClineSignIn } from "@/context/AgentarioAuthContext"
import { AgentarioError, AgentarioErrorType } from "../../../../src/services/error/AgentarioError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: AgentarioMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

// Defensive helper: ensure message.text is always a string (never [object Object])
function ensureString(text: unknown): string {
	if (typeof text === "string") return text
	if (text === undefined || text === null) return ""
	if (text instanceof Error) return text.message
	if (typeof text === "object") {
		try { return JSON.stringify(text) } catch { return String(text) }
	}
	return String(text)
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { clineUser } = useClineAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: AgentarioError parsing should not be applied to non-Cline providers, but it seems we're using clineErrorMessage below in the default error display
					const parsedError = AgentarioError.parse(rawApiError)
					// _error.message can be a nested object (e.g. {code:400, message:"...", type:"..."})
					// when the original error is a plain object with a nested .error structure.
					// Extract the deepest string message to avoid rendering [object Object].
					const rawMsg = parsedError?._error?.message
					const extractedMessage =
						typeof rawMsg === "string"
							? rawMsg
							: typeof rawMsg === "object" && rawMsg !== null && typeof (rawMsg as Record<string, unknown>).message === "string"
								? ((rawMsg as Record<string, unknown>).message as string)
								: typeof parsedError?.message === "string"
									? parsedError.message
									: rawApiError
					const errorMessage = ensureString(extractedMessage)
					const requestId = parsedError?._error?.request_id
					const providerId = parsedError?.providerId || parsedError?._error?.providerId
					const isAgentarioProvider = providerId === "cline"
					const errorCode = parsedError?._error?.code

					if (parsedError?.isErrorType(AgentarioErrorType.Balance)) {
						const errorDetails = parsedError._error?.details
						if (isAgentarioProvider || errorDetails?.buy_credits_url) {
							return (
								<CreditLimitError
									buyCreditsUrl={errorDetails?.buy_credits_url}
									currentBalance={errorDetails?.current_balance}
									message={errorDetails?.message}
									totalPromotions={errorDetails?.total_promotions}
									totalSpent={errorDetails?.total_spent}
								/>
							)
						}
					}

					if (parsedError?.isErrorType(AgentarioErrorType.SpendLimit)) {
						const d = parsedError._error?.details
						return (
							<SpendLimitError
								budgetPeriod={d?.budget_period}
								limitUsd={d?.limit_usd}
								message={d?.message || errorMessage}
								resetsAt={d?.resets_at}
								spentUsd={d?.spent_usd}
							/>
						)
					}

					if (parsedError?.isErrorType(AgentarioErrorType.Entitlement)) {
						const detailMessage = parsedError?._error?.details?.message || errorMessage
						return <EntitlementError message={detailMessage} />
					}

					if (parsedError?.isErrorType(AgentarioErrorType.OrgAgentarioPassRestriction)) {
						return <OrgAgentarioPassRestrictionError />
					}

					if (parsedError?.isErrorType(AgentarioErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					if (parsedError?.isErrorType(AgentarioErrorType.QuotaExceeded)) {
						const detailMessage = parsedError?._error?.details?.message || errorMessage
						return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{detailMessage}</p>
					}

					if (parsedError?.isErrorType(AgentarioErrorType.Auth) && isAgentarioProvider) {
						return !clineUser ? (
							// User is using Cline provider and is not logged in
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-center rounded border border-neutral-500/30 bg-vscode-editor-background p-6 text-center text-vscode-foreground">
									Whoops looks like you're logged out – click below to sign in
								</div>
								<Button className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
									{t("common.signIn")}
									{isLoginLoading && (
										<span className="ml-1 animate-spin">
											<span className="codicon codicon-refresh" />
										</span>
									)}
								</Button>
								<AgentarioAuthStatus message={authStatusMessage} />
							</div>
						) : (
							// Don't show sign in button after the user has logged in, just ask them to retry
							<div className="mt-4">
								<span className="text-description">(Click "Retry" below)</span>
							</div>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the AgentarioError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a
										className="underline text-inherit"
										href="https://github.com/kabzon93region/Agentario/issues">
										troubleshooting guide
									</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}
						</p>
					)
				}

				// Regular error message — ensureString prevents [object Object]
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{ensureString(message.text)}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "clineignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							Agentario tried to access <code>{message.text}</code> which is blocked by the <code>.agentarioignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and clineignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "clineignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
