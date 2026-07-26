/**
 * Normalizes tool inputs from local models that emit string literals
 * (e.g. "null") instead of JSON null or numbers, and stringified JSON arrays
 * with Windows-path / EOF quirks (LM Studio / Llama).
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
		if (
			trimmed === "" ||
			trimmed === "null" ||
			trimmed === "undefined" ||
			trimmed === "none" ||
			trimmed === "eof"
		) {
			return undefined;
		}
		if (/^\d+$/.test(trimmed)) {
			return Number.parseInt(trimmed, 10);
		}
	}
	return value;
}

function isNullLikeString(value: unknown): boolean {
	return (
		typeof value === "string" &&
		["null", "undefined", "none", "", "eof"].includes(value.trim().toLowerCase())
	);
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

function repairEofTokens(raw: string): string {
	return raw
		.replace(/:\s*EOF\b/gi, ": null")
		.replace(/:\s*None\b/gi, ": null")
		.replace(/:\s*undefined\b/gi, ": null")
		.replace(/,\s*]/g, "]")
		.replace(/,\s*}/g, "}");
}

/**
 * Local models often put Windows paths with single backslashes inside a
 * stringified JSON array. JSON then treats \t/\r as TAB/CR ("s:" + tab +
 * "emo" + CR + "ules.md"). Escape those only in the repair pass used after a
 * normal parse fails.
 */
function escapeWindowsPathBackslashes(raw: string): string {
	return raw
		.replace(/\\([bfnrt])/g, "\\\\$1")
		.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

function tryParseJsonArrayOnce(raw: string): unknown[] | undefined {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed;
		}
	} catch {
		// ignore
	}
	return undefined;
}

/**
 * Attempts to parse a string as a JSON array (with local-model repairs).
 */
function arrayHasControlChars(value: unknown): boolean {
	if (typeof value === "string") {
		return /[\u0000-\u001F]/.test(value);
	}
	if (Array.isArray(value)) {
		return value.some(arrayHasControlChars);
	}
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).some(arrayHasControlChars);
	}
	return false;
}

export function tryParseJsonArray(value: string): unknown[] | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[")) {
		return undefined;
	}
	const eofFixed = repairEofTokens(trimmed);
	const fromPlain =
		tryParseJsonArrayOnce(eofFixed) ?? tryParseJsonArrayOnce(trimmed);
	const fromEscaped = tryParseJsonArrayOnce(
		escapeWindowsPathBackslashes(eofFixed),
	);
	// Prefer escaped parse when plain parse ate Windows \t/\r as control chars.
	if (fromEscaped && (!fromPlain || arrayHasControlChars(fromPlain))) {
		return fromEscaped;
	}
	return fromPlain ?? fromEscaped;
}

/** Fix control chars if a broken path still slipped through. */
export function sanitizeToolPath(pathValue: unknown): unknown {
	if (typeof pathValue !== "string") {
		return pathValue;
	}
	if (!/[\u0000-\u001F]/.test(pathValue)) {
		return pathValue;
	}
	const withoutControls = pathValue.replace(/[\u0000-\u001F]+/g, "");
	const base = withoutControls.replace(/^.*[/\\]/, "").trim();
	if (base.length > 0 && base !== withoutControls) {
		return base;
	}
	const fileLike = withoutControls.match(/[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/);
	if (fileLike) {
		return fileLike[0];
	}
	return withoutControls || pathValue;
}

function normalizeReadFileEntry(entry: unknown): unknown {
	if (typeof entry === "string") {
		return { path: sanitizeToolPath(entry) };
	}
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		return entry;
	}
	const record = { ...(entry as Record<string, unknown>) };
	if ("path" in record) {
		record.path = sanitizeToolPath(record.path);
	}
	for (const key of ["start_line", "end_line"] as const) {
		if (!(key in record)) continue;
		const coerced = coerceNullableNumber(record[key]);
		if (coerced === undefined || coerced === null) {
			delete record[key];
		} else {
			record[key] = coerced;
		}
	}
	return record;
}

function normalizeArrayFields(input: unknown, fields: string[]): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const record = { ...(input as Record<string, unknown>) };
	let changed = false;
	for (const field of fields) {
		if (typeof record[field] === "string") {
			const parsed = tryParseJsonArray(record[field] as string);
			if (parsed !== undefined) {
				record[field] = parsed;
				changed = true;
			}
		}
	}
	return changed ? record : input;
}

function normalizeReadFilesInput(input: unknown): unknown {
	const result = normalizeArrayFields(input, ["files"]);
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		return result;
	}
	const record = { ...(result as Record<string, unknown>) };
	if (Array.isArray(record.files)) {
		record.files = record.files.map(normalizeReadFileEntry);
		return record;
	}
	return result;
}

const ARRAY_FIELD_TOOLS: Record<string, string[]> = {
	read_files: ["files"],
	fetch_web_content: ["requests"],
	run_commands: ["commands"],
	search_codebase: ["queries"],
	semantic_search: ["queries"],
};

function normalizeAttemptCompletionInput(input: unknown): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const record = { ...(input as Record<string, unknown>) };
	// Local models often send command: null; JSON Schema type:string then rejects the whole call.
	if (record.command === null || record.command === undefined || isNullLikeString(record.command)) {
		delete record.command;
	}
	if (typeof record.command === "string" && record.command.trim() === "") {
		delete record.command;
	}
	return record;
}

export function normalizeToolInput(toolName: string, input: unknown): unknown {
	let result = input;

	if (toolName === "read_files" || toolName === "read_file") {
		return normalizeReadFilesInput(result);
	}

	if (toolName === "search_codebase" || toolName === "search_files") {
		return normalizeArrayFields(result, ["queries"]);
	}

	const arrayFields = ARRAY_FIELD_TOOLS[toolName];
	if (arrayFields) {
		result = normalizeArrayFields(result, arrayFields);
	}

	if (toolName === "editor") {
		result = normalizeEditorToolInput(result);
	}

	if (toolName === "attempt_completion" || toolName === "submit_and_exit") {
		result = normalizeAttemptCompletionInput(result);
	}

	return result;
}
