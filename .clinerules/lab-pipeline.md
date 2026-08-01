# Agentario Lab Pipeline — Automated API Rules

## Purpose

This file is the **authoritative reference** for any automated Agentario pipeline run via the REST API. It ensures no step is forgotten, chat lifecycle is managed correctly, and all data is collected in the right order.

---

## API Reference (port 19231)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check — `{status, version, port}` |
| GET | `/api/status` | Full status — `{taskId, idle, busy, phase, messageCount, verdict, ...}` |
| POST | `/api/new_task` | Create task. Body: `{text, fresh?}`. `fresh=true` stops+deletes current chat first |
| POST | `/api/followup` | Send followup. Body: `{text}` |
| POST | `/api/stop` / `/api/cancel` | Stop agent. Body: `{timeout?}` |
| POST | `/api/clear` | **Close** current chat, return to home (does NOT delete) |
| POST | `/api/delete_task` | Stop + delete chat silently |
| GET | `/api/messages` | Recent messages. Query: `?limit=N` |
| GET | `/api/context` | Model context (system prompt + messages) |
| GET | `/api/export_chat` | Chat as markdown. Query: `?outPath=...` |
| GET | `/api/wait_idle` | Poll until idle. Query: `?timeout=600000&pollMs=3000` |
| GET | `/api/logs` | Extension log. Query: `?tail=N` |
| GET | `/api/compaction_files` | List compaction debug files |
| GET | `/api/collect` | Copy session files to output dir. Query: `?outDir=...` |
| POST | `/api/compact` | Summarize. Body: `{mode: "context"|"full"}` |
| POST | `/api/install_vsix` | Install VSIX. Body: `{vsixPath}` |
| POST | `/api/restart` | Reload VS Code window |

---

## Pipeline Phases (Exact Sequence)

```
Phase 0: Pre-flight
Phase 1: Clean Slate (ensure home screen)
Phase 2: Create Task
Phase 3: Wait for Completion
Phase 4: Triple Collection Cycle
Phase 5: Close Chat
Phase 6: Analysis & Recovery
```

### Phase 0 — Pre-flight

1. `GET /health` — verify API is alive, check version
2. `GET /api/status` — snapshot current state, save `status-before.json`

### Phase 1 — Clean Slate (ensure home screen)

3. `POST /api/stop {timeout: 90000}` — stop any running agent
4. `POST /api/delete_task {}` — delete current chat
5. `GET /api/status` — verify **NO** taskId (home screen)
6. If taskId still present: `POST /api/clear {}`, wait 1s, re-check
7. **GATE**: taskId must be null, busy must be false — **NEVER proceed without this confirmation**

### Phase 2 — Create Task

8. `POST /api/new_task {text: PROMPT, fresh: true}`
9. Wait 2s
10. `GET /api/messages?limit=5` — verify prompt text appears in first message
11. Save `new_task.json`, `prompt.txt`

### Phase 3 — Wait for Completion

12. Poll `GET /api/status` every 15s (timeout 900s)
13. On each message count change: save context + messages snapshots to `snapshots/`
14. Idle conditions (ALL must be true):
    - `idle = true`
    - `busy = false`
    - `phase` not in `("streaming", "awaiting_approval")`
    - `messageCount >= 3`
    - elapsed > 30s (warmup)
15. On first idle detection: wait 5s, re-check (avoid flicker)
16. Final verdict check:
    - `verdict = "ok"` → pass
    - `verdict = "idle_with_error"` → fail (loop / mistake_limit)
    - `verdict = "incomplete"` → fail

### Phase 4 — Triple Collection Cycle

#### Collection #1 — Raw Results (immediately after task completion)

17. Save `final-status.json`
18. Save `messages.json` (limit=200)
19. `GET /api/export_chat?outPath=...` → save `chat-export.md`
20. `GET /api/context` → save `context-export.txt`
21. `GET /api/logs?tail=500` → save `extension-logs.txt`
22. `GET /api/compaction_files` → save `compaction-index.json`
23. `GET /api/collect?outDir=...` → save `collect_result.json`, copies ui_messages.json, api_conversation_history.json, logs, compaction files
24. Validate green completion: check `ui_messages.json` for `say:completion_result` with non-empty text

#### Context Summarization → Collection #2

25. `POST /api/compact {mode: "context"}` → save `compact_result.json`
26. Wait for `busy=false` (poll every 3s, max 120s)
27. Re-collect into `compact-context/` subdirectory:
    - `messages.json` from `GET /api/messages?limit=200`
    - `context.txt` from `GET /api/context`
    - `status.json` from `GET /api/status`
    - `chat-export.md` from `GET /api/export_chat`
    - `extension-logs.txt` from `GET /api/logs?tail=500`
    - Full session files via `GET /api/collect?outDir=compact-context/`
28. Validate: `compacted` field in compact_result, `reason`, `contextReduction` %

#### Full Chat Summarization → Collection #3

29. `POST /api/compact {mode: "full"}` → save `compact_result_full.json`
30. Wait for `busy=false` (poll every 3s, max 120s)
31. Re-collect into `compact-full/` subdirectory (same files as Collection #2)
32. Validate: same fields as context compact

### Phase 5 — Close Chat

33. `POST /api/clear` — close current chat, return to home
34. `GET /api/status` — verify `taskId=null`, `busy=false`
35. **GATE**: Must be on home screen before analysis begins

### Phase 6 — Analysis & Recovery

36. Read all 3 collections and compare
37. Validation checklist per collection:
    - `idleConfirmed=true`
    - `greenCompletion=true` (say:completion_result exists)
    - `compactOk=true` (for collections #2 and #3)
    - `verdict=ok`
    - No forbidden tool calls (e.g., executing in VS Code install dir)
    - Response content relevant to the task
38. If problems found:
    - Diagnose root cause from logs/messages/context
    - Fix code
    - `build.cmd` → new VSIX
    - `POST /api/install_vsix {vsixPath: "release/agentario-X.Y.Z.vsix"}`
    - `POST /api/restart` → reload VS Code window
    - Wait 10-15s for extension to load
    - Re-run pipeline from Phase 0

---

## Chat Lifecycle Rules

These rules prevent state corruption and ensure clean transitions:

1. **After task completion, BEFORE analysis**: ALWAYS close chat via `POST /api/clear` (not delete)
2. **Before creating new chat**: ALWAYS verify home screen via `GET /api/status`:
   - `taskId` must be null
   - `busy` must be false
   - `phase` must not be `streaming`
3. **Never assume state** — always check via `GET /api/status` before any operation
4. `POST /api/clear` = close chat → user sees recent chats list → can start new chat
5. `POST /api/delete_task` = stop + delete → used in Phase 1 cleanup only, NOT for normal close
6. `POST /api/new_task` with `fresh: true` internally does stop + delete, but explicit Phase 1 cleanup is still recommended for predictable state

### State Verification Pattern

```python
# Before any chat operation:
status = api("GET", "/api/status")
assert status["taskId"] is None, "Still on a chat — need to clear first"
assert status["busy"] is False, "Agent still busy — need to stop first"
```

---

## Summarization Rules

### Context Compact (`mode: "context"`)
- Compresses older messages into a summary, preserving recent context
- Appropriate when context window is getting large
- Returns: `{compacted, reason, contextBeforeChars, contextAfterChars, contextReduction}`

### Full Compact (`mode: "full"`)
- Compresses the entire chat history
- More aggressive — suitable for long sessions
- Returns same fields as context compact

### Forced Wrap-up (manual compaction, v0.14.70+)
- Activated automatically for `mode: "manual"` (or `compactionMode: "full"`) when `findWrapUpRange()` finds a valid range
- **Preserves anchors**: first user-turn (task) + last substantive assistant text (answer)
- **Folds middle**: all messages between anchors (tools, thinking, file reads) are summarized
- Uses `WRAP_UP_PROMPT_BEFORE` / `WRAP_UP_PROMPT_AFTER` with "Находки из файлов" section
- Result: `[firstTask, compaction_summary, lastAnswer]` — exactly 3 messages
- Skip reasons: `no_foldable_middle` (nothing between anchors), `empty_summary` (model returned empty), `summary_error` (model error)
- Falls back to standard `findCutIndex` if no valid wrap-up range (e.g., mid-flight agent)

### Validation
- `compacted = true` → success, check `contextReduction` for effectiveness
- `compacted = false` + reason → check reason:
  - Legitimate skip: `"no_messages"`, `"no_active_task"`, `"session_busy"`, `"no_task"`, `"no_foldable_middle"`, or Russian messages about minimum thresholds
  - Failure: `"empty_summary"`, `"summary_error"`, or any other reason
- After compact: always wait for `busy=false` before collecting data
- Check compaction debug files in `compaction-index.json` for request/response details

---

## Output Directory Structure

```
Exports/lab-run-YYYYMMDD-HHMMSS/
  ├── pipeline.log                    # Full pipeline log
  ├── prompt.txt                      # The prompt sent to Agentario
  ├── status-before.json              # Status before cleanup
  ├── status-home.json                # Status after cleanup (should be home)
  ├── stop.json                       # Stop result
  ├── delete.json                     # Delete result
  ├── new_task.json                   # New task result
  ├── messages-early.json             # First messages after task creation
  ├── snapshots/                      # Periodic snapshots during wait
  │   ├── ctx-1.json, ctx-2.json, ...
  │   └── msgs-1.json, msgs-2.json, ...
  ├── final-status.json               # Status at completion
  ├── messages.json                   # All messages (limit=200)
  ├── chat-export.md                  # Full chat as markdown
  ├── context-export.txt              # Model context
  ├── extension-logs.txt              # Extension logs
  ├── compaction-index.json           # Compaction file list
  ├── ui_messages.json                # Raw UI messages
  ├── collect_result.json             # Full session file collection
  ├── compact_result.json             # Context compact result
  ├── compact-context/                # Collection #2 — after context compact
  │   ├── messages.json
  │   ├── context.txt
  │   ├── status.json
  │   ├── chat-export.md
  │   └── ...
  ├── compact_result_full.json        # Full chat compact result
  ├── compact-full/                   # Collection #3 — after full compact
  │   ├── messages.json
  │   ├── context.txt
  │   ├── status.json
  │   ├── chat-export.md
  │   └── ...
  ├── SUMMARY.txt                     # Final summary
  └── DONE                            # OK / ERROR / TIMEOUT
```

---

## Error Recovery Loop

When the pipeline detects a failure:

1. **Diagnose**: Read logs, messages, context to find root cause
2. **Fix**: Modify code to address the issue
3. **Build**: Run `build.cmd` → produces `release/agentario-X.Y.Z.vsix`
4. **Install**: `POST /api/install_vsix {vsixPath: "release/agentario-X.Y.Z.vsix"}`
5. **Restart**: `POST /api/restart` → reload VS Code window
6. **Wait**: 10-15 seconds for extension to fully load
7. **Re-run**: Start from Phase 0

### Consecutive Clean Runs

To verify fixes are stable, loop the pipeline until N consecutive runs pass without errors:

```
clean_streak = 0
target = 2  # two consecutive clean runs

while clean_streak < target:
    result = run_pipeline()
    if result == OK:
        clean_streak += 1
    else:
        clean_streak = 0
        # diagnose, fix, build, install, restart
```

---

## Standard Prompt (TEMO smoke test)

```
Ознакомься с документацией проекта (если есть).
Ознакомься с историей чатов и изменений проекта (если есть).
Проанализируй файл правил работы с проектом (если есть).
Проанализируй структуту папок проекта.
Ознакомься с прогрессом проекта и его планами (если есть).
Пойми чем занимаемся в проекте, что он из себя представляет и на каком этапе мы находимся.
```

---

## Key Files

| What | Path |
|------|------|
| Pipeline script | `Exports/_run_pipeline.py` |
| REST API server | `apps/vscode/src/dev/agentario-api-server.ts` |
| Compaction coordinator | `apps/vscode/src/sdk/sdk-compaction-coordinator.ts` |
| Debug harness | `apps/vscode/src/dev/debug-harness/server.ts` |
| Lab skill docs | `.agents/skills/agentario-lab/SKILL.md` |
| Build script | `build.cmd` |
