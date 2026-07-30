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

For automated testing, use the lab.* methods. By default, VS Code runs **hidden** (off-screen) and all control happens via **CDP bridge** - no Playwright UI clicks. Use --visible to see the window.

```bash
# Create a task and wait for completion
curl localhost:19229/api -d '{"method":"lab.new_task","params":{"text":"Analyze this project"}}'
curl localhost:19229/api -d '{"method":"lab.wait_idle","params":{"timeout":600000}}'
curl localhost:19229/api -d '{"method":"lab.export_chat","params":{"outPath":"Exports/lab.md"}}'
```

Or use the CLI wrapper:

```bat
scripts\agentario-lab.cmd start --workspace Z:\T\TEMO --vsix release\agentario-0.14.52.vsix
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
