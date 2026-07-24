import { StringRequest, String } from "@/shared/proto/index.agentario"
import { Controller } from "../index"

export const openCompactionDebugFile = async (
	request: StringRequest,
	controller: Controller,
): Promise<String> => {
	return { value: "" }
}