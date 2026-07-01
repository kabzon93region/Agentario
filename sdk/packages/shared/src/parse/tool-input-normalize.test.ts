import { describe, expect, it } from "vitest";
import { normalizeEditorToolInput, normalizeToolInput } from "./tool-input-normalize";

describe("normalizeEditorToolInput", () => {
	it("drops insert_line when model sends the string null", () => {
		expect(
			normalizeEditorToolInput({
				path: "Z:/T/ItT/README.md",
				new_text: "# test",
				insert_line: "null",
			}),
		).toEqual({
			path: "Z:/T/ItT/README.md",
			new_text: "# test",
		});
	});

	it("coerces numeric strings for insert_line", () => {
		expect(
			normalizeEditorToolInput({
				path: "/tmp/a.txt",
				new_text: "line",
				insert_line: "3",
			}),
		).toEqual({
			path: "/tmp/a.txt",
			new_text: "line",
			insert_line: 3,
		});
	});

	it("removes old_text when model sends the string null", () => {
		expect(
			normalizeEditorToolInput({
				path: "/tmp/a.txt",
				old_text: "null",
				new_text: "line",
			}),
		).toEqual({
			path: "/tmp/a.txt",
			new_text: "line",
		});
	});
});

describe("normalizeToolInput", () => {
	it("normalizes only editor tool calls", () => {
		const input = { path: "/tmp/a.txt", new_text: "x", insert_line: "null" };
		expect(normalizeToolInput("editor", input)).toEqual({ path: "/tmp/a.txt", new_text: "x" });
		expect(normalizeToolInput("read_files", input)).toBe(input);
	});
});
