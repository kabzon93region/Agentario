import { validateWithZod } from "@agentario/shared";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
	RunCommandsInputUnionSchema,
	type StructuredCommandInput,
	validateShellCommandString,
} from "./schemas";

/**
 * Format an error into a string message
 */
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function getEditorSizeError(input: EditFileInput): string | null {
	// old_text limit: 6000 chars (search/replace should be small for accuracy)
	if (
		typeof input.old_text === "string" &&
		input.old_text.length > INPUT_ARG_CHAR_LIMIT
	) {
		return `Editor input too large: old_text was ${input.old_text.length} characters, exceeding the recommended limit of ${INPUT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls so later tool calls are less likely to be truncated or time out.`;
	}

	// new_text limit: 50000 chars (file creation can be large; increased from 6000 to allow
	// creating substantial files in a single operation. Models can generate 10-30k chars
	// of code, and blocking file creation forces them to fabricate success messages.)
	const NEW_TEXT_CHAR_LIMIT = 50000;
	if (input.new_text.length > NEW_TEXT_CHAR_LIMIT) {
		return `Editor input too large: new_text was ${input.new_text.length} characters, exceeding the recommended limit of ${NEW_TEXT_CHAR_LIMIT}. Split the operation into smaller tool calls.`;
	}

	return null;
}

/**
 * Create a timeout-wrapped promise
 */
export class TimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(message: string, timeoutMs: number) {
		super(message);
		this.name = "TimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new TimeoutError(message, ms)), ms);
		}),
	]);
}

export function formatReadFileQuery(request: ReadFileRequest): string {
	const { path, start_line, end_line } = request;
	if (start_line == null && end_line == null) {
		return path;
	}
	const start = start_line ?? 1;
	const end = end_line ?? "EOF";
	return `${path}:${start}-${end}`;
}

export function getReadFileRangeError(request: ReadFileRequest): string | null {
	const { start_line, end_line } = request;
	if (start_line == null || end_line == null || start_line <= end_line) {
		return null;
	}

	return `start_line must be less than or equal to end_line (received start_line: ${start_line}, end_line: ${end_line})`;
}

export function normalizeRunCommandsInput(
	input: unknown,
): Array<string | StructuredCommandInput> {
	const validate = validateWithZod(RunCommandsInputUnionSchema, input);

	let commands: Array<string | StructuredCommandInput>;

	if (typeof validate === "string") {
		commands = [validate];
	} else if (Array.isArray(validate)) {
		commands = validate;
	} else if ("commands" in validate) {
		commands = Array.isArray(validate.commands)
			? validate.commands
			: [validate.commands];
	} else if ("command" in validate) {
		commands = "args" in validate ? [validate] : [validate.command];
	} else if ("cmd" in validate) {
		commands = [validate.cmd];
	} else {
		commands = [validate];
	}

	for (const command of commands) {
		const text =
			typeof command === "string"
				? unwrapShellCommandString(command)
				: formatRunCommandQuery(command);
		const syntaxError = validateShellCommandString(text);
		if (syntaxError) {
			throw new Error(syntaxError);
		}
	}

	// Unwrap quoted command strings so PowerShell does not echo literals.
	return commands.map((command) => {
		if (typeof command === "string") {
			return unwrapShellCommandString(command);
		}
		return {
			...command,
			command: unwrapShellCommandString(command.command),
		};
	});
}

export function formatRunCommandQuery(
	command: string | StructuredCommandInput,
): string {
	if (typeof command === "string") {
		return unwrapShellCommandString(command);
	}

	const args = command.args ?? [];
	const base = unwrapShellCommandString(command.command);
	if (args.length === 0) {
		return base;
	}

	const renderedArgs = args.map((arg) =>
		/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg,
	);
	return `${base} ${renderedArgs.join(" ")}`;
}

/**
 * Local models often wrap the whole command in quotes ('git status'), which
 * PowerShell evaluates as a string literal instead of running the command.
 */
export function unwrapShellCommandString(command: string): string {
	const trimmed = command.trim();
	if (trimmed.length < 2) {
		return command;
	}
	const q = trimmed[0];
	if ((q === "'" || q === '"') && trimmed.endsWith(q)) {
		const inner = trimmed.slice(1, -1).trim();
		if (
			inner.length > 0 &&
			!inner.includes(q) &&
			/^(git|gh|npm|bun|node|python|py|dotnet|cargo|go|make|cmake|cd|Get-|Set-|Remove-|New-|Test-|Write-|Select-|Where-|ForEach-|\$)/i.test(
				inner,
			)
		) {
			return inner;
		}
	}
	return command;
}

/** Reject shell listing / file-read shortcuts — use index tools + read_files instead. */
export function getShellDiscoveryOrReadBypassError(
	command: string | StructuredCommandInput,
): string | null {
	const text = formatRunCommandQuery(command);
	if (/&&/.test(text) && process.platform === "win32") {
		return (
			"PowerShell does not support '&&'. Pass each command separately in the commands array, " +
			"or use ';' inside one PowerShell script. Do not retry the same shell command."
		);
	}
	if (/\b(Get-ChildItem|gci|\bls\b|\bdir\b|\btree\b|Find-ChildItem)\b/i.test(text)) {
		return (
			"Do not list directories via shell (Get-ChildItem/ls/dir). " +
			"Use paths you already know (from git status / prior reads): e.g. rules.md, convert.py, *.py in cwd. " +
			"Call read_files or attempt_completion — do NOT retry listing."
		);
	}
	if (
		/\b(Get-Content|\bgc\b|\bcat\b|\btype\b|\bhead\b|\btail\b)\b/i.test(text) &&
		/\.(md|markdown|txt|py|ts|tsx|js|jsx|json|yml|yaml|toml|cfg|ini|log|cs|cpp|h|rs|go)\b/i.test(
			text,
		)
	) {
		return (
			"Do not read source/docs via shell (Get-Content/cat/type). Use read_files(path, start_line, end_line). " +
			"If you already read the file, call attempt_completion instead of retrying."
		);
	}
	return null;
}

/**
 * Max characters of the executed command echoed back in the tool result's
 * `query` field. The full command already exists in the assistant tool-call
 * input, so repeating it in the result only duplicates tokens in the
 * provider request (expensive for large heredoc/file-generation commands).
 */
export const RUN_COMMAND_QUERY_PREVIEW_LIMIT = 200;

/**
 * Bound the command echo placed in a provider-facing tool result.
 * Short commands pass through unchanged; long commands keep a short
 * prefix plus a truncation note so the result is still identifiable.
 */
export function formatRunCommandQueryPreview(
	command: string | StructuredCommandInput,
): string {
	const rendered = formatRunCommandQuery(command);
	if (rendered.length <= RUN_COMMAND_QUERY_PREVIEW_LIMIT) {
		return rendered;
	}
	const truncatedChars = rendered.length - RUN_COMMAND_QUERY_PREVIEW_LIMIT;
	return `${rendered.slice(0, RUN_COMMAND_QUERY_PREVIEW_LIMIT)} ... [command truncated: ${truncatedChars} more chars; full command is in the tool call input]`;
}
