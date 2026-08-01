# Debug Harness & Agentario Lab

HTTP-controlled debugger for the VSCode extension at `apps/vscode/src/dev/debug-harness/server.ts`.

## Quick start

```bash
# Build extension first if needed:
build.cmd

# Launch (skip-build if already built):
bun apps/vscode/src/dev/debug-harness/server.ts --skip-build --auto-launch

# In another terminal:
curl localhost:19229/api -d '{"method":"status"}'
curl localhost:19229/api -d '{"method":"lab.status"}'
```

## Agentario Lab - High-level API

For automated testing, use the REST API (port 19231) or CLI. VS Code runs **hidden** (off-screen) by default. Use --visible to see the window.

### Extension REST API (preferred)

```bash
# Health check
curl http://localhost:19231/health

# Create a task
curl -X POST http://localhost:19231/api/new_task -H "Content-Type: application/json" -d '{"text":"Analyze this project"}'

# Wait for idle
curl http://localhost:19231/api/wait_idle?timeout=600000

# Export chat
curl "http://localhost:19231/api/export_chat?outPath=Exports/lab.md"

# Get messages
curl http://localhost:19231/api/messages?limit=20
```

### CLI wrapper

```bat
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --vsix release\agentario-0.14.55.vsix
scripts\agentario-lab.cmd new-task "Analyze this project"
scripts\agentario-lab.cmd wait-idle --timeout 600000
scripts\agentario-lab.cmd export Exports\lab.md
scripts\agentario-lab.cmd stop
```

See `.agents/skills/agentario-lab/SKILL.md` for full documentation.

## Data Isolation

The debugee runs with `CLINE_DIR=~/.agentario-lab` by default, separate from your real Agentario config.
This prevents the debugee's logout from logging out the debugger, and vice versa.
Override with `--cline-dir /tmp/test-dir`. Check with `lab.status()` → `clineDir`.

## VSIX Launch Mode

Test a release VSIX:

```bash
bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch --vsix release/agentario-0.14.52.vsix
```

## Browser Capture & OAuth

The debugee runs with `CLINE_CAPTURE_BROWSER=1`, which intercepts `openExternal()` in
`src/utils/env.ts`. URLs are captured instead of opening a real browser:

- Logged to `$CLINE_DIR/data/debug-captured-urls.jsonl`
- POSTed in real-time to `/captured-url` on the harness server
- Queriable via `oauth.captured_urls`

## Windows

- Paths use `os.tmpdir()` for screenshots and workspace
- Command palette uses `Control+Shift+p` (not `Meta+Shift+p`)
- Profile dir: `%USERPROFILE%\.agentario-lab`
