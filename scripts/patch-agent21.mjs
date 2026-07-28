import fs from "fs"

const p = "Z:/T/Agentario/sdk/packages/core/src/extensions/tools/definitions.ts"
let s = fs.readFileSync(p, "utf8")

if (!s.includes("let listingRejectStreak = 0")) {
	s = s.replace(
		"let lastCommandsKey = \"\";\n\tlet identicalCommandsStreak = 0;\n\n\treturn createTool",
		"let lastCommandsKey = \"\";\n\tlet identicalCommandsStreak = 0;\n\tlet listingRejectStreak = 0;\n\n\treturn createTool",
	)
}

const insertAfter = `			if (identicalCommandsStreak >= 2) {
				const err =
					"Repeated the same run_commands. Do NOT retry identical shell/git commands. " +
					"For project overview: read_files on cwd root (rules.md, convert.py, *.md/*.py), then attempt_completion. " +
					"Do not dig into nested vendor repos (llama-cpp-src) for the main task summary.";
				return commands.map((command) => ({
					query: formatRunCommandQueryPreview(command),
					result: "",
					error: err,
					success: false,
				}));
			}

			return executeShellCommands(commands, {`

const insertWith = `			if (identicalCommandsStreak >= 2) {
				const err =
					"Repeated the same run_commands. Do NOT retry identical shell/git commands. " +
					"For project overview: read_files on cwd root (rules.md, convert.py, *.md/*.py), then attempt_completion. " +
					"Do not dig into nested vendor repos (llama-cpp-src) for the main task summary.";
				return commands.map((command) => ({
					query: formatRunCommandQueryPreview(command),
					result: "",
					error: err,
					success: false,
				}));
			}

			const bypasses = commands.map((command) => getShellDiscoveryOrReadBypassError(command));
			if (bypasses.some(Boolean)) {
				listingRejectStreak += 1;
				const finishHint =
					listingRejectStreak >= 2
						? " You already hit this block before — call attempt_completion with facts from files you already read."
						: "";
				return commands.map((command, i) => ({
					query: formatRunCommandQueryPreview(command),
					result: "",
					error: (bypasses[i] ?? bypasses.find(Boolean) ?? "Shell command blocked.") + finishHint,
					success: false,
				}));
			}
			listingRejectStreak = 0;

			return executeShellCommands(commands, {`

if (!s.includes("listingRejectStreak += 1")) {
	if (!s.includes(insertAfter)) {
		console.error("insertAfter block not found")
		process.exit(1)
	}
	s = s.replace(insertAfter, insertWith)
}

fs.writeFileSync(p, s)
console.log("definitions ok", s.includes("listingRejectStreak"))

const pkgPath = "Z:/T/Agentario/apps/vscode/package.json"
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
pkg.version = "0.14.33"
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)

let cl = fs.readFileSync("Z:/T/Agentario/CHANGELOG.md", "utf8")
if (!cl.includes("## [0.14.33]")) {
	cl = cl.replace(
		"## [0.14.32]",
		`## [0.14.33] — 2026-07-28

### Fixed
- **Агент21**: повторные \`read_files\` одного path блокируются после 2 чтений (цикл read↔shell больше не обходит loop-detection).
- Команды в кавычках ('git status') разворачиваются — иначе PowerShell только печатает литерал.
- Повтор Get-ChildItem/Get-Content: явное «уже блокировали — attempt_completion».
- \`&&\` дополнительно режется перед execute.

## [0.14.32]`,
	)
	fs.writeFileSync("Z:/T/Agentario/CHANGELOG.md", cl)
}

let rm = fs.readFileSync("Z:/T/Agentario/README.md", "utf8")
rm = rm.replaceAll("0.14.32", "0.14.33")
fs.writeFileSync("Z:/T/Agentario/README.md", rm)
console.log("version", pkg.version)
