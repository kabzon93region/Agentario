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

export const AGENTARIO_LOCAL_TOOLS_HINT = `# Tools (обязательно)

Модель должна вызывать инструменты через API function calling, а не описывать действия текстом.
Если endpoint поддерживает tools — каждый шаг задачи выполняйте через tool calls.`
