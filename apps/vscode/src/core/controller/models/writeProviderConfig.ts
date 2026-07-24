import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/agentario/models"
import {
	type ProviderCatalogController,
	hasProviderCatalogStateController,
	parseProviderIdRequest,
	toProviderConfigPatch,
	toRedactedProviderConfigResponse,
} from "./providerCatalogShared"

export async function writeProviderConfig(
	controller: ProviderCatalogController,
	request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const store = controller.getProviderConfigStore()
	const updated = store.write(providerId, toProviderConfigPatch(request.patch))
	// Важно: без flush secrets/globalState могут не успеть записаться на диск до закрытия VS Code,
	// из-за чего после перезапуска "слетает" apiKey и часть настроек провайдера.
	if (hasProviderCatalogStateController(controller)) {
		await controller.stateManager.flushPendingState?.()
	}
	return toRedactedProviderConfigResponse(updated, store)
}
