export interface WebviewMessage {
	type: "grpc_request" | "grpc_request_cancel" | "lab_api_request"
	grpc_request?: GrpcRequest
	grpc_request_cancel?: GrpcCancel
	lab_api_request?: LabApiRequest
}

export type GrpcRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type GrpcCancel = {
	request_id: string // ID of the request to cancel
}

export type LabApiRequest = {
	request_id: string
	path: string // e.g. "/health"
	method?: string // default GET
	body?: any
}

export type AgentarioAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type AgentarioCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
