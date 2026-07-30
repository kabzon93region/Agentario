import { createHandlerAsync, type ProviderConfig } from "@agentario/llms"

const SUMMARIZER_TIMEOUT_MS = 45_000
const MAX_PREVIEW_CHARS = 6_000

export type LargeFileSummarizerInput = {
	path: string
	sizeBytes: number
	totalLines: number
	preview: string
	outlineText: string
}

export function createLargeFileSummarizer(
	providerConfig: ProviderConfig,
): (input: LargeFileSummarizerInput) => Promise<string> {
	return async (input) => {
		const previewExcerpt =
			input.preview.length > MAX_PREVIEW_CHARS
				? `${input.preview.slice(0, MAX_PREVIEW_CHARS)}\n...[обрезано, всего ${input.preview.length} символов]`
				: input.preview

		const request = [
			"Кратко опиши назначение файла и ключевые части на русском языке (150–250 слов максимум).",
			"Отвечай только текстом саммари, без markdown-обёрток и без рассуждений.",
			"",
			`Путь: ${input.path}`,
			`Размер: ${input.sizeBytes} байт, строк: ${input.totalLines}`,
			input.outlineText.trim() ? `\nOutline:\n${input.outlineText.trim()}` : "",
			`\nПревью (начало файла):\n${previewExcerpt}`,
		]
			.filter(Boolean)
			.join("\n")

		const handler = await createHandlerAsync(providerConfig)
		let text = ""
		let settled = false

		const summaryPromise = (async () => {
			for await (const chunk of handler.createMessage("", [{ role: "user", content: request }])) {
				const chunkAny = chunk as { type?: string; text?: string; success?: boolean; error?: unknown }
				if (chunkAny.type === "text" || chunkAny.type === "text-delta") {
					text += chunkAny.text ?? ""
					continue
				}
				if (chunkAny.type === "done" && chunkAny.success === false && chunkAny.error) {
					throw new Error(
						typeof chunkAny.error === "string"
							? chunkAny.error
							: JSON.stringify(chunkAny.error),
					)
				}
			}
			const trimmed = text.trim()
			if (!trimmed) {
				throw new Error("Large file summarizer returned empty response")
			}
			settled = true
			return trimmed
		})()

		const timeoutPromise = new Promise<string>((_, reject) => {
			setTimeout(() => {
				if (!settled) {
					reject(new Error("Large file summarization timed out"))
				}
			}, SUMMARIZER_TIMEOUT_MS)
		})

		return Promise.race([summaryPromise, timeoutPromise])
	}
}
