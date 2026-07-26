import { describe, expect, it } from "vitest";
import {
	normalizeEditorToolInput,
	normalizeToolInput,
	sanitizeToolPath,
	tryParseJsonArray,
} from "./tool-input-normalize";

describe("normalizeToolInput null/invalid", () => {
	it("passes through null input unchanged", () => {
		expect(normalizeToolInput("editor", null)).toBeNull();
	});
	it("passes through non-object input unchanged", () => {
		expect(normalizeToolInput("editor", "oops")).toBe("oops");
	});
});

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
		expect(normalizeToolInput("bash", input)).toBe(input);
	});

	it("parses stringified JSON array in read_files.files", () => {
		const input = {
			files: '[{"path": "project/rules.md", "start_line": null, "end_line": null}]',
		};
		const result = normalizeToolInput("read_files", input) as Record<string, unknown>;
		expect(Array.isArray(result.files)).toBe(true);
		expect((result.files as unknown[])[0]).toEqual({ path: "project/rules.md" });
	});

	it("repairs EOF and Windows single-backslash paths in stringified read_files", () => {
		const files =
			'[{"path":"s:' + "\\" + "temo" + "\\" + 'rules.md","start_line":1,"end_line":EOF}]';
		const result = normalizeToolInput("read_files", { files }) as Record<string, unknown>;
		expect(Array.isArray(result.files)).toBe(true);
		const entry = (result.files as Array<Record<string, unknown>>)[0];
		expect(entry.path).toBe("s:" + "\\" + "temo" + "\\" + "rules.md");
		expect(entry.start_line).toBe(1);
		expect(entry.end_line).toBeUndefined();
	});

	it("parses stringified search_codebase.queries", () => {
		const result = normalizeToolInput("search_codebase", {
			queries: '["rules.md"]',
		}) as Record<string, unknown>;
		expect(result.queries).toEqual(["rules.md"]);
	});

	it("parses stringified JSON array in fetch_web_content.requests", () => {
		const input = {
			requests: '[{"url": "https://example.com", "prompt": "test"}]',
		};
		const result = normalizeToolInput("fetch_web_content", input) as Record<string, unknown>;
		expect(Array.isArray(result.requests)).toBe(true);
		expect((result.requests as unknown[])[0]).toEqual({ url: "https://example.com", prompt: "test" });
	});

	it("parses stringified JSON array in run_commands.commands", () => {
		const input = { commands: '["git status", "git log"]' };
		const result = normalizeToolInput("run_commands", input) as Record<string, unknown>;
		expect(Array.isArray(result.commands)).toBe(true);
		expect(result.commands).toEqual(["git status", "git log"]);
	});

	it("returns input unchanged when field is already an array", () => {
		const input = { files: [{ path: "a.txt" }] };
		expect(normalizeToolInput("read_files", input)).toEqual({
			files: [{ path: "a.txt" }],
		});
	});

	it("returns input unchanged when string is not valid JSON array", () => {
		const input = { files: "not-json" };
		expect(normalizeToolInput("read_files", input)).toBe(input);
	});

	it("strips null command from attempt_completion", () => {
		const result = normalizeToolInput("attempt_completion", {
			result: "Done",
			command: null,
		}) as Record<string, unknown>;
		expect(result).toEqual({ result: "Done" });
	});
});

describe("tryParseJsonArray / sanitizeToolPath", () => {
	it("parses repaired EOF arrays", () => {
		expect(tryParseJsonArray('[{"path":"a.md","end_line":EOF}]')).toEqual([
			{ path: "a.md", end_line: null },
		]);
	});

	it("sanitizes control characters to a file-like basename", () => {
		const mangled = "s:" + "\t" + "emo" + "\r" + "ules.md";
		expect(sanitizeToolPath(mangled)).toBe("emoules.md");
	});
});
