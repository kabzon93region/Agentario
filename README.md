<p align="center">

  <img src="assets/icons/icon.png" width="80" alt="Agentario" />

</p>



<h1 align="center">Agentario</h1>



<p align="center">

Autonomous coding agent for VS Code вЂ” **Р°РІС‚РѕРЅРѕРјРЅС‹Р№ РїСЂРѕРґСѓРєС‚** РґР»СЏ Р»РѕРєР°Р»СЊРЅС‹С… LLM (LM Studio, Ollama). Р‘РµР· Р°РєРєР°СѓРЅС‚Р° Cline Рё Р±РµР· РѕР±СЏР·Р°С‚РµР»СЊРЅРѕРіРѕ РёРЅС‚РµСЂРЅРµС‚Р°.

</p>



<p align="center">

<strong>Версия расширения: 0.14.79</strong> · <a href="CHANGELOG.md">Changelog</a> · <a href="VERSIONING.md">Схема версий</a>

</p>



<div align="center">



<table>

<tbody>

<tr>

<td align="center"><a href="https://github.com/kabzon93region/Agentario"><strong>GitHub</strong></a></td>

<td align="center"><a href="CHANGELOG.md"><strong>Changelog</strong></a></td>

<td align="center"><a href="VERSIONING.md"><strong>Р’РµСЂСЃРёРё</strong></a></td>

<td align="center"><a href="https://github.com/kabzon93region/Agentario#readme" target="_blank"><strong>Docs</strong></a></td>

</tr>

</tbody>

</table>



</div>



## Р‘С‹СЃС‚СЂС‹Р№ СЃС‚Р°СЂС‚ (VS Code)



1. РЎРѕР±РµСЂРёС‚Рµ РёР»Рё СЃРєР°С‡Р°Р№С‚Рµ VSIX: `release/agentario-0.14.48.vsix` (СЃР±РѕСЂРєР°: `build.cmd` РЅР° Windows).

2. VS Code в†’ Extensions в†’ `...` в†’ **Install from VSIX**.

3. РџСЂРѕРІР°Р№РґРµСЂ **LM Studio** РёР»Рё **Ollama** вЂ” СЃРј. [РЅР°СЃС‚СЂРѕР№РєСѓ LM Studio](#lm-studio-Р»РѕРєР°Р»СЊРЅР°СЏ-РјРѕРґРµР»СЊ) РЅРёР¶Рµ.

4. MCP (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ): `setup-mcp.cmd` вЂ” memory, sequential-thinking, playwright, trueline (РїСЂР°РІРєР° С„Р°Р№Р»РѕРІ).



### РђРІС‚РѕРЅРѕРјРЅС‹Р№ СЂРµР¶РёРј (Р±РµР· Cline cloud)



Agentario РїРѕСЃС‚Р°РІР»СЏРµС‚СЃСЏ СЃ `endpoints.json` РІ VSIX в†’ СЂРµР¶РёРј **selfHosted**:



- **РќРµ РЅСѓР¶РµРЅ** Р°РєРєР°СѓРЅС‚ Cline, OAuth Рё РёРЅС‚РµСЂРЅРµС‚ РґР»СЏ СЂР°Р±РѕС‚С‹ С‡Р°С‚Р° (РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ LM Studio / Ollama).

- РћР±Р»Р°С‡РЅС‹Рµ РїСЂРѕРІР°Р№РґРµСЂС‹ Cline (`cline`, `cline-pass`) СЃРєСЂС‹С‚С‹; С‚РµР»РµРјРµС‚СЂРёСЏ Рё remote config РѕС‚РєР»СЋС‡РµРЅС‹.

- MCP вЂ” Р»РѕРєР°Р»СЊРЅС‹Рµ РїСЂРѕС†РµСЃСЃС‹ С‡РµСЂРµР· `npx` (РїРµСЂРІС‹Р№ Р·Р°РїСѓСЃРє РјРѕР¶РµС‚ РїРѕС‚СЂРµР±РѕРІР°С‚СЊ npm; РґР»СЏ offline СЃРј. `setup-mcp.cmd` СЃ РєСЌС€РµРј РїР°РєРµС‚РѕРІ).

- РЎРІРѕР№ `~/.agentario/endpoints.json` вЂ” СЃРј. `config/agentario-endpoints.json`.

- **РЎРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚ Рё Rules:** СЃРј. [config/PROMPTS_AND_RULES.md](config/PROMPTS_AND_RULES.md).



### РЎР±РѕСЂРєР° (Windows)



### РЎР±РѕСЂРєР° Рё СЂРµР»РёР· (Windows)



```bat

build.cmd

publish-release.cmd

```



- **`build.cmd`** в†’ `release/agentario-<version>.vsix`

- **`publish-release.cmd`** в†’ GitHub: commit, tag, Release + VSIX ([config/RELEASE.md](config/RELEASE.md))



### LM Studio (Р»РѕРєР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ)



| Р“РґРµ | Р§С‚Рѕ |

|-----|-----|

| **РЎРµСЂРІРµСЂ LM Studio** | Р—Р°РіСЂСѓР·РёС‚СЊ РјРѕРґРµР»СЊ, Local Server, РїРѕСЂС‚ `1234`, РґРѕСЃС‚СѓРї РїРѕ LAN |

| **VS Code + Agentario** | РџСЂРѕРІР°Р№РґРµСЂ LM Studio, URL `http://<ip>:1234`, РІС‹Р±СЂР°С‚СЊ Р·Р°РіСЂСѓР¶РµРЅРЅСѓСЋ РјРѕРґРµР»СЊ |



MCP Рё РёРЅРґРµРєСЃР°С†РёСЏ codebase СЂР°Р±РѕС‚Р°СЋС‚ РЅР° **РџРљ СЃ VS Code**, РЅРµ РЅР° РјР°С€РёРЅРµ СЃ LM Studio.



#### Р“РµРЅРµСЂР°С†РёСЏ: thinking budget в‰  Р»РёРјРёС‚ РѕС‚РІРµС‚Р°



Р’ LM Studio СЌС‚Рѕ **СЂР°Р·РЅС‹Рµ** РЅР°СЃС‚СЂРѕР№РєРё:



| РџР°СЂР°РјРµС‚СЂ | Р§С‚Рѕ РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ |

|----------|------------------|

| **Thinking / reasoning budget** | РўРѕР»СЊРєРѕ Р±Р»РѕРє СЂР°Р·РјС‹С€Р»РµРЅРёР№; РїРѕСЃР»Рµ Р»РёРјРёС‚Р° РјРѕРґРµР»СЊ Р·Р°РєСЂС‹РІР°РµС‚ thinking Рё РїРёС€РµС‚ РѕС‚РІРµС‚ |

| **Max tokens / РґР»РёРЅР° РѕС‚РІРµС‚Р°** | Р’СЃСЏ РіРµРЅРµСЂР°С†РёСЏ (thinking + РѕС‚РІРµС‚ + tool calls) |



Р•СЃР»Рё РѕР±Р° СЃС‚РѕСЏС‚ РЅР° **512**, СЂР°Р·РјС‹С€Р»РµРЅРёРµ РјРѕР¶РµС‚ СЃСЉРµСЃС‚СЊ РїРѕС‡С‚Рё РІРµСЃСЊ Р±СЋРґР¶РµС‚ вЂ” РѕС‚С‡С‘С‚ РІ С‡Р°С‚Рµ РѕР±РѕСЂРІС‘С‚СЃСЏ mid-sentence (`out: 512`). РЎ **0.14.36** Agentario РґР»СЏ LM Studio/Ollama С€Р»С‘С‚ `maxTokensPerTurn = 4096`. Р’ UI LM Studio С‚РѕР¶Рµ СЃРЅРёРјРёС‚Рµ Р¶С‘СЃС‚РєРёР№ РїРѕС‚РѕР»РѕРє РѕС‚РІРµС‚Р° (РёР»Рё РїРѕСЃС‚Р°РІСЊС‚Рµ в‰Ґ 2вЂ“4k), РµСЃР»Рё РЅСѓР¶РЅС‹ РґР»РёРЅРЅС‹Рµ РёС‚РѕРіРё.



#### РРЅРґРµРєСЃР°С†РёСЏ (embeddings)



- РќСѓР¶РЅР° РјРѕРґРµР»СЊ РІ **embedding-СЃР»РѕС‚Рµ** LM Studio (type `embeddings` РІ API), РЅРµ chat-РјРѕРґРµР»СЊ РёР· LLM-СЃР»РѕС‚Р°.

- РњРѕРґРµР»СЊ РІСЂРѕРґРµ `lfm2.5-embedding-350m`: **My Models в†’ вљ™пёЏ в†’ Domain Type в†’ Embedding**, Р·Р°С‚РµРј Load РІ Developer.

- РџРѕСЃР»Рµ СЃРјРµРЅС‹ domain РєРѕРЅС‚РµРєСЃС‚ embedding-РјРѕРґРµР»Рё РјРѕР¶РµС‚ СѓРјРµРЅСЊС€РёС‚СЊСЃСЏ (РЅР°РїСЂРёРјРµСЂ 120k в†’ 20k) вЂ” СЌС‚Рѕ РЅРѕСЂРјР°Р»СЊРЅРѕ РґР»СЏ СЌРєРѕРЅРѕРјРёРё VRAM.

- РџРѕРґСЂРѕР±РЅРѕ: [`config/lmstudio-indexing.md`](config/lmstudio-indexing.md).



#### LM Studio Р±РµР· GUI (headless)



РќР° РџРљ СЃ СЃРµСЂРІРµСЂРѕРј LM Studio РјРѕР¶РЅРѕ РЅРµ РґРµСЂР¶Р°С‚СЊ РѕРєРЅРѕ РїСЂРёР»РѕР¶РµРЅРёСЏ:



```bat

scripts\lmstudio-headless-server.cmd

```



Р РµР¶РёРј `restore` вЂ” `lms daemon up` + `lms server start` (РїРѕСЃР»РµРґРЅРёРµ РЅР°СЃС‚СЂРѕР№РєРё Р·Р°РіСЂСѓР·РєРё РёР· LM Studio).  

Р РµР¶РёРј `load` вЂ” СЏРІРЅР°СЏ Р·Р°РіСЂСѓР·РєР° chat + embedding СЃ `--context-length` РёР· СЃРєСЂРёРїС‚Р°.  

Р”РѕРєСѓРјРµРЅС‚Р°С†РёСЏ LM Studio: [headless](https://lmstudio.ai/docs/developer/core/headless), [lms CLI](https://lmstudio.ai/docs/cli).



### MCP



**РўСЂРµР±СѓРµС‚СЃСЏ Node.js LTS** (РґР»СЏ stdio-СЃРµСЂРІРµСЂРѕРІ: memory, sequential-thinking, playwright). VS Code РЅРµ РІРёРґРёС‚ `npx`, РµСЃР»Рё Node РЅРµ РІ **СЃРёСЃС‚РµРјРЅРѕРј** PATH вЂ” СЃРєСЂРёРїС‚ `setup-mcp.cmd` РїСЂРѕРїРёСЃС‹РІР°РµС‚ РїРѕР»РЅС‹Р№ РїСѓС‚СЊ Рє `npx.cmd`.



```bat

setup-mcp.cmd

```



РљРѕРЅС„РёРі: `%USERPROFILE%\.agentario\data\settings\agentario_mcp_settings.json` (legacy: `.cline\...\cline_mcp_settings.json`). РЁР°Р±Р»РѕРЅ: `config/agentario-recommended-mcp.json`.



Playwright MCP (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ):



```powershell

& "C:\path\to\npx.cmd" playwright install chromium

```



### РџСЂР°РІРёР»Р° Рё РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ



| РћР±Р»Р°СЃС‚СЊ | РџСѓС‚СЊ |

|---------|------|

| Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ РїСЂР°РІРёР»Р° | `Documents\Agentario\Rules\` |

| Р”Р°РЅРЅС‹Рµ СЂР°СЃС€РёСЂРµРЅРёСЏ | `%USERPROFILE%\.agentario\` |

| РџСЂР°РІРёР»Р° РїСЂРѕРµРєС‚Р° | `.agentariorules` РёР»Рё `.agentario\rules\` |

| РСЃРєР»СЋС‡РµРЅРёСЏ С„Р°Р№Р»РѕРІ | `.agentarioignore` (legacy: `.clineignore`) |



РЎС‚Р°СЂС‹Рµ РїСѓС‚Рё Cline (`.cline`, `.clinerules`, `Documents\Cline`) РїРѕ-РїСЂРµР¶РЅРµРјСѓ С‡РёС‚Р°СЋС‚СЃСЏ РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё.



---



<div align="center">



<div align="center">

<table>

<tbody>

<td align="center">

<a href="https://github.com/kabzon93region/Agentario#readme" target="_blank"><strong>Docs</strong></a>

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

| **Agentario (VS Code)** | Р¤РѕСЂРє Cline: СЂСѓСЃСЃРєРёР№ UI, LM Studio, СЃР±РѕСЂРєР° Windows, MCP-С€Р°Р±Р»РѕРЅС‹. | [`apps/vscode/`](apps/vscode/) | [CHANGELOG.md](CHANGELOG.md) |

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



Р¤РѕСЂРє РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ РІ [kabzon93region/Agentario](https://github.com/kabzon93region/Agentario). Upstream: [cline/cline](https://github.com/cline/cline) вЂ” СЃРј. [CONTRIBUTING.md](CONTRIBUTING.md).



## License



[Apache 2.0 В© 2026 Cline Bot Inc.](./LICENSE) вЂ” С„РѕСЂРє Agentario СЂР°СЃРїСЂРѕСЃС‚СЂР°РЅСЏРµС‚СЃСЏ РЅР° С‚РµС… Р¶Рµ СѓСЃР»РѕРІРёСЏС….

