# Debug Harness

An HTTP-controlled debug server for the Agentario VSCode extension. Provides
programmatic access to:

- **Extension host debugging** (Node.js): breakpoints, evaluate, step, pause/resume via CDP
- **Webview debugging** (Chrome): breakpoints, evaluate via CDP
- **UI automation**: click, type, screenshot, open sidebar via Playwright (visible mode only)
- **Hidden mode**: VS Code runs off-screen by default, controlled via CDP bridge (no UI clicks)
- **Sourcemap resolution**: set breakpoints by original source file + line
- **Data isolation**: separate `~/.agentario-lab` profile so debugee doesn't interfere with debugger
- **OAuth testing**: browser URL capture, token inspection, callback simulation
- **Agentario Lab**: high-level API for agentic testing (create tasks, wait idle, export)

Designed to be driven from an agentic loop via `curl` commands or the `lab-client.ts` TS client.

Works on **Windows**, macOS, and Linux.

## Quick Start

```bash
# Terminal 1: Start the debug harness server
bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch --skip-build

# Terminal 2: Interact via curl
curl localhost:19229/api -d '{"method":"status"}'
curl localhost:19229/api -d '{"method":"lab.status"}'
curl localhost:19229/api -d '{"method":"ui.screenshot"}'

# Or use the CLI wrapper (Windows)
scripts\agentario-lab.cmd status
scripts\agentario-lab.cmd new-task "Hello, analyze this project"
scripts\agentario-lab.cmd wait-idle --timeout 600000
scripts\agentario-lab.cmd export Exports\lab-run.md
```

## Server Options

```
bun apps/vscode/src/dev/debug-harness/server.ts [options]

Options:
  --skip-build        Skip building extension/webview (use existing dist/)
  --auto-launch       Automatically launch VSCode on startup
  --workspace PATH    Workspace directory to open (default: <os.tmpdir>/agentario-lab-workspace)
  --port PORT         Server port (default: 19229)
  --cline-dir PATH    Override the debugee's CLINE_DIR (default: ~/.agentario-lab)
  --vsix PATH         Install release VSIX instead of dev extension
  --visible           Show VS Code window (default: hidden off-screen)
  --launch-timeout MS Playwright launch timeout (default: 120000)
```

## Data Isolation

The debugee runs with `CLINE_DIR=~/.agentario-lab` by default, keeping its data
separate from the user's main Agentario installation. Override with `--cline-dir PATH`.

Screenshots go to `<os.tmpdir>/agentario-lab-debug/`.

## Agentario Lab API

High-level methods for automated testing. By default, these use the **CDP bridge** (`globalThis.agentario`) for invisible control — no Playwright UI clicks. VS Code runs hidden (off-screen).
with disk-based state detection.

### lab.status

Returns VS Code state, active task count, idle flag, and last message preview.

```bash
curl localhost:19229/api -d '{"method":"lab.status"}'
```

### lab.new_task

Creates a new task (opens sidebar + sends message). Returns when the message is dispatched.

```bash
curl localhost:19229/api -d '{"method":"lab.new_task","params":{"text":"Analyze this project"}}'
```

### lab.followup

Sends a followup response to an active ask.

```bash
curl localhost:19229/api -d '{"method":"lab.followup","params":{"text":"Continue"}}'
```

### lab.wait_idle

Polls `ui_messages.json` on disk until no `partial: true` messages remain and
the last message is stale (>2s old). Returns `idle` or `timeout`.

```bash
curl localhost:19229/api -d '{"method":"lab.wait_idle","params":{"timeout":600000}}'
```

### lab.get_messages

Returns recent messages from the most recent task's `ui_messages.json`.

```bash
curl localhost:19229/api -d '{"method":"lab.get_messages","params":{"count":20}}'
```

### lab.export_chat

Exports the most recent task to a markdown file. No Save Dialog.

```bash
curl localhost:19229/api -d '{"method":"lab.export_chat","params":{"outPath":"Exports/lab-run.md"}}'
```

### lab.screenshot

Alias for `ui.sidebar_screenshot`.

```bash
curl localhost:19229/api -d '{"method":"lab.screenshot"}'
```

### lab.export_context

Exports model context (system prompt + messages) from `api_conversation_history.json`.
Similar to the "Export context to file" button in the UI.

```bash
curl localhost:19229/api -d '{"method":"lab.export_context","params":{"outPath":"Exports/lab-run/context.txt"}}'
```

### lab.collect_session_files

Copies all session files into a single output directory:
- `ui_messages.json` — raw chat messages
- `api_conversation_history.json` — full API history
- `extension.log` — extension log for today
- `compaction/` — compaction debug files from today

```bash
curl localhost:19229/api -d '{"method":"lab.collect_session_files","params":{"outDir":"Exports/lab-run"}}'
```

### lab.run

Full automation cycle: launch, create task, wait for idle, export chat, export context, collect session files, screenshot.
Returns when the agent finishes responding (or timeout).

```bash
curl localhost:19229/api -d '{"method":"lab.run","params":{"text":"Analyze this project","workspace":"S:\\temo","timeout":900000}}'
```

Response:
```json
{
  "status": "completed",
  "steps": [
    {"step": "launch", "status": "ok", "detail": {...}},
    {"step": "open_sidebar", "status": "ok"},
    {"step": "new_task", "status": "ok"},
    {"step": "wait_idle", "status": "idle", "detail": {"elapsed": 45000}},
    {"step": "export_chat", "status": "ok", "detail": {"path": "..."}},
    {"step": "export_context", "status": "ok", "detail": {"path": "..."}},
    {"step": "collect_files", "status": "ok", "detail": {"files": [...]}},
    {"step": "screenshot", "status": "ok"}
  ],
  "outDir": "Exports/lab-run-1234567890",
  "taskId": "..."
}
```

## VSIX Launch Mode

To test a release VSIX (not dev extension):

```bash
bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch --vsix release/agentario-0.14.52.vsix
```

This uses `--install-extension=PATH` instead of `--extensionDevelopmentPath`.

## CLI Wrapper (Windows)

```bat
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --vsix release\agentario-0.14.52.vsix
scripts\agentario-lab.cmd new-task "Analyze this project"
scripts\agentario-lab.cmd wait-idle --timeout 900000
scripts\agentario-lab.cmd export Exports\lab-run.md
scripts\agentario-lab.cmd screenshot
scripts\agentario-lab.cmd stop
```

## TypeScript Client

```typescript
import { LabClient } from "./lab-client"

const lab = new LabClient()
await lab.launch({ workspace: "Z:\\T\\TEMO" })
await lab.newTask("Analyze this project")
const result = await lab.waitIdle({ timeout: 600000 })
const msgs = await lab.getMessages({ count: 10 })
const exported = await lab.exportChat({ outPath: "Exports/lab-run.md" })
```

## Low-level API Reference

### Lifecycle

| Method | Params | Description |
|--------|--------|-------------|
| `launch` | `{workspace?, skipBuild?}` | Build + download VSCode + launch Electron |
| `shutdown` | | Kill VSCode process |
| `status` | | Connection status, CDP state |

### Extension Host Debugging (ext.*)

| Method | Params | Description |
|--------|--------|-------------|
| `ext.set_breakpoint` | `{file, line, condition?}` | Set breakpoint by source file |
| `ext.set_breakpoint_raw` | `{url, line, column?, condition?}` | Set breakpoint by URL |
| `ext.remove_breakpoint` | `{breakpointId}` | Remove breakpoint |
| `ext.evaluate` | `{expression, callFrameId?}` | Evaluate in extension host |
| `ext.pause` | | Pause extension host |
| `ext.resume` | | Resume execution |
| `ext.step_over` | | Step over |
| `ext.step_into` | | Step into |
| `ext.step_out` | | Step out |
| `ext.call_stack` | | Get current call stack |
| `ext.scripts` | `{filter?}` | List loaded scripts |
| `ext.source_files` | | List source files in sourcemap |
| `ext.get_properties` | `{objectId}` | Get object properties |
| `ext.get_script_source` | `{scriptId}` | Get script source |

### Webview Debugging (web.*)

| Method | Params | Description |
|--------|--------|-------------|
| `web.set_breakpoint` | `{url, line, column?, condition?}` | Set breakpoint in webview |
| `web.remove_breakpoint` | `{breakpointId}` | Remove breakpoint |
| `web.evaluate` | `{expression, callFrameId?}` | Evaluate in webview |
| `web.post_message` | `{message}` | Send postMessage to webview |
| `web.pause` | | Pause webview |
| `web.resume` | | Resume execution |

### UI Automation (ui.*)

| Method | Params | Description |
|--------|--------|-------------|
| `ui.screenshot` | `{fullPage?}` | Take screenshot |
| `ui.sidebar_screenshot` | | Screenshot of sidebar frame |
| `ui.click` | `{selector, frame?, delay?}` | Click element |
| `ui.fill` | `{selector, text, frame?}` | Fill input |
| `ui.press` | `{key}` | Press key |
| `ui.type` | `{text, delay?}` | Type text |
| `ui.open_sidebar` | | Open Agentario sidebar tab |
| `ui.frames` | | List all frames |
| `ui.wait_for_selector` | `{selector, frame?, timeout?}` | Wait for element |
| `ui.command_palette` | `{command}` | Open command palette and run command |
| `ui.get_text` | `{selector, frame?}` | Get element text |
| `ui.locator` | `{role?, name?, testId?, text?, ...}` | Rich Playwright locator |
| `ui.react_input` | `{selector?, text, clear?, submit?}` | Set text in React-controlled textarea |
| `ui.send_message` | `{text, images?, files?, responseType?}` | Send chat message via gRPC |

### Navigation Shortcuts

| Command | Description |
|---------|-------------|
| `agentario.plusButtonClicked` | New task (chat view) |
| `agentario.historyButtonClicked` | Task history view |
| `agentario.settingsButtonClicked` | Settings view |
| `agentario.mcpButtonClicked` | MCP servers view |
| `agentario.accountButtonClicked` | Account view |
| `agentario.worktreesButtonClicked` | Worktrees view |

```bash
# New task
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"agentario.plusButtonClicked"}}'

# Navigate to history view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"agentario.historyButtonClicked"}}'

# Navigate to settings view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"agentario.settingsButtonClicked"}}'
```

## Debug Mode

The harness writes `.js.map` files alongside the built extension and connects
to the extension host's V8 inspector on port `9230`.

**First launch:** Start the debug harness with `--auto-launch` to build the
extension and launch VSCode with debugging enabled.

```bash
bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch
```

This will:
1. Build the extension (unminified, with sourcemaps)
2. Build the webview (unminified, with inline sourcemaps)
3. Download a compatible VSCode version
4. Launch it with the Agentario extension in development mode
5. Connect CDP to the extension host

## Claude Code Integration

When using Claude Code (cursor-agent), prefer the Python `lab-client.ts`
TypeScript client over raw `curl` commands. The client provides typed methods
and handles JSON serialization.

## Examples

### Set Breakpoint and Inspect

```bash
# Set breakpoint in extension
curl localhost:19229/api -d '{"method":"ext.set_breakpoint","params":{"file":"src/extension.ts","line":42}}'

# Trigger the code path (e.g., by clicking in the webview)
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"ui.click","params":{"selector":"[data-testid=\\"chat-input\\"]"}}'

# Check if paused
curl localhost:19229/api -d '{"method":"ext.call_stack"}'

# Evaluate expression
curl localhost:19229/api -d '{"method":"ext.evaluate","params":{"expression":"process.env"}}'

# Resume
curl localhost:19229/api -d '{"method":"ext.resume"}'
```

### Automated Smoke Test

```bash
# Start harness with a fixture workspace
bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch --workspace path/to/fixture

# Wait for sidebar
curl localhost:19229/api -d '{"method":"ui.wait_for_selector","params":{"selector":"[data-testid=\\"chat-input\\"]","timeout":30000}}'

# Send a test message
curl localhost:19229/api -d '{"method":"lab.new_task","params":{"text":"Hello, this is a test"}}'

# Wait for completion
curl localhost:19229/api -d '{"method":"lab.wait_idle","params":{"timeout":120000}}'

# Export the chat
curl localhost:19229/api -d '{"method":"lab.export_chat","params":{"outPath":"Exports/smoke-test.md"}}'

# Verify the export
cat Exports/smoke-test.md
```

### OAuth Testing

```bash
# Open sidebar (OAuth flow starts, browser URL is captured instead of opening)
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
sleep 2

# Check captured URLs
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'
# Returns: {"urls":[{"timestamp":...,"url":"https://app.cline.bot/oauth?..."}]}

# Simulate callback
curl localhost:19229/api -d '{"method":"oauth.simulate_callback","params":{"url":"https://app.cline.bot/oauth/callback?code=TEST123"}}'

# Check stored token
curl localhost:19229/api -d '{"method":"oauth.read_stored_token"}'
```

## Troubleshooting

### "No sidebar frame found"

The Agentario webview may not have loaded yet. Try:

```bash
# Check what frames exist
curl localhost:19229/api -d '{"method":"ui.frames"}'

# Wait for the sidebar
curl localhost:19229/api -d '{"method":"ui.wait_for_selector","params":{"selector":"[data-testid=\\"chat-input\\"]","timeout":30000}}'
```

### "Webview CDP not connected"

The webview inspector may need explicit connection. After launch:

```bash
curl localhost:19229/api -d '{"method":"connect_webview"}'
```

### Port Conflicts

If port `9230` (extension inspector) or `19229` (harness) is in use:

```bash
# Kill existing processes on the port (Windows)
netstat -ano | findstr :19229
taskkill /PID <pid> /F

# Or use a different port
bun apps/vscode/src/dev/debug-harness/server.ts --port 19230
```

### Launch Timeout

First launch downloads VSCode (~100MB). If it times out:

```bash
bun apps/vscode/src/dev/debug-harness/server.ts --launch-timeout 300000
```

### Windows-Specific Issues

- Paths use `os.tmpdir()` for screenshots and workspace
- Command palette uses `Control+Shift+p` (not `Meta+Shift+p`)
- Profile dir: `%USERPROFILE%\.agentario-lab`
