# Исправление архитектурных проблем Agent Mode

## Проблема 1: Workspace Root — инструменты сканируют не ту папку

**Причина:** Все инструменты используют `process.env["AGENTARIO_WORKSPACE_ROOT"] || process.cwd()`. В VS Code extension process.cwd() возвращает системную директорию, а не workspace.

**Решение:** Передавать workspaceRoot через замыкание при создании инструментов.

### Изменения:

**`apps/vscode/src/sdk/agent-tools.ts`**
- `createAgentModeTools()` → `createAgentModeTools(workspaceRoot: string)`
- Все инструменты (record_decision, recall_decisions, validate_plan, analyze_impact, detect_patterns) используют `workspaceRoot` из замыкания вместо `process.env`
- analyze_impact и detect_patterns передают `workspaceRoot` в `getDependencyGraph()`

**`apps/vscode/src/sdk/debug-tools.ts`**
- `createDiagnoseErrorTool()` → `createDiagnoseErrorTool(workspaceRoot: string)`
- `createSuggestTestsTool()` → `createSuggestTestsTool(workspaceRoot: string)`
- `createPredictRegressionTool()` → `createPredictRegressionTool(workspaceRoot: string)`

**`apps/vscode/src/sdk/adaptive-tools.ts`**
- `createSetPersonaTool()` → `createSetPersonaTool(workspaceRoot: string)` (для консистентности сигнатуры)
- `createReportConfidenceTool()` → `createReportConfidenceTool(workspaceRoot: string)`
- `createTrackProgressTool()` → `createTrackProgressTool(workspaceRoot: string)`

**`apps/vscode/src/sdk/sdk-session-config-builder.ts`** (строка 78)
- `...createAgentModeTools()` → `...createAgentModeTools(input.cwd)`

---

## Проблема 2: Модульные переменные — конфликт параллельных сессий

**Причина:** В `adaptive-tools.ts` переменные `activePersona`, `toolUsageLog`, `progressSteps` — на уровне модуля. При двух одновременных сессиях агента состояние перетирается.

**Решение:** Использовать `Map<sessionId, ...>` с доступом через `context.sessionId`.

### Изменения:

**`apps/vscode/src/sdk/adaptive-tools.ts`**

Замена:
```typescript
// Было (модульный уровень):
let activePersona: PersonaType = "generalist"
const toolUsageLog: ToolUsageRecord[] = []
const progressSteps: ProgressStep[] = []

// Станет:
const sessionState = new Map<string, {
  persona: PersonaType
  toolLog: ToolUsageRecord[]
  steps: ProgressStep[]
}>()

function getSessionState(sessionId: string | undefined) {
  const key = sessionId ?? "default"
  if (!sessionState.has(key)) {
    sessionState.set(key, { persona: "generalist", toolLog: [], steps: [] })
  }
  return sessionState.get(key)!
}
```

Все `execute(input, context)` используют `const state = getSessionState(context.sessionId)` вместо прямого обращения к модулю.

Очистка: при завершении сессии (или по таймауту) удалять entry из Map. Минимально — добавить `clearSessionState(sessionId)` экспорт для вызова из SdkController.

---

## Проблема 3: Синхронный I/O в DependencyGraph

**Причина:** `readdirSync`, `readFileSync`, `existsSync`, `statSync` блокируют main thread VS Code.

**Решение:** Переписать на `node:fs/promises` (асинхронные аналоги).

### Изменения:

**`apps/vscode/src/services/analysis/DependencyGraph.ts`**

| Синхронный | Асинхронный |
|------------|-------------|
| `import * as fs from "node:fs"` | `import * as fs from "node:fs/promises"` |
| `fs.readdirSync(dir, {withFileTypes})` | `await fs.readdir(dir, {withFileTypes: true})` |
| `fs.readFileSync(path, "utf-8")` | `await fs.readFile(path, "utf-8")` |
| `fs.existsSync(path)` | `try { await fs.access(path) } catch {}` |
| `fs.statSync(path).isFile()` | `const stat = await fs.stat(path); return stat.isFile()` |

Метод `scanDirectory` уже `async` — просто заменить внутренние вызовы.
Метод `parseFile` сделать `async` (await readFile).
Метод `resolveImport` сделать `async` (await access/stat).
Метод `build()` уже `async`.

---

## Порядок выполнения

1. DependencyGraph.ts — async I/O (Проблема 3)
2. adaptive-tools.ts — session isolation (Проблема 2)
3. agent-tools.ts + debug-tools.ts — workspaceRoot параметр (Проблема 1)
4. sdk-session-config-builder.ts — передача input.cwd
5. Версия 0.12.2 + CHANGELOG + сборка
