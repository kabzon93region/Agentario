import * as fs from "node:fs/promises"
import * as path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { isAgentarioStandaloneMode } from "./agentario-standalone"

const FALLBACK_AGENTARIO_SYSTEM_PROMPT = `You are Agentario, an autonomous coding agent in the user''s IDE.
Reply in the user''s preferred language (default: Russian).
Always use available tools (read_files, search_codebase, run_commands, editor) to complete coding tasks.
Include tool calls in every response until the task is done.`

let cachedSystemPromptOverlay: string | undefined

function stripMarkdownWrapper(content: string): string {
	const trimmed = content.trim()
	const fenceMatch = trimmed.match(/^```[\s\S]*?\n([\s\S]*?)```$/m)
	if (fenceMatch?.[1]) {
		return fenceMatch[1].trim()
	}
	return trimmed.replace(/^#.*\n+/m, "").trim()
}

export async function loadAgentarioSystemPromptOverlay(): Promise<string> {
	if (!isAgentarioStandaloneMode()) {
		return ""
	}
	if (cachedSystemPromptOverlay !== undefined) {
		return cachedSystemPromptOverlay
	}
	try {
		const filePath = path.join(HostProvider.get().extensionFsPath, "agentario-system-prompt.md")
		const raw = await fs.readFile(filePath, "utf8")
		cachedSystemPromptOverlay = stripMarkdownWrapper(raw) || FALLBACK_AGENTARIO_SYSTEM_PROMPT
	} catch (error) {
		Logger.warn("[Agentario] Failed to load bundled system prompt, using fallback:", error)
		cachedSystemPromptOverlay = FALLBACK_AGENTARIO_SYSTEM_PROMPT
	}
	return cachedSystemPromptOverlay
}

export const AGENTARIO_PLAN_MODE_INSTRUCTIONS_RU = `# Режим Plan

Вы в режиме Plan: исследуйте, анализируйте и планируйте — не выполняйте правки.

- Читайте файлы, ищите по codebase, собирайте контекст
- Задавайте уточняющие вопросы при неясных требованиях
- Представьте структурированный план
- **Не** редактируйте файлы и **не** запускайте деструктивные команды
- Используйте tools read/search для исследования

После явного одобрения плана пользователем вызовите \`switch_to_act_mode\` для перехода в Act.`

export const AGENTARIO_LOCAL_TOOLS_HINT = `# Tools (local / LM Studio) — КРИТИЧНО

Вы и есть Agentario: ВЫ читаете файлы и отвечаете пользователю.
Tools — это обычные API (поиск по индексу, чтение диска), а НЕ другие модели и НЕ «субагенты».
Не делегируйте задание tool'у. Не передавайте текст задания пользователя в аргументы tool.

Правила вызовов:
- РОВНО ОДИН tool call за ответ (только через function calling API).
- semantic_search.query — КОРОТКАЯ тема (2–8 слов), напр. "README documentation", "CHANGELOG history", "development rules", "project architecture".
- ЗАПРЕЩЕНО класть в query/path фразы пользователя: «ознакомься…», «проанализируй…», «прочитай…» и любые полные предложения-задания.
- search_codebase — только regex/символ (имя функции, import), не NL-предложение.
- read_files — только реальный путь файла из результата search (path + start_line/end_line). Никогда path = текст вопроса.
- Workflow обзора: git status → read_files(rules.md / README.md / корневой *.py|*.ts из git) → при необходимости ОДИН semantic_search → attempt_completion с ФАКТАМИ. ЗАПРЕЩЕНО открывать обзор 2–3 semantic_search подряд без чтения файлов.
- Не вызывайте attempt_completion после одного пустого/битого read. Сначала 2–5 успешных чтений с путями.
- attempt_completion.result — факты из прочитанного; не копируйте задание; command не передавайте если не нужен.
- После успешного attempt_completion задачу не повторяйте.
- Запрещены шаблонные ответы без цитат/путей («проект на стадии разработки…»).
- Индекс semantic_search покрывает cwd, включая vendor. Для обзора: СНАЧАЛА git status + read_files корневых rules.md / README.md / convert.py (и др. *.py/*.md в cwd), НЕ llama-cpp-src и НЕ серия пустых semantic_search.
- ЗАПРЕЩЕНО крутить один и тот же git log / dig в nested repo. После 2–5 чтений корня — attempt_completion с фактами (даже если полного README нет).
- Не используйте && в PowerShell; не повторяйте одну и ту же run_commands.`

/** Strip parallel-tool guidance that breaks LM Studio peg-native parsing on small models. */
export function applyLocalModelToolDiscipline(systemPrompt: string): string {
	const withoutParallel = systemPrompt
		.replace(
			/- You can call multiple tools in a single response\.[^\n]*/g,
			"- Emit exactly ONE tool call per response. Wait for the result before the next tool.",
		)
		.replace(/- Good parallelism examples:[^\n]*/g, "- Do not parallelize tools on local models.")
	const trimmed = withoutParallel.trim()
	if (trimmed.includes("# Tools (local / LM Studio)")) {
		return trimmed
	}
	return `${trimmed}\n\n${AGENTARIO_LOCAL_TOOLS_HINT}`.trim()
}
