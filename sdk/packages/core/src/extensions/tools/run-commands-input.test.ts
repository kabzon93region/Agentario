import { describe, expect, it } from "bun:test";
import { normalizeRunCommandsInput } from "./helpers";
import {
	preprocessRunCommandsInput,
	validateShellCommandString,
} from "./schemas";

describe("preprocessRunCommandsInput", () => {
	it("unwraps stringified commands array", () => {
		const input = {
			commands:
				'[{"command":"git status"},{"command":"git log","args":["-1"]}]',
		};
		expect(preprocessRunCommandsInput(input)).toEqual({
			commands: [{ command: "git status" }, { command: "git log", args: ["-1"] }],
		});
	});
});

describe("validateShellCommandString", () => {
	it("rejects bash && chaining on Windows", () => {
		expect(
			validateShellCommandString("git status && git log", "win32"),
		).toMatch(/&&/);
	});

	it("rejects malformed quoting or stray brace", () => {
		const error = validateShellCommandString(
			"Get-ChildItem 'C:\\test'\"}",
			"win32",
		);
		expect(error).toBeTruthy();
	});
});

describe("normalizeRunCommandsInput", () => {
	it("accepts stringified commands array inside object", () => {
		const result = normalizeRunCommandsInput({
			commands: '["git status", "git log -1"]',
		});
		expect(result).toEqual(["git status", "git log -1"]);
	});

	it("throws on invalid PowerShell syntax before execution", () => {
		expect(() =>
			normalizeRunCommandsInput({
				commands: ["git status && git log"],
			}),
		).toThrow(/&&/);
	});
});
