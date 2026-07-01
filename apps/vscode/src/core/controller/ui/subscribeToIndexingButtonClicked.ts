import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

const activeIndexingButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

export async function subscribeToIndexingButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	activeIndexingButtonClickedSubscriptions.add(responseStream)

	const cleanup = () => {
		activeIndexingButtonClickedSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "indexingButtonClicked_subscription" },
			responseStream,
		)
	}
}

export async function sendIndexingButtonClickedEvent(): Promise<void> {
	const promises = Array.from(activeIndexingButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(Empty.create({}), false)
		} catch (error) {
			Logger.error("Error sending indexingButtonClicked event:", error)
			activeIndexingButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
