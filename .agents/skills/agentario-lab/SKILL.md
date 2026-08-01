# Agentario Lab — Automated Testing Skill

## When to Use

Use this skill when you need to:
- Run automated smoke tests of Agentario in a separate VS Code instance
- Test a new VSIX build without manual clicking
- Verify agent behavior end-to-end (create task, wait for response, check export)
- Debug issues by controlling Agentario programmatically

## Hidden Mode (Default)

Lab runs VS Code **off-screen** by default (`--window-position=-32000,-32000`). The window is never visible and never steals focus. All interaction happens through the **native REST API** (port 19231) running inside the extension — no CDP, no Playwright UI clicks.

To see the VS Code window (for visual debugging), use `--visible` flag.

**No "autoclicker"**: Lab does not simulate mouse clicks or keyboard input on the visible UI. Tasks are created via REST API calls directly to the extension host (`/api/new_task`).

## Prerequisites

- **bun** installed and in PATH
- **LM Studio** running locally with a model loaded (or any OpenAI-compatible API)
- Agentario built: run `build.cmd` to produce `release/agentario-X.Y.Z.vsix`

## Quick Workflow

### 1. Start the Lab

```bat
:: Start harness with a workspace
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO

:: Or with a release VSIX
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --vsix release\agentario-0.14.52.vsix
```

By default, VS Code runs **hidden** (off-screen). To make it visible for debugging:

```bat
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --visible
```

Wait 10-30 seconds for VS Code to launch. Check status:

```bat
scripts\agentario-lab.cmd status
```

### 1b. Connect to Existing VS Code

If you already have VS Code running with Agentario (with `AGENTARIO_API_PORT=19231` in its env), you can control it directly via the REST API:

```bat
:: Check if extension API is available
curl http://localhost:19231/health

:: Create task directly
curl -X POST http://localhost:19231/api/new_task -H "Content-Type: application/json" -d "{\"text\": \"Hello\"}"
```

Or use the CLI (it automatically detects the API):

```bat
scripts\agentario-lab.cmd status
scripts\agentario-lab.cmd new-task "Analyze project"
```

No console windows, no extra VS Code instances needed when the extension API is running.

### 2. Create a Task

```bat
scripts\agentario-lab.cmd new-task "Ознакомься с документацией проекта. Проанализируй структуру."
```

### 3. Wait for Completion

```bat
:: Default timeout: 10 minutes (for local models)
scripts\agentario-lab.cmd wait-idle --timeout 600000
```

### 4. Export & Verify

```bat
scripts\agentario-lab.cmd export Exports\lab-run\chat-export.md
scripts\agentario-lab.cmd export-context Exports\lab-run\context-export.txt
scripts\agentario-lab.cmd collect Exports\lab-run
```

Then read the export files and check:
- `chat-export.md`: contains thinking blocks, tool calls, full agent response
- `context-export.txt`: contains system prompt and conversation messages
- No paths from `Program Files\Microsoft VS Code` (agent reads from project, not VS Code install)
- Response is relevant to the task
- Token stats are present
- No infinite loops or forbidden commands

### 4b. Full Export (chat + context + logs + compaction)

```bat
:: Collect all session files into a folder
scripts\agentario-lab.cmd collect Exports\lab-run
:: Export model context
scripts\agentario-lab.cmd export-context Exports\lab-run\context.txt
```

This copies: ui_messages.json, api_conversation_history.json, extension.log, compaction/ debug files.

### 5. Stop

```bat
scripts\agentario-lab.cmd stop
```

## One-Command Run (full automation)

Instead of step-by-step, use `run` to do everything automatically:

```bat
scripts\agentario-lab.cmd run --text "Ознакомься с документацией проекта (если есть). Ознакомься с историей чатов и изменений проекта (если есть). Проанализируй файл правил работы с проектом (если есть). Проанализируй структуру папок проекта. Ознакомься с прогрессом проекта и его планами (если есть). Пойми чем занимаемся в проекте, что он из себя представляет и на каком этапе мы находимся." --workspace S:\temo --timeout 900000
```

This will: launch VS Code, create task, wait for idle, export chat (full with thinking/tools), export context, collect logs + compaction files, take screenshot. All outputs go to `Exports/lab-run-<timestamp>/`.

## Output Structure

After a `run` or manual collection:

```
Exports/lab-<id>/
  chat-export.md           — full chat (thinking, tools, commands, agent text)
  context-export.txt       — model context (system prompt + messages)
  ui_messages.json         — raw messages
  api_conversation_history.json — full API history
  extension.log            — extension log for today
  compaction/              — compaction debug files (if compaction ran)
    REQUEST_*.txt
    PAYLOAD_*.json
    RESPONSE_*.txt
    compaction_*.txt
```

## TypeScript Client

For programmatic use from test scripts:

```typescript
import { LabClient } from "apps/vscode/src/dev/debug-harness/lab-client"

const lab = new LabClient()
await lab.launch({ workspace: "Z:\\T\\TEMO" })
await lab.newTask("Analyze this project")
const result = await lab.waitIdle({ timeout: 600000 })
console.log(result) // { status: "idle", elapsed: 45000, messageCount: 12 }

const exported = await lab.exportChat({ outPath: "Exports/lab-run.md" })
```

## curl Commands

### Extension REST API (port 19231) — preferred

```bash
# Health check
curl http://localhost:19231/health

# Status
curl http://localhost:19231/api/status

# New task
curl -X POST http://localhost:19231/api/new_task -H "Content-Type: application/json" -d '{"text":"Hello"}'

# Followup
curl -X POST http://localhost:19231/api/followup -H "Content-Type: application/json" -d '{"text":"Continue"}'

# Wait idle
curl http://localhost:19231/api/wait_idle?timeout=600000

# Get messages
curl http://localhost:19231/api/messages?limit=20

# Export chat
curl "http://localhost:19231/api/export_chat?outPath=Exports/lab.md"

# Export context
curl http://localhost:19231/api/context

# Cancel
curl -X POST http://localhost:19231/api/cancel
```

### Harness API (port 19229) — for lab.run lifecycle

```bash
# Full automation run
curl localhost:19229/api -d '{"method":"lab.run","params":{"text":"Analyze project","workspace":"Z:\\T\\TEMO"}}'

# Screenshot
curl localhost:19229/api -d '{"method":"lab.screenshot"}'

# Shutdown
curl localhost:19229/api -d '{"method":"shutdown"}'
```

## Smoke Test: TEMO

A minimal end-to-end test:

```bat
:: 1. Build
build.cmd

:: 2. Start lab
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --vsix release\agentario-0.14.52.vsix

:: 3. Wait for VS Code
timeout /t 15

:: 4. Create task
scripts\agentario-lab.cmd new-task "Ознакомься с документацией проекта. Ознакомься с историей чатов и изменений проекта."

:: 5. Wait for idle
scripts\agentario-lab.cmd wait-idle --timeout 900000

:: 6. Export
scripts\agentario-lab.cmd export Exports\smoke-temo.md

:: 7. Verify
type Exports\smoke-temo.md

:: 8. Stop
scripts\agentario-lab.cmd stop
```

Expected checks:
- [ ] Export file exists and is non-empty
- [ ] No paths from `Program Files\Microsoft VS Code`
- [ ] Agent response mentions TEMO or project structure
- [ ] No infinite loops (message count < 30)
- [ ] Token stats present in export

## LM Studio Setup

The isolated lab profile (`~/.agentario-lab`) needs its own settings. On first run:

1. Start the lab: `scripts\agentario-lab.cmd start`
2. Open the sidebar and configure LM Studio provider
3. Or copy seed defaults from main profile

The lab profile is separate from your main Agentario config, so changes won't affect your daily workflow.

## Troubleshooting

### Harness won't start
- Check if port 19229 is already in use: `netstat -ano | findstr :19229`
- Kill stale processes: `taskkill /PID <pid> /F`

### VS Code launch timeout
- Increase timeout: `--launch-timeout 300000`
- First launch downloads VS Code (~100MB), needs network

### wait_idle returns timeout
- Local models can be slow (5+ minutes for large contexts)
- Check screenshot: `scripts\agentario-lab.cmd screenshot`
- Increase timeout: `--timeout 1200000`

### Export is empty
- Check that the task actually completed: `scripts\agentario-lab.cmd get-messages`
- Verify the task directory exists: `dir %USERPROFILE%\.agentario-lab\tasks`

## File Locations

| What | Where |
|------|-------|
| REST API server | `apps/vscode/src/dev/agentario-api-server.ts` |
| Harness server | `apps/vscode/src/dev/debug-harness/server.ts` |
| Lab client | `apps/vscode/src/dev/debug-harness/lab-client.ts` |
| CLI wrapper | `scripts/agentario-lab.cmd` |
| Lab profile | `%USERPROFILE%\.agentario-lab` |
| Screenshots | `%TEMP%\agentario-lab-debug` |
| Exports | `Exports/` (project root) |
