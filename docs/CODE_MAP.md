# Карта кода — Agentario

Краткий справочник по ключевым файлам, функциям и цепочкам данных.
Обновлено: 2026-07-23.

---

## 1. Цепочка расчёта контекста (3 пути)

### PATH A — Compaction Trigger (оценка по символам)

```
compaction.ts → createContextCompactionPrepareTurn()
  ├── chatTokens = Σ estimateMessageTokens(msg)     // chars / 3
  ├── systemPromptTokens = estimateTokens(sysPrompt.length)
  ├── toolTokens = estimateTokens(Σ name + desc + schema)
  └── inputTokens = chat + system + tools
```

**Файл:** `sdk/packages/core/src/extensions/context/compaction.ts:361-379`
**Формула:** `estimateTokens(chars) = Math.ceil(chars / 3)` (`sdk/packages/shared/src/llms/tokens.ts:8-12`)

### PATH B — Context Budget (оценка по категориям)

```
context-budget.ts → estimateContextBudget()
  ├── system = estimateTextTokens(systemPromptBase)
  ├── rules = Σ estimateTextTokens(rule.content)
  ├── { mcp, tools, skills } = estimateMcpAndToolsTokens(tools)
  ├── chat = Σ estimateMessageTokens(msg)
  └── totalEstimated = system + rules + tools + mcp + skills + chat
```

**Файл:** `sdk/packages/core/src/extensions/context/context-budget.ts:78-108`
**Вызов:** `session-runtime-orchestrator.ts:1008-1018` → emit `CONTEXT_BUDGET_NOTICE_KIND`
**Отображение:** полоска контекста, расшифровка категорий

### PATH C — Model-Reported (реальные токены API)

```
Provider API response → usage { inputTokens, outputTokens, cacheReads, cacheWrites }
  → RuntimeEventAdapter.translateUsage()
  → message-translator.ts → normalizeUsageEvent()
  → say:"api_req_started" { tokensIn, tokensOut, cacheWrites, cacheReads }
```

**Файл:** `apps/vscode/src/shared/getApiMetrics.ts:84-113` — `getLastApiReqTotalTokens()`
**Отображение:** статистика `in: X · out: Y · total: Z`

---

## 2. Ключевые файлы — Compaction

| Файл | Назначение |
|------|-----------|
| `sdk/packages/core/src/extensions/context/compaction.ts` | Главный файл: `createContextCompactionPrepareTurn()`, `resolveMaxInputTokens()`, `resolveTriggerState()` |
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | Утилиты: `createTokenEstimator()`, `resolveSummarizerConfig()`, `estimateTokens()` |
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | Agentic стратегия: `runAgenticCompaction()`, `collectStreamingChunks()`, `buildSummaryRequest()` |
| `sdk/packages/core/src/extensions/context/basic-compaction.ts` | Basic стратегия: `runBasicCompaction()` — простое удаление/усечение |
| `sdk/packages/core/src/extensions/context/context-budget.ts` | `estimateContextBudget()` — категоризированный расчёт |
| `sdk/packages/shared/src/llms/tokens.ts` | `estimateTokens(chars)` = `Math.ceil(chars / 3)` |
| `apps/vscode/src/sdk/compaction-settings.ts` | `buildCompactionConfig()` — сборка конфига из настроек |
| `apps/vscode/src/sdk/sdk-compaction-coordinator.ts` | Ручная `/compact` — `compactSessionMessages()`, `compactHistoryTask()` |
| `apps/vscode/src/sdk/sdk-compaction.ts` | Адаптер ручной компакции для SDK |
| `apps/vscode/src/sdk/sdk-session-config-builder.ts` | Подключение `statusCallback` для прогресс-сообщений |

## 3. Ключевые файлы — UI / Отображение

| Файл | Назначение |
|------|-----------|
| `apps/vscode/src/shared/getApiMetrics.ts` | `getLastApiReqTotalTokens()`, `getLastContextBudget()` — чтение метрик из сообщений |
| `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx` | Полоска контекста — `tokenData.used` |
| `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindowSummary.tsx` | Расшифровка контекста (попап) |
| `apps/vscode/webview-ui/src/components/chat/task-header/StructuredContextBar.tsx` | Цветная полоска по категориям |
| `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` | Отображение `in: X · out: Y · total: Z` |
| `apps/vscode/webview-ui/src/components/chat/MessageStatsFooter.tsx` | Статистика после каждого сообщения |
| `apps/vscode/webview-ui/src/components/chat/ChatView.tsx` | `lastContextBudget` — чтение из messages или history |

## 4. Ключевые файлы — Session / Runtime

| Файл | Назначение |
|------|-----------|
| `sdk/packages/core/src/runtime/host/local-runtime-host.ts` | `prepareTurn` wiring, `knownModels` override для `providerContextWindow` |
| `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | `createRuntimePrepareTurn()` — обёртка для compaction callback |
| `sdk/packages/agents/src/agent-runtime.ts` | `prepareTurnForModelRequest()` — вызов compaction перед каждым запросом к модели |
| `sdk/packages/core/src/services/local-runtime-bootstrap.ts` | `prepareLocalRuntimeBootstrap()` — сборка `CoreSessionConfig` |
| `apps/vscode/src/sdk/Agentario-session-factory.ts` | `buildCompactionConfig()` вызов, передача `providerContextWindow` |
| `apps/vscode/src/sdk/session-host.ts` | `SdkSessionHost` — управление сессиями |

## 5. Ключевые файлы — State / Config

| Файл | Назначение |
|------|-----------|
| `apps/vscode/src/shared/storage/state-keys.ts` | Все ключи настроек: `API_HANDLER_SETTINGS_FIELDS`, `SETTINGS_FIELDS` |
| `apps/vscode/src/core/storage/StateManager.ts` | `getApiConfiguration()`, `getGlobalSettingsKey()`, `setApiConfiguration()` |
| `apps/vscode/src/shared/ExtensionMessage.ts` | `ExtensionState` — тип состояния для webview |
| `sdk/packages/core/src/types/config.ts` | `CoreCompactionConfig`, `CoreSessionConfig` — типы конфигов |

## 6. Ключевые функции

### Compaction
- `createContextCompactionPrepareTurn(config, options)` → возвращает async callback для `prepareTurn`
- `resolveMaxInputTokens(input)` → `Math.min(...candidates)` из config/model/provider
- `resolveTriggerState({ inputTokens, maxInputTokens, config })` → `{ shouldCompact, triggerTokens }`
- `runAgenticCompaction(options)` → LLM-суммаризация с map-reduce
- `runBasicCompaction(options)` → простое удаление/усечение сообщений
- `buildCompactionConfig(stateManager, providerId, useAutoCondense, providerContextWindow)` → `CoreCompactionConfig`

### Token Estimation
- `estimateTokens(chars)` → `Math.ceil(chars / 3)` — базовая оценка
- `createTokenEstimator()` → функция с WeakMap кешем для оценки сообщений
- `estimateContextBudget(input)` → категоризированный расчёт бюджета

### UI Metrics
- `getLastApiReqTotalTokens(messages)` → последнее значение `tokensIn + tokensOut + cache` из `api_req_started`
- `getLastContextBudget(messages)` → последнее `contextBudget` из `api_req_started`

## 7. Формулы

```
estimateTokens(chars) = Math.ceil(chars / 3)

inputTokens (compaction) = chatTokens + systemPromptTokens + toolTokens
triggerTokens = maxInputTokens - reserveTokens
shouldCompact = inputTokens > triggerTokens

contextBudget.totalEstimated = system + rules + tools + mcp + skills + chat
lastApiReqTotalTokens = tokensIn + tokensOut + cacheWrites + cacheReads
```

## 8. Провайдеры и модели

| Провайдер | Context Window | Где задаётся |
|-----------|---------------|-------------|
| LM Studio | `lmStudioMaxTokens` (loaded_context_length) | `LMStudioProvider.tsx` → `handleFieldChange("lmStudioMaxTokens")` |
| Ollama | `ollamaApiOptionsCtxNum` (num_ctx) | `OllamaProvider.tsx` |
| Model Catalog | `contextWindow` (дефолт 128000) | `sdk/packages/llms/` |

**Host-overrides:** `apps/vscode/src/sdk/model-catalog/host-overrides.ts` — подменяет `contextWindow` на `lmStudioMaxTokens` для UI, но НЕ для SDK-сессии.
