function normalizeShellName(shell: string): string {
	const normalizedPath = shell.replaceAll("\\", "/");
	const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
	const baseName =
		lastSeparatorIndex >= 0
			? normalizedPath.slice(lastSeparatorIndex + 1)
			: normalizedPath;
	return baseName.toLowerCase();
}

export function getDefaultShell(platform: string): string {
	return platform === "win32" ? "powershell" : "/bin/bash";
}

/**
 * Control character → escaped letter mapping.
 * When a model generates a Windows path like `.git\refs\tags.txt`, the JSON
 * parser converts `\r` → CR (0x0D) and `\t` → TAB (0x09), corrupting the
 * command before it reaches PowerShell. We detect both cases:
 * 1. Actual control characters (0x00-0x1F) in the string → replace with `\X`
 * 2. Literal `\X` sequences that survived JSON parsing → replace with `\\X`
 *
 * PowerShell uses backtick (`` ` ``) for its own escape sequences, so `\t`
 * in a command is NEVER intentional — it's always a path separator.
 */
const CONTROL_CHAR_MAP: Record<string, string> = {
	"\x07": "\\a",  // BEL
	"\x08": "\\b",  // BS (backspace)
	"\x0B": "\\v",  // VT (vertical tab)
	"\x0C": "\\f",  // FF (form feed)
	"\r":   "\\r",  // CR (carriage return)
	"\x00": "\\0",  // NUL
	"\x1B": "\\e",  // ESC
};

// Regex matching actual control characters (0x00-0x1F) that are NOT
// legitimate whitespace (we keep space 0x20 and normal newline/tab
// in the middle of commands — but CR, BS, etc. are always wrong).
const CONTROL_CHAR_RE = /[\x00\x07\x08\x0B\x0C\x0D\x1B]/g;

// Regex matching literal backslash + known escape letter (for strings
// that still contain `\t` as two chars after JSON parsing).
const LITERAL_ESCAPE_RE = /\\([tnrbfav0e])/gi;

function sanitizePowerShellCommand(command: string): string {
	// Step 1: Replace actual control characters with their `\X` form.
	let result = command.replace(CONTROL_CHAR_RE, (ch) => CONTROL_CHAR_MAP[ch] ?? ch);
	// Step 2: Replace literal `\X` sequences with `\\X` so PowerShell
	// treats them as path separators, not escape sequences.
	result = result.replace(LITERAL_ESCAPE_RE, (_match, letter: string) => `\\${letter.toLowerCase()}`);
	return result;
}

export function getShellArgs(shell: string, command: string): string[] {
	const shellName = normalizeShellName(shell);

	if (
		shellName === "powershell" ||
		shellName === "powershell.exe" ||
		shellName === "pwsh" ||
		shellName === "pwsh.exe"
	) {
		return ["-NoProfile", "-NonInteractive", "-Command", sanitizePowerShellCommand(command)];
	}

	if (shellName === "cmd" || shellName === "cmd.exe") {
		return ["/d", "/s", "/c", command];
	}

	return ["-c", command];
}

/**
 * Quote a filesystem path for use in a shell `cd` command.
 * Escapes double quotes and wraps in double quotes to prevent injection.
 */
export function quoteShellPath(path: string): string {
	return `"${path.replace(/"/g, '\\"')}"`;
}

/**
 * Build a safe `cd` command for the given path.
 */
export function buildCdCommand(cwd: string): string {
	return `cd ${quoteShellPath(cwd)}`;
}
