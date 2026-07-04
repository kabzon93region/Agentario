import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Empty } from "@/shared/proto/cline/common"
import { CommitModelSelectionRequest } from "@/shared/proto/cline/models"
import { Logger } from "@/shared/services/Logger"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import { wasModelProfilePresetAppliedRecently } from "../state/modelProfilePresets"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseModeRequest,
	parseProviderIdRequest,
	toModelSelection,
} from "./providerCatalogShared"

export async function commitModelSelection(
	controller: ProviderCatalogController,
	request: CommitModelSelectionRequest,
): Promise<Empty> {
	if (
		hasProviderCatalogStateController(controller) &&
		wasModelProfilePresetAppliedRecently(controller.stateManager)
	) {
		Logger.log(
			`[commitModelSelection] Ignoring stale model commit (${request.providerId}/${request.mode}) — preset was applied recently`,
		)
		return Empty.create()
	}

	const providerId = parseProviderIdRequest(request.providerId)
	const mode = parseModeRequest(request.mode)
	const selection = toModelSelection(request, providerId)
	const previousApiConfiguration = hasProviderCatalogStateController(controller)
		? controller.stateManager.getApiConfiguration?.()
		: undefined
	controller.getProviderConfigStore().commitSelection(providerId, mode, selection)

	if (hasProviderCatalogStateController(controller)) {
		controller.stateManager.setGlobalStateBatch({
			[`${mode}ModeApiProvider`]: providerId,
			[getProviderModelIdKey(toLegacyApiProvider(providerId.toString()), mode)]: selection.modelId,
		})
		await controller.stateManager.flushPendingState?.()
		const nextApiConfiguration = controller.stateManager.getApiConfiguration?.()
		if (nextApiConfiguration) {
			controller.handleApiConfigurationChanged?.(previousApiConfiguration ?? {}, nextApiConfiguration)
		}
	}

	return Empty.create()
}
