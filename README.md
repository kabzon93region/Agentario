<p align="center">
  <img src="assets/icons/icon.png" width="80" alt="Agentario" />
</p>

<h1 align="center">Agentario</h1>

<p align="center">
Autonomous coding agent for VS Code — **автономный продукт** для локальных LLM (LM Studio, Ollama). Без аккаунта Cline и без обязательного интернета.
</p>

<p align="center">
<strong>Версия расширения: 0.4.0</strong> · <a href="CHANGELOG.md">Changelog</a> · <a href="VERSIONING.md">Схема версий</a>
</p>

<div align="center">

<table>
<tbody>
<tr>
<td align="center"><a href="https://github.com/kabzon93region/Agentario"><strong>GitHub</strong></a></td>
<td align="center"><a href="CHANGELOG.md"><strong>Changelog</strong></a></td>
<td align="center"><a href="VERSIONING.md"><strong>Версии</strong></a></td>
<td align="center"><a href="https://docs.cline.bot" target="_blank"><strong>Docs (upstream)</strong></a></td>
</tr>
</tbody>
</table>

</div>

## Быстрый старт (VS Code)

1. Соберите или скачайте VSIX: `release/agentario-0.4.0.vsix` (сборка: `build.cmd` на Windows).
2. VS Code → Extensions → `...` → **Install from VSIX**.
3. Провайдер **LM Studio** или **Ollama** — см. [настройку LM Studio](#lm-studio-локальная-модель) ниже.
4. MCP (опционально): `setup-mcp.cmd` — memory, sequential-thinking, playwright.

### Автономный режим (без Cline cloud)

Agentario поставляется с `endpoints.json` в VSIX → режим **selfHosted**:

- **Не нужен** аккаунт Cline, OAuth и интернет для работы чата (достаточно LM Studio / Ollama).
- Облачные провайдеры Cline (`cline`, `cline-pass`) скрыты; телеметрия и remote config отключены.
- MCP — локальные процессы через `npx` (первый запуск может потребовать npm; для offline см. `setup-mcp.cmd` с кэшем пакетов).
- Свой `~/.agentario/endpoints.json` — см. `config/agentario-endpoints.json`.
- **Системный промпт и Rules:** см. [config/PROMPTS_AND_RULES.md](config/PROMPTS_AND_RULES.md).

### Сборка (Windows)

### Сборка и релиз (Windows)

```bat
build.cmd
publish-release.cmd
```

- **`build.cmd`** → `release/agentario-<version>.vsix`
- **`publish-release.cmd`** → GitHub: commit, tag, Release + VSIX ([config/RELEASE.md](config/RELEASE.md))

### LM Studio (локальная модель)

| Где | Что |
|-----|-----|
| **Сервер LM Studio** | Загрузить модель, Local Server, порт `1234`, доступ по LAN |
| **VS Code + Agentario** | Провайдер LM Studio, URL `http://<ip>:1234`, выбрать загруженную модель |

MCP и индексация codebase работают на **ПК с VS Code**, не на машине с LM Studio.

#### Индексация (embeddings)

- Нужна модель в **embedding-слоте** LM Studio (type `embeddings` в API), не chat-модель из LLM-слота.
- Модель вроде `lfm2.5-embedding-350m`: **My Models → ⚙️ → Domain Type → Embedding**, затем Load в Developer.
- После смены domain контекст embedding-модели может уменьшиться (например 120k → 20k) — это нормально для экономии VRAM.
- Подробно: [`config/lmstudio-indexing.md`](config/lmstudio-indexing.md).

#### LM Studio без GUI (headless)

На ПК с сервером LM Studio можно не держать окно приложения:

```bat
scripts\lmstudio-headless-server.cmd
```

Режим `restore` — `lms daemon up` + `lms server start` (последние настройки загрузки из LM Studio).  
Режим `load` — явная загрузка chat + embedding с `--context-length` из скрипта.  
Документация LM Studio: [headless](https://lmstudio.ai/docs/developer/core/headless), [lms CLI](https://lmstudio.ai/docs/cli).

### MCP

**Требуется Node.js LTS** (для stdio-серверов: memory, sequential-thinking, playwright). VS Code не видит `npx`, если Node не в **системном** PATH — скрипт `setup-mcp.cmd` прописывает полный путь к `npx.cmd`.

```bat
setup-mcp.cmd
```

Конфиг: `%USERPROFILE%\.agentario\data\settings\agentario_mcp_settings.json` (legacy: `.cline\...\cline_mcp_settings.json`). Шаблон: `config/agentario-recommended-mcp.json`.

Playwright MCP (опционально):

```powershell
& "C:\path\to\npx.cmd" playwright install chromium
```

### Правила и конфигурация

| Область | Путь |
|---------|------|
| Глобальные правила | `Documents\Agentario\Rules\` |
| Данные расширения | `%USERPROFILE%\.agentario\` |
| Правила проекта | `.agentariorules` или `.agentario\rules\` |
| Исключения файлов | `.agentarioignore` (legacy: `.clineignore`) |

Старые пути Cline (`.cline`, `.clinerules`, `Documents\Cline`) по-прежнему читаются для совместимости.

---

<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot" target="_blank"><strong>Upstream docs</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline" target="_blank"><strong>Cline</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### CLI

Run Cline in your terminal.
Interactive chat or fully headless
for CI/CD and scripting.

```
npm i -g cline
```

<a href="./apps/cli/README.md">Learn more</a>
<br><br>

</td>
<td align="center" width="50%">

### Kanban

Run many agents in parallel from a
web-based task board. Each card gets its own
worktree, auto-commit, and dependency chains.

```
npm i -g kanban
```

<a href="https://github.com/cline/kanban">Learn more</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code Extension

AI coding assistant in your editor.
Create files, run commands, browse the web,
and use tools with human-in-the-loop approval.

<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev">Install from VS Marketplace</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains Plugin

The same Cline experience in IntelliJ IDEA,
PyCharm, WebStorm, GoLand, and the rest of
the JetBrains family.

<a href="https://plugins.jetbrains.com/plugin/28247-cline">Install from JetBrains Marketplace</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

Build your own AI agents and integrations powered by the same engine that runs the CLI, Kanban, VS Code extension, and JetBrains plugin. Custom tools, multi-agent teams, connectors, scheduled automations, and more.

```
npm install @cline/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">Documentation</a>
<br><br>

</td>
</tr>
</table>
</div>

---

## Index

| Product | Description | Location | CHANGELOG |
|---------|------------|--------------|--------------|
| **Agentario (VS Code)** | Форк Cline: русский UI, LM Studio, сборка Windows, MCP-шаблоны. | [`apps/vscode/`](apps/vscode/) | [CHANGELOG.md](CHANGELOG.md) |
| **SDK** | Node.js programmatic agent API (upstream). | [`sdk/`](sdk/) | [sdk/CHANGELOG.md](sdk/CHANGELOG.md) |
| **CLI** | Terminal UI (upstream). | [`apps/cli/`](apps/cli/) | [apps/cli/CHANGELOG.md](apps/cli/CHANGELOG.md) |

## Edits Code Across Your Project

Cline reads your project structure, understands the relationships between files, and makes coordinated changes across your codebase. It monitors linter and compiler errors as it works, fixing issues like missing imports, type mismatches, and syntax errors before you even see them. In VS Code and JetBrains, every edit shows up as a diff you can review, modify, or revert. All changes are tracked with checkpoints, so you can easily undo the agent's work.

## Runs Bash Commands

Cline executes commands directly in your terminal and watches the output in real time. Install packages, run build scripts, execute tests, deploy applications, manage databases. For long-running processes like dev servers, Cline continues working in the background and reacts to new output as it appears, catching compile errors, test failures, and server crashes as they happen.

## Plan and Act

Toggle between Plan mode and Act mode. In Plan mode, Cline explores your codebase, asks clarifying questions, and lays out a strategy. Once you're aligned, switch to Act mode and Cline executes the plan. Every file edit and terminal command requires your approval, so you stay in control of what actually changes. Or toggle auto-approve and let Cline run autonomously.

## Rules and Skills

Define project-specific rules in `.clinerules` files that guide how Cline works in your codebase: coding standards, architecture conventions, deployment procedures, testing requirements. Rules are picked up automatically by the CLI, VS Code extension, and JetBrains plugin. Use skills to let the model load specific rules when needed. 

## Works With Every Model

Cline is not locked to a single AI provider. Use whichever model fits your workflow:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT series model |
| Google | Gemini series model |
| OpenRouter | 200+ models from any provider |
| Vercel AI Gateway | Models through Vercel AI Gateway |
| AWS Bedrock | Claude, Llama, and more |
| Azure / GCP Vertex | All hosted models |
| Cerebras / Groq | Fast inference models |
| Ollama / LM Studio | Run local models on your machine |
| Any OpenAI-compatible API | Self-hosted or third-party endpoints |

## Extend With Plugins or MCP Servers

Extend Cline's capabilities with plugins. Using the SDK, register tools and lifecycle hooks programmatically through the plugin system for logging, auditing, policy enforcement, or adding domain-specific capabilities. Simple plugin example below.

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
...or use [MCP servers](https://github.com/modelcontextprotocol) to connect to databases, query APIs, manage cloud infrastructure, and interact with external systems. Use [community-built servers](https://github.com/modelcontextprotocol/servers) or ask Cline to create custom tools on the fly. In the CLI, manage servers with `cline mcp`.

## Multi-Agent Teams

Coordinate multiple agents working together on complex tasks. A coordinator agent breaks the work into subtasks and delegates to specialist agents, each with their own tools and context. Team state persists across sessions so you can pick up where you left off.

```bash
cline --team-name auth-sprint "Plan and implement user authentication with tests"
```

## Scheduled Agents

Run agents on cron schedules for recurring automations. Daily PR summaries, weekly dependency checks, codebase health reports. Schedules persist across restarts and run independently of any terminal session.

```bash
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

## Connect to Slack, Telegram, Discord, and More

Chat with your agent from any messaging platform: Telegram, Slack, Discord, Google Chat, WhatsApp, and Linear. Each conversation thread maps to an agent session with full context. Set up access control to restrict who can interact with your agent.

```bash
# Connect to Telegram
cline connect telegram -k $BOT_TOKEN
# Connect to Slack through webhook
cline connect slack --bot-token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
# Connect to Slack using socket mode
cline connect slack --bot-token $SLACK_TOKEN --app-token $SLACK_APP_TOKEN
```

## Headless CLI for CI/CD

Run Cline with zero interaction for scripting and automation. Pipe input, get JSON output, chain commands, integrate into CI/CD pipelines.

```bash
cline "Run tests and fix any failures"
git diff origin/main | cline  "Review these changes for issues"
cline --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Contributing

Форк поддерживается в [kabzon93region/Agentario](https://github.com/kabzon93region/Agentario). Upstream: [cline/cline](https://github.com/cline/cline) — см. [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE) — форк Agentario распространяется на тех же условиях.
