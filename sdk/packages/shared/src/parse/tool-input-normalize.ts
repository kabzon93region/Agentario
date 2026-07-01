/**
 * Normalizes tool inputs from local models that emit string literals
 * (e.g. "null") instead of JSON null or numbers.
 */

function coerceNullableNumber(value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === "" || trimmed === "null" || trimmed === "undefined" || trimmed === "none") {
			return undefined;
		}
		if (/^\d+$/.test(trimmed)) {
			return Number.parseInt(trimmed, 10);
		}
	}
	return value;
}

function isNullLikeString(value: unknown): boolean {
	return typeof value === "string" && ["null", "undefined", "none", ""].includes(value.trim().toLowerCase());
}

export function normalizeEditorToolInput(input: unknown): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}

	const record = { ...(input as Record<string, unknown>) };

	if ("insert_line" in record) {
		const coerced = coerceNullableNumber(record.insert_line);
		if (coerced === undefined) {
			delete record.insert_line;
		} else {
			record.insert_line = coerced;
		}
	}

	if (isNullLikeString(record.old_text)) {
		delete record.old_text;
	}

	return record;
}

export function normalizeToolInput(toolName: string, input: unknown): unknown {
	if (toolName === "editor") {
		return normalizeEditorToolInput(input);
	}
	return input;
}
