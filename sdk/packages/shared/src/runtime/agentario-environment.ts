export const CLINE_ENVIRONMENT_ENV = "CLINE_ENVIRONMENT";
export const CLINE_ENVIRONMENT_OVERRIDE_ENV = "CLINE_ENVIRONMENT_OVERRIDE";

export type AgentarioEnvironment = "production" | "staging" | "local";

export interface AgentarioEnvironmentConfig {
	readonly environment: AgentarioEnvironment;
	readonly appBaseUrl: string;
	readonly apiBaseUrl: string;
	readonly mcpBaseUrl: string;
	readonly workOsClientId: string;
}

export const CLINE_ENVIRONMENTS: Readonly<
	Record<AgentarioEnvironment, AgentarioEnvironmentConfig>
> = {
	production: {
		environment: "production",
		appBaseUrl: "https://app.cline.bot",
		apiBaseUrl: "https://api.cline.bot",
		mcpBaseUrl: "https://api.cline.bot/v1/mcp",
		workOsClientId: "client_01K3A541FN8TA3EPPHTD2325AR",
	},
	staging: {
		environment: "staging",
		appBaseUrl: "https://staging-app.cline.bot",
		apiBaseUrl: "https://core-api.staging.int.cline.bot",
		mcpBaseUrl: "https://core-api.staging.int.cline.bot/v1/mcp",
		workOsClientId: "client_01K3A5415VF6QBQBG3XYCW91G6",
	},
	local: {
		environment: "local",
		appBaseUrl: "http://localhost:3000",
		apiBaseUrl: "http://localhost:7777",
		mcpBaseUrl: "http://localhost:7777/v1/mcp",
		workOsClientId: "client_01K6XQAY7JK6T5HXVSZW2S5VYK",
	},
};

export const DEFAULT_CLINE_ENVIRONMENT: AgentarioEnvironment = "production";

export interface ResolveAgentarioEnvironmentOptions {
	env?: Partial<NodeJS.ProcessEnv>;
}

function normalizeAgentarioEnvironment(
	value: string | undefined,
): AgentarioEnvironment | undefined {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === "production" ||
		normalized === "staging" ||
		normalized === "local"
	) {
		return normalized;
	}
	return undefined;
}

function readProcessEnv(): NodeJS.ProcessEnv {
	// `process` may be absent in browser-style runtimes (this module ships
	// from the browser entry of `@agentario/shared`). Treat its absence as "no
	// env vars set" so callers always get a deterministic default.
	if (typeof process === "undefined" || !process?.env) {
		return {};
	}
	return process.env;
}

export function resolveAgentarioEnvironment(): AgentarioEnvironment {
	const env = readProcessEnv();
	return (
		normalizeAgentarioEnvironment(env[CLINE_ENVIRONMENT_OVERRIDE_ENV]) ??
		normalizeAgentarioEnvironment(env[CLINE_ENVIRONMENT_ENV]) ??
		DEFAULT_CLINE_ENVIRONMENT
	);
}

function getEnvConfig(env?: AgentarioEnvironment) {
	if (typeof env === "string") {
		return CLINE_ENVIRONMENTS[env];
	}
	return CLINE_ENVIRONMENTS[resolveAgentarioEnvironment()];
}

function applyConfigOverrides(
	config: AgentarioEnvironmentConfig,
	env: NodeJS.ProcessEnv,
): AgentarioEnvironmentConfig {
	if (env.CLINE_API_BASE_URL) {
		config = {
			...config,
			apiBaseUrl: env.CLINE_API_BASE_URL,
			mcpBaseUrl: `${env.CLINE_API_BASE_URL}/v1/mcp`,
		};
	}

	return config;
}

export function getAgentarioEnvironmentConfig(
	env?: AgentarioEnvironment,
): AgentarioEnvironmentConfig {
	const config = getEnvConfig(env);

	return applyConfigOverrides(config, readProcessEnv());
}
