import {
	getClineOrgIndividualInferenceSubscriptionMessage,
	isAgentarioCloudNotSubscribedMessage,
	isAgentarioCloudOrgSubscriptionMessage,
} from "@agentario/llms"
import { serializeError } from "serialize-error"
import { AGENTARIO_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/AgentarioAccount"

export enum AgentarioErrorType {
	Auth = "auth",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	Entitlement = "entitlement",
	OrgAgentarioPassRestriction = "orgAgentarioPassRestriction",
}

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

export class AgentarioError extends Error {
	readonly title = "AgentarioError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// Cline: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public readonly modelId?: string,
		public readonly providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || error?.response?.message || (typeof error?.error === "object" && error.error?.message) || String(error) || error?.cause?.means
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status
		this.modelId = modelId || error.modelId
		this.providerId = providerId || error.providerId

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			...error,
			message: raw.message || message,
			status,
			request_id:
				error.error?.request_id ||
				error.request_id ||
				error.response?.request_id ||
				error.response?.headers?.["x-request-id"],
			code: error.code || error?.cause?.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: error.details || error.error, // Additional details provided by the server
			stack: undefined, // Avoid serializing stack trace to keep the error object clean
		}
	}

	/**
	 *  Serializes the error to a JSON string that allows for easy transmission and storage.
	 *  This is useful for logging or sending error details to a webviews.
	 */
	public serialize(): string {
		return JSON.stringify({
			message: this.message,
			status: this._error.status,
			request_id: this._error.request_id,
			code: this._error.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: this._error.details,
		})
	}

	/**
	 * Parses a stringified error into a AgentarioError instance.
	 */
	static parse(errorStr?: string, modelId?: string): AgentarioError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return AgentarioError.transform(errorStr, modelId)
	}

	/**
	 * Transforms any object into a AgentarioError instance.
	 * Always returns a AgentarioError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): AgentarioError {
		try {
			// If already a AgentarioError, return it directly to prevent infinite recursion
			if (error instanceof AgentarioError) {
				return error
			}
			return new AgentarioError(JSON.parse(error), modelId, providerId)
		} catch {
			return new AgentarioError(error, modelId, providerId)
		}
	}

	public isErrorType(type: AgentarioErrorType): boolean {
		return AgentarioError.getErrorType(this) === type
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: AgentarioError): AgentarioErrorType | undefined {
		const { code, status, details } = err._error
		const rawMessage = err._error?.message || err.message || JSON.stringify(err._error)
		const message = rawMessage?.toLowerCase()
		const detailMessage = typeof details?.message === "string" ? details.message : undefined

		// Check balance error first (most specific)
		if (code === "insufficient_credits" && typeof details?.current_balance === "number") {
			return AgentarioErrorType.Balance
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (code === "SPEND_LIMIT_EXCEEDED" || details?.code === "SPEND_LIMIT_EXCEEDED") {
			return AgentarioErrorType.SpendLimit
		}

		if (
			rawMessage === getClineOrgIndividualInferenceSubscriptionMessage() ||
			(detailMessage ? isAgentarioCloudOrgSubscriptionMessage(detailMessage) : false) ||
			(rawMessage ? isAgentarioCloudOrgSubscriptionMessage(rawMessage) : false)
		) {
			return AgentarioErrorType.OrgAgentarioPassRestriction
		}

		if (
			(detailMessage ? isAgentarioCloudNotSubscribedMessage(detailMessage) : false) ||
			(rawMessage ? isAgentarioCloudNotSubscribedMessage(rawMessage) : false)
		) {
			return AgentarioErrorType.Entitlement
		}

		// Check auth errors
		const isAuthStatus = status !== undefined && status > 400 && status < 429
		if (code === "ERR_BAD_REQUEST" || err instanceof AuthInvalidTokenError || isAuthStatus) {
			return AgentarioErrorType.Auth
		}

		if (code === "INFERENCE_CAP_ERROR") {
			return AgentarioErrorType.QuotaExceeded
		}

		if (message) {
			// Check for specific error codes/messages if applicable
			const authErrorRegex = [/(?:in)?valid[-_ ]?(?:api )?(?:token|key)/i, /authentication[-_ ]?failed/i, /unauthorized/i]
			if (message?.includes(AGENTARIO_ACCOUNT_AUTH_ERROR_MESSAGE) || authErrorRegex.some((regex) => regex.test(message))) {
				return AgentarioErrorType.Auth
			}

			// Check rate limit patterns
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return AgentarioErrorType.RateLimit
			}
		}

		return undefined
	}
}

class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = AgentarioErrorType.Auth
	}
}
