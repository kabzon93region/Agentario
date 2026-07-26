import { describe, expect, it } from "bun:test";
import { normalizeRunCommandsInput, getShellDiscoveryOrReadBypassError } from "./helpers";
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

describe("getShellDiscoveryOrReadBypassError", () => {
	it("rejects Get-ChildItem directory listing", () => {
		expect(
			getShellDiscoveryOrReadBypassError(
				'Get-ChildItem -Path "s:\\temo" -Force | Select-Object Name',
			),
		).toMatch(/semantic_search/);
	});

	it("rejects Get-Content of source/docs", () => {
		expect(
			getShellDiscoveryOrReadBypassError(
				'Get-Content "s:\\temo\\rules.md" -Encoding UTF8',
			),
		).toMatch(/read_files/);
	});

	it("allows git status", () => {
		expect(getShellDiscoveryOrReadBypassError("git status")).toBeNull();
	});
});
