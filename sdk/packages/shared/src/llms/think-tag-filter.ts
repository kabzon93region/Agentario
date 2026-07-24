/**
 * Streaming-aware filter that detects inline reasoning tags (`<think>`, `<thinking>`,
 * `<reasoning>`, `<reflection>`) in text chunks and redirects that content to
 * reasoning-delta events instead of text-delta.
 *
 * Different models embed reasoning differently:
 * - DeepSeek R1: `<think>...</think>` in content
 * - Qwen QwQ: `<think>...</think>` in content
 * - Some OpenRouter models: `<thinking>...</thinking>`
 * - Some local models: no closing tag (thinking until end of response)
 *
 * This filter handles all these cases by maintaining a state machine across
 * chunks: it tracks whether we're currently inside a reasoning block and
 * strips/hides the tag delimiters themselves.
 *
 * The tag names detected are configurable but default to a broad set.
 */

/** Tag names that are recognised as reasoning/thinking delimiters. */
const REASONING_TAGS = ["think", "thinking", "reasoning", "reflection"] as const;

interface ReasoningTagState {
	/** True when we are currently inside a reasoning block (after opening tag). */
	insideReasoning: boolean;
	/** Buffer for partial tag detection across chunk boundaries. */
	pendingBuffer: string;
}

/**
 * Create a new stateful filter. One instance per streaming response.
 * The filter is NOT shared across requests.
 */
export function createThinkTagFilter() {
	const state: ReasoningTagState = {
		insideReasoning: false,
		pendingBuffer: "",
	};
	return {
		/**
		 * Process a text chunk. Returns arrays of text and reasoning segments
		 * that should be emitted. The tag delimiters themselves are consumed
		 * (not emitted in either output).
		 *
		 * Both arrays may be empty if the entire chunk was consumed by a
		 * partial tag match.
		 */
		processChunk(text: string): { textParts: string[]; reasoningParts: string[] } {
			if (!text) {
				return { textParts: [], reasoningParts: [] };
			}

			// Combine with any pending buffer from the previous chunk.
			const fullText = state.pendingBuffer + text;
			state.pendingBuffer = "";

			const textParts: string[] = [];
			const reasoningParts: string[] = [];

			let remaining = fullText;

			while (remaining.length > 0) {
				if (state.insideReasoning) {
					// Look for closing tag </tagname>
					const closeResult = findClosingTag(remaining);
					if (closeResult.found) {
						// Emit reasoning text before the closing tag
						const reasoningText = remaining.slice(0, closeResult.index);
						if (reasoningText) {
							reasoningParts.push(reasoningText);
						}
						// Skip past the closing tag
						remaining = remaining.slice(closeResult.index + closeResult.tagLength);
						state.insideReasoning = false;
						continue;
					}

					// Check if the end of remaining could be the start of a closing tag
					const partialClose = findPartialClosingTag(remaining);
					if (partialClose >= 0) {
						// Emit reasoning text before the partial tag
						const reasoningText = remaining.slice(0, partialClose);
						if (reasoningText) {
							reasoningParts.push(reasoningText);
						}
						state.pendingBuffer = remaining.slice(partialClose);
						break;
					}

					// No closing tag found — entire remaining is reasoning
					if (remaining) {
						reasoningParts.push(remaining);
					}
					remaining = "";
					break;
				} else {
					// Look for opening tag <tagname>
					const openResult = findOpeningTag(remaining);
					if (openResult.found) {
						// Emit text before the opening tag
						const textBefore = remaining.slice(0, openResult.index);
						if (textBefore) {
							textParts.push(textBefore);
						}
						// Skip past the opening tag
						remaining = remaining.slice(openResult.index + openResult.tagLength);
						state.insideReasoning = true;
						continue;
					}

					// Check if the end of remaining could be the start of an opening tag
					const partialOpen = findPartialOpeningTag(remaining);
					if (partialOpen >= 0) {
						// Emit text before the partial tag
						const textBefore = remaining.slice(0, partialOpen);
						if (textBefore) {
							textParts.push(textBefore);
						}
						state.pendingBuffer = remaining.slice(partialOpen);
						break;
					}

					// No tag found — entire remaining is text
					if (remaining) {
						textParts.push(remaining);
					}
					remaining = "";
					break;
				}
			}

			return { textParts, reasoningParts };
		},

		/**
		 * Call at the end of the stream. If we're still inside a reasoning block,
		 * returns the remaining buffered content as reasoning (some models never
		 * emit a closing tag).
		 */
		flush(): { textParts: string[]; reasoningParts: string[] } {
			const result = { textParts: [] as string[], reasoningParts: [] as string[] };
			if (state.pendingBuffer) {
				if (state.insideReasoning) {
					result.reasoningParts.push(state.pendingBuffer);
				} else {
					result.textParts.push(state.pendingBuffer);
				}
				state.pendingBuffer = "";
			}
			return result;
		},
	};
}

/** Build a regex to match opening tags: `<think>`, `<thinking>`, etc. */
function findOpeningTag(text: string): { found: true; index: number; tagLength: number } | { found: false } {
	for (const tag of REASONING_TAGS) {
		// Match <tag> optionally with whitespace: <tag >, < tag>
		const pattern = new RegExp(`<\\s*${tag}\\s*>`, "i");
		const match = pattern.exec(text);
		if (match) {
			return { found: true, index: match.index, tagLength: match[0].length };
		}
	}
	return { found: false };
}

/** Build a regex to match closing tags: `</think>`, `</thinking>`, etc. */
function findClosingTag(text: string): { found: true; index: number; tagLength: number } | { found: false } {
	for (const tag of REASONING_TAGS) {
		const pattern = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "i");
		const match = pattern.exec(text);
		if (match) {
			return { found: true, index: match.index, tagLength: match[0].length };
		}
	}
	return { found: false };
}

/**
 * Find the start index of a potential partial opening tag at the end of text.
 * Returns -1 if no partial match at the end.
 */
function findPartialOpeningTag(text: string): number {
	// Check if the text ends with something that could be the start of `<think>` etc.
	// We look for `<` optionally followed by partial tag name
	for (const tag of REASONING_TAGS) {
		for (let len = 1; len <= tag.length + 2; len++) {
			// Check patterns like `<`, `<t`, `<th`, ..., `<think`, `<think `
			const suffix = text.slice(-len);
			const prefix = `<${tag}>`.slice(0, len);
			const prefixAlt = `< ${tag}>`.slice(0, len);
			if (suffix.toLowerCase() === prefix.toLowerCase() || suffix.toLowerCase() === prefixAlt.toLowerCase()) {
				return text.length - len;
			}
		}
	}
	return -1;
}

/**
 * Find the start index of a potential partial closing tag at the end of text.
 * Returns -1 if no partial match at the end.
 */
function findPartialClosingTag(text: string): number {
	for (const tag of REASONING_TAGS) {
		for (let len = 2; len <= tag.length + 3; len++) {
			const suffix = text.slice(-len);
			const prefix = `</${tag}>`.slice(0, len);
			const prefixAlt = `< /${tag}>`.slice(0, len);
			if (suffix.toLowerCase() === prefix.toLowerCase() || suffix.toLowerCase() === prefixAlt.toLowerCase()) {
				return text.length - len;
			}
		}
	}
	return -1;
}
