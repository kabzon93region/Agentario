/**
 * File Read Executor
 *
 * Built-in implementation for reading files using Node.js fs module.
 */

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import type { AgentToolContext } from "@agentario/shared";
import { resolveExistingFilePath } from "@agentario/shared/storage";
import type { ReadFileRequest } from "../schemas";
import type { FileReadExecutor } from "../types";
import { formatAstOutline, parseFileWithTreeSitter } from "./ast-navigator";
import {
	MAX_LINE_CHARS,
	MAX_READ_LINES,
	MAX_READ_OUTPUT_CHARS,
} from "./output-limits";

const IMAGE_MEDIA_TYPES = new Map<string, string>([
	[".gif", "image/gif"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
]);

/**
 * Options for the file read executor
 */
export interface FileReadExecutorOptions {
	/**
	 * Maximum file size to read in bytes
	 * @default 10_000_000 (10MB)
	 */
	maxFileSizeBytes?: number;

	/**
	 * File encoding
	 * @default "utf-8"
	 */
	encoding?: BufferEncoding;

	/**
	 * Whether to include line numbers in output
	 * @default false
	 */
	includeLineNumbers?: boolean;
}

const DEFAULT_FILE_READ_OPTIONS: Required<FileReadExecutorOptions> = {
	maxFileSizeBytes: 10_000_000, // 10MB default limit
	encoding: "utf-8", // Default to UTF-8 encoding
	includeLineNumbers: true, // Include line numbers by default
};

const MAX_TEXT_STREAM_BYTES = 100_000_000;
const MAX_UNRANGED_LINE_SCAN = 50_000;
// Agentario: auto-chunk large files when no line range is specified
const AUTO_CHUNK_SIZE_BYTES = 50_000; // ~50KB threshold for auto-chunking
const AUTO_CHUNK_LINES = 200; // Read only first N lines for large files
// Agentario: Smart Chunked Navigation — regex outline limits
const OUTLINE_MAX_ENTRIES = 100; // Max signatures in outline

/**
 * Regex patterns for extracting code structure (functions, classes, etc.)
 * Supports: TypeScript, JavaScript, Python, Rust, Go, Java, C#, PHP, Ruby, Kotlin, Swift
 */
const STRUCTURE_PATTERNS = {
	functions: [
		// TypeScript/JavaScript: function name(, async function name(
		/(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
		// TypeScript/JavaScript: const name = (, const name = async (
		/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
		// Python: def name(
		/(?:async\s+)?def\s+(\w+)/,
		// Rust: fn name(, pub fn name(, pub(crate) fn name(
		/(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/,
		// Go: func name(, func (receiver) name(
		/func\s+(?:\([^)]*\)\s+)?(\w+)/,
		// Java/C#/Kotlin: void name(, int name(, public static void name(
		/(?:public|private|protected|static|final|abstract|synchronized|native|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/,
		// PHP: function name(
		/(?:public|private|protected|static|\s)*function\s+(\w+)/,
		// Ruby: def name
		/def\s+(\w+)/,
	],
	classes: [
		// TypeScript/JavaScript/Java/C#: class Name
		/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
		// TypeScript: interface Name
		/(?:export\s+)?interface\s+(\w+)/,
		// TypeScript: type Name =
		/(?:export\s+)?type\s+(\w+)\s*=/,
		// Rust: struct Name, pub struct Name
		/(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/,
		// Rust: enum Name, pub enum Name
		/(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/,
		// Rust: trait Name, pub trait Name
		/(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/,
		// Go: type Name struct
		/type\s+(\w+)\s+struct/,
		// Go: type Name interface
		/type\s+(\w+)\s+interface/,
		// Python: class Name
		/class\s+(\w+)/,
		// Ruby: class Name, module Name
		/(?:class|module)\s+(\w+)/,
	],
	exports: [
		// export function/class/const/interface/type
		/export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/,
		// export { name }
		/export\s*\{([^}]+)\}/,
	],
} as const;

interface OutlineEntry {
	line: number;
	kind: "func" | "class" | "export";
	signature: string;
}

/**
 * Count total lines in a file (fast streaming).
 */
async function countFileLines(filePath: string, encoding: BufferEncoding, signal?: AbortSignal): Promise<number> {
	if (signal?.aborted) return 0;
	let count = 0;
	const stream = createReadStream(filePath, { encoding });
	const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	const abortHandler = signal ? () => stream.destroy() : undefined;
	if (signal && abortHandler) signal.addEventListener("abort", abortHandler, { once: true });
	try {
		for await (const _ of reader) count += 1;
	} finally {
		if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
		reader.close();
		stream.destroy();
	}
	return count;
}

/**
 * Parse file structure using regex patterns.
 * Returns outline entries sorted by line number.
 */
async function parseFileOutline(
	filePath: string,
	encoding: BufferEncoding,
	signal?: AbortSignal,
): Promise<OutlineEntry[]> {
	if (signal?.aborted) return [];

	const entries: OutlineEntry[] = [];
	let lineNum = 0;

	const stream = createReadStream(filePath, { encoding });
	const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	const abortHandler = signal ? () => stream.destroy() : undefined;
	if (signal && abortHandler) signal.addEventListener("abort", abortHandler, { once: true });

	try {
		for await (const rawLine of reader) {
			lineNum += 1;
			if (entries.length >= OUTLINE_MAX_ENTRIES) break;

			const trimmed = rawLine.trim();
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) continue;

			// Check function patterns
			for (const pattern of STRUCTURE_PATTERNS.functions) {
				const match = trimmed.match(pattern);
				if (match?.[1] && match[1].length > 1) {
					entries.push({ line: lineNum, kind: "func", signature: trimmed.slice(0, 120) });
					break;
				}
			}
			// Check class patterns
			for (const pattern of STRUCTURE_PATTERNS.classes) {
				const match = trimmed.match(pattern);
				if (match?.[1] && match[1].length > 1) {
					entries.push({ line: lineNum, kind: "class", signature: trimmed.slice(0, 120) });
					break;
				}
			}
			// Check export patterns
			for (const pattern of STRUCTURE_PATTERNS.exports) {
				const match = trimmed.match(pattern);
				if (match?.[1]) {
					entries.push({ line: lineNum, kind: "export", signature: trimmed.slice(0, 120) });
					break;
				}
			}
		}
	} finally {
		if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
		reader.close();
		stream.destroy();
	}

	// Deduplicate: same line can match multiple patterns
	const seen = new Set<number>();
	return entries.filter((e) => {
		if (seen.has(e.line)) return false;
		seen.add(e.line);
		return true;
	});
}

/**
 * Format outline entries into a readable string.
 */
function formatOutline(entries: OutlineEntry[], totalFileLines: number): string {
	if (entries.length === 0) return "";

	const funcs = entries.filter((e) => e.kind === "func");
	const classes = entries.filter((e) => e.kind === "class");
	const exports = entries.filter((e) => e.kind === "export");

	const lines: string[] = [];
	lines.push(`\n=== FILE OUTLINE (${entries.length} signatures, ${totalFileLines} total lines) ===`);

	if (classes.length > 0) {
		lines.push("\nClasses/Types:");
		for (const e of classes) lines.push(`  L${e.line}: ${e.signature}`);
	}
	if (funcs.length > 0) {
		lines.push("\nFunctions:");
		for (const e of funcs) lines.push(`  L${e.line}: ${e.signature}`);
	}
	if (exports.length > 0) {
		lines.push("\nExports:");
		for (const e of exports) lines.push(`  L${e.line}: ${e.signature}`);
	}

	lines.push("\nUse start_line/end_line to read specific functions. Use semantic_search to find code by meaning.");
	return lines.join("\n");
}

interface CapturedLine {
	lineNumber: number;
	text: string;
}

function getAbortError(signal: AbortSignal): Error {
	const { reason } = signal;
	if (reason instanceof Error) {
		return reason;
	}
	if (reason !== undefined) {
		return new Error(String(reason));
	}
	return new Error("File read was aborted");
}

async function readTextWindow(
	filePath: string,
	encoding: BufferEncoding,
	includeLineNumbers: boolean,
	startLine: number | null | undefined,
	endLine: number | null | undefined,
	signal?: AbortSignal,
): Promise<string> {
	if (signal?.aborted) {
		throw getAbortError(signal);
	}

	const requestedStartLine = Math.max(startLine ?? 1, 1);
	const requestedEndLine = endLine ?? Number.POSITIVE_INFINITY;
	const hasFiniteEndLine = Number.isFinite(requestedEndLine);
	const maxScannedLine = hasFiniteEndLine
		? requestedEndLine
		: requestedStartLine + MAX_UNRANGED_LINE_SCAN - 1;
	const captured: CapturedLine[] = [];
	let chars = 0;
	let totalLines = 0;
	let capped = false;
	let approximateTotalLines = false;
	const maxCapturedLineNumber = Number.isFinite(requestedEndLine)
		? Math.min(requestedEndLine, requestedStartLine + MAX_READ_LINES - 1)
		: requestedStartLine + MAX_READ_LINES - 1;
	const lineNumberPrefixChars = includeLineNumbers
		? String(maxCapturedLineNumber).length + 3
		: 0;

	const stream = createReadStream(filePath, { encoding });
	const reader = createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	const abortHandler = signal
		? () => stream.destroy(getAbortError(signal))
		: undefined;

	if (signal && abortHandler) {
		signal.addEventListener("abort", abortHandler, { once: true });
	}

	try {
		for await (const rawLine of reader) {
			totalLines += 1;
			if (totalLines > requestedEndLine) {
				totalLines = requestedEndLine;
				break;
			}
			if (!hasFiniteEndLine && capped && totalLines >= maxScannedLine) {
				approximateTotalLines = true;
				break;
			}
			if (totalLines < requestedStartLine || capped) {
				continue;
			}
			if (captured.length >= MAX_READ_LINES) {
				capped = true;
				continue;
			}

			let line = rawLine;
			if (line.length > MAX_LINE_CHARS) {
				line = `${line.slice(0, MAX_LINE_CHARS)} [line truncated]`;
			}

			const nextChars = chars + line.length + lineNumberPrefixChars + 1;
			if (nextChars > MAX_READ_OUTPUT_CHARS && captured.length > 0) {
				capped = true;
				continue;
			}

			captured.push({ lineNumber: totalLines, text: line });
			chars = nextChars;
		}
	} finally {
		if (signal && abortHandler) {
			signal.removeEventListener("abort", abortHandler);
		}
		reader.close();
		stream.destroy();
	}

	const maxLineNumWidth = String(
		captured[captured.length - 1]?.lineNumber ?? totalLines,
	).length;
	const body = captured
		.map(({ lineNumber, text }) =>
			includeLineNumbers
				? `${String(lineNumber).padStart(maxLineNumWidth, " ")} | ${text}`
				: text,
		)
		.join("\n");
	const lastCapturedLine = captured[captured.length - 1]?.lineNumber;
	if (lastCapturedLine === undefined) {
		return body;
	}

	const effectiveEndLine = Math.min(requestedEndLine, totalLines);
	if (lastCapturedLine >= effectiveEndLine) {
		return body;
	}
	const totalLineText = approximateTotalLines
		? `${totalLines}+ lines`
		: effectiveEndLine;

	return (
		`${body}\n\n` +
		`[Showing lines ${requestedStartLine}-${lastCapturedLine} of ${totalLineText}. ` +
		"Use start_line/end_line to read other sections.]"
	);
}

/**
 * Create a file read executor using Node.js fs module
 *
 * @example
 * ```typescript
 * const readFile = createFileReadExecutor({
 *   maxFileSizeBytes: 5_000_000, // 5MB limit
 *   includeLineNumbers: true,
 * })
 *
 * const content = await readFile({ path: "/path/to/file.ts" }, context)
 * ```
 */
export function createFileReadExecutor(
	options: FileReadExecutorOptions = {},
): FileReadExecutor {
	const { maxFileSizeBytes, encoding, includeLineNumbers } = {
		...DEFAULT_FILE_READ_OPTIONS,
		...options,
	};

	return async (request: ReadFileRequest, context: AgentToolContext) => {
		const { path: filePath, start_line, end_line } = request;
		const initialPath = path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.resolve(process.cwd(), filePath);
		// Tolerate Unicode-whitespace mismatches (e.g. macOS Sonoma+
		// screenshot paths where the on-disk filename contains U+202F but
		// the caller's string has a regular space).
		const resolvedPath = resolveExistingFilePath(initialPath) ?? initialPath;
		const extension = path.extname(resolvedPath).toLowerCase();
		const imageMediaType = IMAGE_MEDIA_TYPES.get(extension);

		// Check if file exists
		const stat = await fs.stat(resolvedPath);

		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${resolvedPath}`);
		}

		if (imageMediaType) {
			if (stat.size > maxFileSizeBytes) {
				throw new Error(
					`Image file too large: ${stat.size} bytes (max: ${maxFileSizeBytes} bytes).`,
				);
			}
			if (context.metadata?.modelSupportsImages !== true) {
				throw new Error("Current model does not support image input");
			}
			const data = await fs.readFile(resolvedPath);
			return [
				{
					type: "text",
					text: "Successfully read image",
				},
				{
					type: "image",
					data: data.toString("base64"),
					mediaType: imageMediaType,
				},
			];
		}

		if (stat.size > MAX_TEXT_STREAM_BYTES) {
			throw new Error(
				`Text file too large to stream safely: ${stat.size} bytes (max: ${MAX_TEXT_STREAM_BYTES} bytes). Use a targeted command such as sed, grep, head, or tail to inspect specific sections.`,
			);
		}

		// Agentario: Smart Chunked Navigation — auto-chunk with regex outline.
		// Instead of just "first 200 lines + hint", parse the file structure and return an outline.
		let effectiveStartLine = start_line;
		let effectiveEndLine = end_line;
		let autoChunkHint = "";
		if (!start_line && !end_line && stat.size > AUTO_CHUNK_SIZE_BYTES) {
			effectiveStartLine = 1;
			effectiveEndLine = AUTO_CHUNK_LINES;

			// Tier 1: Try regex outline parsing
			try {
				const totalLines = await countFileLines(resolvedPath, encoding, context.signal);
				const outlineEntries = await parseFileOutline(resolvedPath, encoding, context.signal);
				if (outlineEntries.length > 0) {
					const outline = formatOutline(outlineEntries, totalLines);
					autoChunkHint = `\n\n[Agentario: Large file (${stat.size} bytes, ${totalLines} lines). Showing first ${AUTO_CHUNK_LINES} lines + structure outline.${outline}]`;
				} else {
					// Tier 3: Try AST (Tree-sitter) parsing as fallback
					try {
						const astResult = await parseFileWithTreeSitter(resolvedPath);
						if (astResult?.success && astResult.entries.length > 0) {
							const astOutline = formatAstOutline(astResult);
							autoChunkHint = `\n\n[Agentario: Large file (${stat.size} bytes, ${astResult.totalLines} lines). Showing first ${AUTO_CHUNK_LINES} lines + AST outline.${astOutline}]`;
						} else {
							autoChunkHint = `\n\n[Agentario: File is large (${stat.size} bytes). Showing first ${AUTO_CHUNK_LINES} lines. Use start_line/end_line to read specific sections, or use semantic_search to find relevant code first.]`;
						}
					} catch {
						autoChunkHint = `\n\n[Agentario: File is large (${stat.size} bytes). Showing first ${AUTO_CHUNK_LINES} lines. Use start_line/end_line to read specific sections, or use semantic_search to find relevant code first.]`;
					}
				}
			} catch {
				// Fallback: outline parsing failed, use simple hint
				autoChunkHint = `\n\n[Agentario: File is large (${stat.size} bytes). Showing first ${AUTO_CHUNK_LINES} lines. Use start_line/end_line to read specific sections, or use semantic_search to find relevant code first.]`;
			}
		}

		const content = await readTextWindow(
			resolvedPath,
			encoding,
			includeLineNumbers,
			effectiveStartLine,
			effectiveEndLine,
			context.signal,
		);

		return autoChunkHint ? content + autoChunkHint : content;
	};
}
