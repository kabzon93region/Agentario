import { Environment } from "@shared/config-types"

/** Providers that require Cline cloud account or OAuth — hidden in Agentario standalone mode. */
export const AGENTARIO_CLOUD_PROVIDER_IDS = new Set(["cline", "cline-pass"])

export function isStandaloneEnvironment(environment: Environment | string | undefined): boolean {
	return environment === Environment.selfHosted || environment === "selfHosted"
}
