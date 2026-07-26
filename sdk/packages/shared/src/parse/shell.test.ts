import { describe, expect, it } from "vitest";
import { getDefaultShell, getShellArgs } from "./shell";

describe("shell helpers", () => {
	it("selects PowerShell on Windows and bash elsewhere", () => {
		expect(getDefaultShell("win32")).toBe("powershell");
		expect(getDefaultShell("darwin")).toBe("/bin/bash");
		expect(getDefaultShell("linux")).toBe("/bin/bash");
	});

	it("uses PowerShell flags for PowerShell executables", () => {
		expect(getShellArgs("powershell", "Write-Output 'hi'")).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'hi'",
		]);
		expect(
			getShellArgs(
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
				"Write-Output 'hi'",
			),
		).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'hi'",
		]);
	});

	it("uses cmd flags for cmd.exe", () => {
		expect(getShellArgs("cmd.exe", "echo hello")).toEqual([
			"/d",
			"/s",
			"/c",
			"echo hello",
		]);
	});

	it("uses POSIX flags for bash-like shells", () => {
		expect(getShellArgs("/bin/bash", "echo hi")).toEqual(["-c", "echo hi"]);
		expect(
			getShellArgs("C:\\Program Files\\Git\\bin\\bash.exe", "echo hi"),
		).toEqual(["-c", "echo hi"]);
	});
});

describe("PowerShell command sanitization", () => {
	const psShell = "powershell";

	it("escapes literal \\t in Windows paths", () => {
		const result = getShellArgs(psShell, "Get-Content .git\\refs\\tags.txt");
		expect(result[3]).toBe("Get-Content .git\\refs\\tags.txt");
	});

	it("escapes actual TAB character (0x09) in command", () => {
		// Simulates what happens after JSON.parse converts `\t` to real TAB
		const command = "Get-Content .git\x08refs\x09ags.txt";
		const result = getShellArgs(psShell, command);
		// \x08 (BS) → \\b, \x09 (TAB) → \\t
		expect(result[3]).toBe("Get-Content .git\\brefs\\tags.txt");
	});

	it("escapes actual CR character (0x0D) in command", () => {
		const command = "Get-Content .git\r\refs\rtags.txt";
		const result = getShellArgs(psShell, command);
		expect(result[3]).not.toContain("\r");
		expect(result[3]).toContain("\\r");
	});

	it("does not corrupt normal commands", () => {
		const command = "Get-ChildItem -Recurse -Depth 1 | Select-Object FullName";
		const result = getShellArgs(psShell, command);
		expect(result[3]).toBe(command);
	});

	it("does not corrupt paths with literal backslash-r / backslash-b segments", () => {
		const command = "Get-Content .git\\refs\\branches.txt";
		const result = getShellArgs(psShell, command);
		expect(result[3]).toBe("Get-Content .git\\refs\\branches.txt");
	});

	it("handles empty command", () => {
		const result = getShellArgs(psShell, "");
		expect(result[0]).toBe("-NoProfile");
		expect(result[3]).toBe("");
	});

	it("escapes actual tab/control chars from JSON-decoded paths", () => {
		const command = "Get-Content .git" + String.fromCharCode(0x0d) + "efs" + String.fromCharCode(0x08) + "ranches.txt";
		const result = getShellArgs(psShell, command);
		expect(result[3]).toContain("\\r");
		expect(result[3]).toContain("\\b");
	});

	it("preserves PowerShell backtick escape sequences", () => {
		const command = 'Write-Output "hello`nworld"';
		const result = getShellArgs(psShell, command);
		expect(result[3]).toBe(command);
	});
});
