/**
 * Platform-specific shell guidance embedded in the Agentario system prompt.
 * Mirrors core rules from user Rules (01-terminal.md, 00-agent-behavior.md)
 * so they apply even without external rule files.
 */

export function buildPlatformShellRules(platform: string): string {
	if (platform === "win32") {
		return `Terminal and shell (Windows PowerShell):
- Default shell is Windows PowerShell. Do not use Bash, CMD, or WSL syntax unless the active shell is explicitly different.
- Never mix PowerShell, CMD, Bash, or WSL syntax in one command.
- Do not use \`&&\` to chain commands (not supported in Windows PowerShell 5.1). Run independent commands as separate entries in one run_commands call, or use \`;\` only when you understand the semantics.
- Prefer cmdlets over aliases: Get-ChildItem, Get-Content, Copy-Item, Move-Item, Remove-Item, Test-Path, Select-String, New-Item.
- Environment variables: \`$env:PATH\`, \`$env:TEMP\` — never \`%PATH%\` (CMD) or \`$PATH\` (Bash).
- Quote paths with spaces. Use single quotes inside double-quoted -Command strings: \`powershell -Command "Get-ChildItem 'C:\\My Folder'"\`.
- Verify quote balance before sending a command. Never append stray \`}\` or \`"\` at the end of a command string.
- One logical action per command. Avoid long fragile one-liners.
- run_commands input must be a JSON object with a \`commands\` array — never a stringified JSON array.
- Before executing: confirm shell syntax, quotes, working directory, and target paths.
- If the same command fails twice with a syntax error: stop retrying shell variants; use read_files/editor or a different approach.`;
	}

	return `Terminal and shell (Unix):
- Default shell is POSIX sh/bash unless detected otherwise. Do not mix Bash and PowerShell syntax.
- Quote paths with spaces. One logical action per command.
- run_commands input must be a JSON object with a \`commands\` array — never a stringified JSON array.
- If the same command fails twice: stop retrying; use read_files/editor or a different approach.`;
}
