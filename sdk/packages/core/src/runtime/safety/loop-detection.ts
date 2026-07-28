/**
 * Repeated tool-call loop detection.
 *
 * Detects:
 * 1. Consecutive identical tool calls (same name + same input)
 * 2. Alternating A↔B loops (e.g. read_files ↔ search_codebase with same intent)
 */

import type { LoopDetectionConfig } from "@agentario/shared";

export interface LoopDetectionState {
	lastToolName: string;
	lastToolSignature: string;
	consecutiveIdenticalCount: number;
	/** Recent call keys as `name|signature` for oscillating-loop detection. */
	recentKeys: string[];
}

export function createLoopDetectionState(): LoopDetectionState {
	return {
		lastToolName: "",
		lastToolSignature: "",
		consecutiveIdenticalCount: 0,
		recentKeys: [],
	};
}

export function resetLoopDetectionState(state: LoopDetectionState): void {
	state.lastToolName = "";
	state.lastToolSignature = "";
	state.consecutiveIdenticalCount = 0;
	state.recentKeys = [];
}

function sortKeys(value: unknown): unknown {
	if (value == null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortKeys);
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
	}
	return sorted;
}

export function toolCallSignature(input: unknown): string {
	if (input == null) return "null";
	if (typeof input === "string") return input;
	if (typeof input !== "object") return String(input);
	try {
		return JSON.stringify(sortKeys(input));
	} catch {
		return String(input);
	}
}

export interface LoopCheckResult {
	softWarning: boolean;
	hardEscalation: boolean;
	reason?: "identical" | "oscillating";
}

/** How many A↔B pairs before soft/hard (pair = 2 calls). Soft at 2 pairs (4 calls), hard at 3 pairs (6). */
const OSCILLATING_SOFT_PAIRS = 2;
const OSCILLATING_HARD_PAIRS = 3;
const RECENT_KEYS_MAX = 8;

/**
 * Detect ABAB… oscillation: last 2*n keys alternate between two distinct keys.
 */
export function detectOscillatingLoop(recentKeys: string[]): {
	softWarning: boolean;
	hardEscalation: boolean;
} {
	if (recentKeys.length < OSCILLATING_SOFT_PAIRS * 2) {
		return { softWarning: false, hardEscalation: false };
	}
	const a = recentKeys[recentKeys.length - 2];
	const b = recentKeys[recentKeys.length - 1];
	if (!a || !b || a === b) {
		return { softWarning: false, hardEscalation: false };
	}
	let pairs = 0;
	// ABAB… ending with A,B: count consecutive trailing (A,B) pairs.
	for (let i = recentKeys.length - 1; i >= 1; i -= 2) {
		const even = recentKeys[i - 1];
		const odd = recentKeys[i];
		if (even === a && odd === b) {
			pairs += 1;
		} else {
			break;
		}
	}
	return {
		softWarning: pairs === OSCILLATING_SOFT_PAIRS,
		hardEscalation: pairs >= OSCILLATING_HARD_PAIRS,
	};
}

export function checkRepeatedToolCall(
	state: LoopDetectionState,
	toolName: string,
	signature: string,
	config: LoopDetectionConfig,
): LoopCheckResult {
	const key = `${toolName}|${signature}`;
	state.recentKeys.push(key);
	if (state.recentKeys.length > RECENT_KEYS_MAX) {
		state.recentKeys.shift();
	}

	if (toolName === state.lastToolName && signature === state.lastToolSignature) {
		state.consecutiveIdenticalCount++;
	} else {
		state.consecutiveIdenticalCount = 1;
	}
	state.lastToolName = toolName;
	state.lastToolSignature = signature;

	const identicalSoft = state.consecutiveIdenticalCount === config.softThreshold;
	const identicalHard = state.consecutiveIdenticalCount >= config.hardThreshold;
	const oscillating = detectOscillatingLoop(state.recentKeys);

	if (identicalHard || oscillating.hardEscalation) {
		return {
			softWarning: false,
			hardEscalation: true,
			reason: identicalHard ? "identical" : "oscillating",
		};
	}
	if (identicalSoft || oscillating.softWarning) {
		return {
			softWarning: true,
			hardEscalation: false,
			reason: identicalSoft ? "identical" : "oscillating",
		};
	}
	return { softWarning: false, hardEscalation: false };
}

export interface LoopDetectionVerdict {
	kind: "ok" | "soft" | "hard";
	message?: string;
}

export interface LoopDetectionCall {
	name: string;
	input: unknown;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
	softThreshold: 2,
	hardThreshold: 3,
};

export class LoopDetectionTracker {
	private readonly config: LoopDetectionConfig;
	private readonly state: LoopDetectionState = createLoopDetectionState();

	constructor(config?: Partial<LoopDetectionConfig>) {
		this.config = {
			softThreshold: config?.softThreshold ?? DEFAULT_CONFIG.softThreshold,
			hardThreshold: config?.hardThreshold ?? DEFAULT_CONFIG.hardThreshold,
		};
	}

	inspect(call: LoopDetectionCall): LoopDetectionVerdict {
		// Fingerprint: semantic query; shell commands text (ignore wrapper noise).
		let signatureSource: unknown = call.input;
		if (
			call.name === "semantic_search" &&
			call.input &&
			typeof call.input === "object" &&
			"query" in (call.input as Record<string, unknown>)
		) {
			const q = (call.input as { query?: unknown }).query;
			signatureSource =
				typeof q === "string" ? q.trim().toLowerCase() : call.input;
		} else if (call.name === "run_commands" && call.input && typeof call.input === "object") {
			const raw = call.input as { commands?: unknown; command?: unknown };
			const cmds = raw.commands ?? raw.command;
			signatureSource =
				typeof cmds === "string"
					? cmds.trim().toLowerCase()
					: JSON.stringify(cmds ?? call.input).toLowerCase();
		}
		const signature = toolCallSignature(signatureSource);
		const isCompletionTool =
			call.name === "attempt_completion" || call.name === "submit_and_exit";
		const isSearchTool =
			call.name === "semantic_search" || call.name === "search_codebase";
		const isShellTool = call.name === "run_commands";
		const config =
			isCompletionTool || isSearchTool || isShellTool
				? {
						softThreshold: Math.min(2, this.config.softThreshold),
						hardThreshold: Math.min(2, this.config.hardThreshold),
					}
				: this.config;
		const result = checkRepeatedToolCall(
			this.state,
			call.name,
			signature,
			config,
		);
		if (result.hardEscalation) {
			const msg =
				result.reason === "oscillating"
					? `Detected alternating tool-call loop involving \`${call.name}\`; stopping to avoid a loop. Use a different approach (e.g. semantic_search once, then read_files once). Docs may be missing — read root source and attempt_completion.`
					: `Detected ${this.state.consecutiveIdenticalCount} consecutive identical calls to \`${call.name}\`; stopping to avoid a loop. Change approach: read_files on known root paths or attempt_completion (do not repeat the same shell/git command).`;
			return { kind: "hard", message: msg };
		}
		if (result.softWarning) {
			const msg =
				result.reason === "oscillating"
					? `Detected alternating tool calls (e.g. read ↔ search). Stop repeating: use semantic_search once, then read_files with start_line/end_line. Do NOT pass "file:1-EOF" to search_codebase.`
					: `Detected ${this.state.consecutiveIdenticalCount} consecutive identical calls to \`${call.name}\`; try a different approach (new query, read_files, or attempt_completion).`;
			return { kind: "soft", message: msg };
		}
		return { kind: "ok" };
	}

	reset(): void {
		resetLoopDetectionState(this.state);
	}
}
