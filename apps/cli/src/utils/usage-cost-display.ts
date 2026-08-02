import { Llms } from "@agentario/core";

export function shouldShowCliUsageCost(providerId: string): boolean {
	return Llms.shouldShowProviderUsageCost(providerId);
}

export function shouldShowCliUsageCoveredBySubscription(
	providerId: string,
): boolean {
	return Llms.resolveProviderUsageCostDisplay(providerId) === "subscription";
}
