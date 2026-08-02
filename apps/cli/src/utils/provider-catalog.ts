import {
	listLocalProviders as internalListLocalProviders,
	type ProviderSettingsManager,
} from "@agentario/core";
import { getCliFeatureFlagsService } from "./feature-flags";

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): ReturnType<typeof internalListLocalProviders> {
	return await internalListLocalProviders(manager, {
		isClinePassEnabled:
			getCliFeatureFlagsService().getBooleanFlagEnabled("ext-agentario-pass"),
	});
}
