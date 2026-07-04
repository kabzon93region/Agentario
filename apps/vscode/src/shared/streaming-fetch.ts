import { Agent, fetch as undiciFetch } from "undici"

type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = Parameters<typeof globalThis.fetch>[1]

/**
 * Wraps fetch with undici Agent timeouts. Node's built-in fetch uses undici
 * defaults (bodyTimeout/headersTimeout ≈ 300s), which cuts off slow local LLM
 * streams even when the UI timeout is set higher (e.g. 600000 ms).
 *
 * Pass `0` to disable a limit (undici convention).
 */
export function createFetchWithStreamingTimeouts(options?: {
	bodyTimeoutMs?: number
	headersTimeoutMs?: number
}): typeof globalThis.fetch {
	const bodyTimeout = options?.bodyTimeoutMs ?? 0
	const headersTimeout = options?.headersTimeoutMs ?? 0
	const agent = new Agent({ bodyTimeout, headersTimeout })

	return ((input: FetchInput, init?: FetchInit) =>
		undiciFetch(input as string, {
			...(init ?? {}),
			dispatcher: agent,
		} as Parameters<typeof undiciFetch>[1])) as typeof globalThis.fetch
}
