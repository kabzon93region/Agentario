import { describe, expect, it } from "vitest";
import {
	LoopDetectionTracker,
	checkRepeatedToolCall,
	createLoopDetectionState,
	detectOscillatingLoop,
} from "./loop-detection";

describe("detectOscillatingLoop", () => {
	it("stays quiet for fewer than 4 alternating calls", () => {
		expect(detectOscillatingLoop(["a|1", "b|2", "a|1"])).toEqual({
			softWarning: false,
			hardEscalation: false,
		});
	});

	it("soft-warns at 2 AB pairs", () => {
		expect(detectOscillatingLoop(["a|1", "b|2", "a|1", "b|2"])).toEqual({
			softWarning: true,
			hardEscalation: false,
		});
	});

	it("hard-escalates at 3 AB pairs", () => {
		expect(
			detectOscillatingLoop(["a|1", "b|2", "a|1", "b|2", "a|1", "b|2"]),
		).toEqual({
			softWarning: false,
			hardEscalation: true,
		});
	});
});

describe("LoopDetectionTracker oscillating read/search", () => {
	it("hard-stops after three read↔search pairs", () => {
		const tracker = new LoopDetectionTracker({ softThreshold: 2, hardThreshold: 3 });
		const read = { name: "read_files", input: { files: [{ path: "rules.md" }] } };
		const search = {
			name: "search_codebase",
			input: { queries: ["rules.md:1-EOF"] },
		};
		const kinds: string[] = [];
		for (let i = 0; i < 6; i++) {
			kinds.push(tracker.inspect(i % 2 === 0 ? read : search).kind);
		}
		expect(kinds).toEqual(["ok", "ok", "ok", "soft", "soft", "hard"]);
	});
});

describe("LoopDetectionTracker completion tools", () => {
	it("hard-stops on the second identical attempt_completion", () => {
		const tracker = new LoopDetectionTracker({ softThreshold: 2, hardThreshold: 3 });
		const call = {
			name: "attempt_completion",
			input: { result: "Проект находится на стадии разработки." },
		};
		expect(tracker.inspect(call).kind).toBe("ok");
		expect(tracker.inspect(call).kind).toBe("hard");
	});
});

describe("LoopDetectionTracker semantic_search", () => {
	it("treats same query with different limits as identical and hard-stops on 2nd", () => {
		const tracker = new LoopDetectionTracker({ softThreshold: 2, hardThreshold: 3 });
		expect(
			tracker.inspect({
				name: "semantic_search",
				input: { query: "project rules AGENTS guidelines", limit: 10 },
			}).kind,
		).toBe("ok");
		expect(
			tracker.inspect({
				name: "semantic_search",
				input: { query: "project rules AGENTS guidelines", limit: 5 },
			}).kind,
		).toBe("hard");
	});
});

describe("checkRepeatedToolCall identical", () => {
	it("hard-escalates at hard threshold", () => {
		const state = createLoopDetectionState();
		const cfg = { softThreshold: 2, hardThreshold: 3 };
		expect(checkRepeatedToolCall(state, "read_files", "sig", cfg).softWarning).toBe(false);
		expect(checkRepeatedToolCall(state, "read_files", "sig", cfg).softWarning).toBe(true);
		expect(checkRepeatedToolCall(state, "read_files", "sig", cfg).hardEscalation).toBe(true);
	});
});
