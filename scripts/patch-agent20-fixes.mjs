import fs from "fs"

const promptPath = "Z:/T/Agentario/apps/vscode/src/shared/agentario-prompt.ts"
let prompt = fs.readFileSync(promptPath, "utf8")
const needle =
	"- Индекс semantic_search покрывает всю cwd, включая вложенные vendor (llama-cpp-src и т.п.). Для обзора текущего проекта сначала читайте файлы в КОРНЕ рабочей папки (rules.md, README), не первые hits из вложенных репозиториев.`"
const replacement = `- Индекс semantic_search покрывает всю cwd, включая vendor. Для обзора: СНАЧАЛА read_files корневых rules.md / README.md / convert.py (и др. *.py/*.md в cwd), НЕ llama-cpp-src.
- ЗАПРЕЩЕНО крутить один и тот же git log / dig в nested repo. После 2–5 чтений корня — attempt_completion с фактами (даже если полного README нет).
- Не используйте && в PowerShell; не повторяйте одну и ту же run_commands.\``
if (!prompt.includes(needle)) {
	console.error("prompt needle not found")
} else {
	prompt = prompt.replace(needle, replacement)
	fs.writeFileSync(promptPath, prompt)
	console.log("updated agentario-prompt.ts")
}

const spPath = "Z:/T/Agentario/apps/vscode/agentario-system-prompt.md"
let sp = fs.readFileSync(spPath, "utf8")
if (!sp.includes("llama-cpp-src")) {
	sp =
		sp.trimEnd() +
		`

## Обзор чужого/смешанного workspace
- cwd может содержать вложенный llama-cpp-src — это НЕ основной проект обзора.
- Сначала корневые rules.md / *.py / README.md cwd. Nested vendor — только если явно нужно.
- Не повторяйте git log. После 2–5 чтений корня — attempt_completion.
`
	fs.writeFileSync(spPath, sp)
	console.log("updated system prompt")
}

const pkgPath = "Z:/T/Agentario/apps/vscode/package.json"
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
pkg.version = "0.14.32"
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
console.log("version", pkg.version)

const clPath = "Z:/T/Agentario/CHANGELOG.md"
let cl = fs.readFileSync(clPath, "utf8")
if (!cl.includes("## [0.14.32]")) {
	cl = cl.replace(
		"## [0.14.31]",
		`## [0.14.32] — 2026-07-26

### Fixed
- **Агент20-лупы**: повтор одинаковых \`run_commands\` (например git log) отклоняется сразу; loop-detection для shell ужесточён (hard на 2-м).
- \`&&\` в PowerShell блокируется и для structured command objects.
- VS Code \`semantic_search\`: повтор query + demote vendor paths (\`llama-cpp-src\` и т.п.), приоритет корневых файлов cwd.
- Промпт: обзор с корня (rules.md/convert.py), не nested vendor; быстрее \`attempt_completion\`.

## [0.14.31]`,
	)
	fs.writeFileSync(clPath, cl)
	console.log("changelog updated")
}

const readmePath = "Z:/T/Agentario/README.md"
let readme = fs.readFileSync(readmePath, "utf8")
readme = readme.replaceAll("0.14.31", "0.14.32")
fs.writeFileSync(readmePath, readme)
console.log("readme updated")
