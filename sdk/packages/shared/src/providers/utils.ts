export function isAgentarioCloudProvider(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}
