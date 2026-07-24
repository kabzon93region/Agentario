---
name: Context & Compaction Fixes
overview: "Исправление 5 проблем: (1) контекст-окно не обновляется при перезагрузке модели, (2) агрессивная автокомпакция при 36%, (3) обрезка истории чата, (4) read_files получает строку вместо массива, (5) удаление чата не останавливает генерацию."
todos: []
isProject: false
---

## Проблемы и корневые причины

### 1. Контекст-окно не обновляется при перезагрузке модели
**Корневая причина:** `buildCompactionConfig` вычисляет `maxInputTokens` как **статическое число** при создании сессии. `maxInputTokensResolver` существует в типе `CoreCompactionConfig`, но **никогда не используется** — об этом есть явный комментарий в коде (строка 62 `compaction-settings.ts`). Если пользователь перезагружает модель в LM Studio с другим контекстом, старое значение продолжает использоваться до пересоздания сессии.

**Файлы:**
- [compaction-settings.ts](apps/vscode/src/sdk/compaction-settings.ts) — `buildCompactionConfig`
- [compaction.ts](sdk/packages/core/src/extensions/context/compaction.ts) — `resolveMaxInputTokens` (строка 400-410, уже поддерживает `maxInputTokensResolver`)

### 2. Автокомпакция при 36% (11k/32k)
**Корневая причина:** `reserveTokens = 16384` (по умолчанию) — это **половина** 32k контекста. `triggerTokens = 32000 - 16384 = 15616` (48.8%). Для модели с 20k контекстом: `triggerTokens = 20000 - 16384 = 3616` (18%). Компакция срабатывает почти сразу.

**Файлы:**
- [compaction-settings.ts](apps/vscode/src/sdk/compaction-settings.ts) — `reserveTokens`
- [compaction.ts](sdk/packages/core/src/extensions/context/compaction.ts) — `resolveTriggerState`

### 3. Обрезка видимой истории чата
**Корневая причина:** После компакции сообщения `0..cutIndex` заменяются одним summary. Если `preserveRecentTokens` мало, остаётся только summary + последние 1-2 сообщения. Пользователь видит обрезанную историю.

**Файл:** [agentic-compaction.ts](sdk/packages/core/src/extensions/context/agentic-compaction.ts) — `cutIndex`, `preserveRecentTokens`

### 4. read_files: строка вместо массива
**Корневая причина:** Модель отправляет `"files":"[{...}]"` (строка). `ReadFilesInputUnionSchema` содержит `{ files: AbsolutePath }` (z.string()), поэтому строка проходит валидацию, но создаёт битый запрос. Нет `z.preprocess` (в отличие от `RunCommandsInputUnionSchema`).

**Файлы:**
- [schemas.ts](sdk/packages/core/src/extensions/tools/schemas.ts) — `ReadFilesInputUnionSchema` (строка 67-81)

### 5. Удаление чата не останавливает генерацию
**Корневая причина:** `endActiveSession("clearTask")` вызывается БЕЗ `awaitStop: true`. Abort вызывается (синхронно), но `shutdownSession` не ожидается. Если UI обновляется до завершения shutdown, пользователь видит "исчезнувший" чат, но генерация может продолжаться.

**Файлы:**
- [sdk-task-control-coordinator.ts](apps/vscode/src/sdk/sdk-task-control-coordinator.ts) — `clearTask`
- [sdk-session-lifecycle.ts](apps/vscode/src/sdk/sdk-session-lifecycle.ts) — `endActiveSession`

---

## План исправлений

### Fix 1: Динамический резолвер контекст-окна

**Файл:** [compaction-settings.ts](apps/vscode/src/sdk/compaction-settings.ts)

Добавить `maxInputTokensResolver` в возвращаемый объект `buildCompactionConfig`:

```typescript
maxInputTokensResolver: () => {
    const explicit = stateManager.getGlobalSettingsKey("compactionMaxInputTokens")
    if (typeof explicit === "number" && explicit > 0) return explicit
    // Динамически читаем текущее значение контекст-окна провайдера
    if (activeProviderId === "lmstudio" || activeProviderId === "openai-compatible") {
        const raw = stateManager.getApiConfigurationField("lmStudioMaxTokens")
        const parsed = Number.parseInt(String(raw ?? "").trim(), 10)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    if (activeProviderId === "ollama") {
        const raw = stateManager.getApiConfigurationField("ollamaApiOptionsCtxNum")
        const parsed = Number.parseInt(String(raw ?? "").trim(), 10)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    return providerContextWindow
},
```

**Важно:** Также нужно убедиться, что `compaction.ts` (строка 400-410) корректно приоритизирует `maxInputTokensResolver` над статическим `maxInputTokens`. Текущий код уже это делает:
```typescript
const resolvedMaxInputTokens = typeof userCompaction?.maxInputTokensResolver === "function"
    ? userCompaction.maxInputTokensResolver()
    : undefined;
const maxInputTokens = resolveMaxInputTokens({
    configMaxInputTokens: resolvedMaxInputTokens ?? userCompaction?.maxInputTokens,
    ...
});
```

### Fix 2: Адаптивный reserveTokens

**Файл:** [compaction-settings.ts](apps/vscode/src/sdk/compaction-settings.ts)

Изменить `reserveTokensResolver` чтобы он учитывал размер контекст-окна:

```typescript
reserveTokensResolver: () => {
    const explicit = stateManager.getGlobalSettingsKey("compactionReserveTokens")
    if (typeof explicit === "number" && explicit > 0) return explicit
    // Адаптивный reserve: 25% от контекст-окна, clamp [4096, 16384]
    const ctx = providerContextWindow ?? 32000
    return Math.min(16384, Math.max(4096, Math.floor(ctx * 0.25)))
},
```

Также обновить статический `reserveTokens` аналогично:
```typescript
const reserveTokens = stateManager.getGlobalSettingsKey("compactionReserveTokens")
    ?? Math.min(16384, Math.max(4096, Math.floor((providerContextWindow ?? 32000) * 0.25)))
```

Результат для разных контекстов:
- 20k → reserve=5k, trigger=15k (75%)
- 32k → reserve=8k, trigger=24k (75%)  
- 128k → reserve=16k, trigger=112k (87.5%)

### Fix 3: read_files preprocess

**Файл:** [schemas.ts](sdk/packages/core/src/extensions/tools/schemas.ts)

Добавить `preprocessReadFilesInput` (аналог `preprocessRunCommandsInput`) и обернуть `ReadFilesInputUnionSchema` в `z.preprocess`:

```typescript
export function preprocessReadFilesInput(value: unknown): unknown {
    if (typeof value === "string") {
        return tryParseJsonArray(value) ?? value;
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.files === "string") {
        const parsed = tryParseJsonArray(record.files);
        if (parsed !== undefined) {
            return { ...record, files: parsed };
        }
    }
    return value;
}
```

Заменить:
```typescript
export const ReadFilesInputUnionSchema = z.union([...])
```
На:
```typescript
export const ReadFilesInputUnionSchema = z.preprocess(
    preprocessReadFilesInput,
    z.union([...])
)
```

### Fix 4: Await stop при удалении/очистке чата

**Файл:** [sdk-task-control-coordinator.ts](apps/vscode/src/sdk/sdk-task-control-coordinator.ts)

В `clearTask` передать `awaitStop: true`:
```typescript
async clearTask(): Promise<void> {
    this.options.interactions.clearPending("Task cleared")
    await this.options.sessions.endActiveSession("clearTask", { awaitStop: true })
    // ...
}
```

Аналогично в `showTaskWithId` (строка 113).

### Fix 5: MIN_USEFUL_CHAT_TOKENS увеличить

**Файл:** [compaction.ts](sdk/packages/core/src/extensions/context/compaction.ts)

Увеличить `MIN_USEFUL_CHAT_TOKENS` с 500 до 2000, чтобы избегать бессмысленных компакций с минимальным контентом:
```typescript
const MIN_USEFUL_CHAT_TOKENS = 2000;
```

---

## Верификация

1. **Fix 1** проверяет, что `maxInputTokensResolver` вызывается на каждой проверке компакции (строка 400-403 compaction.ts уже поддерживает это).
2. **Fix 2** адаптивный reserve не сломает явную настройку пользователя (проверка `explicit` первая).
3. **Fix 3** `z.preprocess` не ломает существующие валидные входы (только парсит строки).
4. **Fix 4** `awaitStop: true` может увеличить время UI-ответа при удалении, но `timeoutMs=3000` по умолчанию предотвращает зависание.
5. **Fix 5** увеличение MIN_USEFUL_CHAT_TOKENS не влияет на ручную компакцию (только auto).

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `apps/vscode/src/sdk/compaction-settings.ts` | Fix 1: maxInputTokensResolver, Fix 2: adaptive reserve |
| `sdk/packages/core/src/extensions/tools/schemas.ts` | Fix 3: preprocessReadFilesInput + z.preprocess |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` | Fix 4: awaitStop: true |
| `sdk/packages/core/src/extensions/context/compaction.ts` | Fix 5: MIN_USEFUL_CHAT_TOKENS = 2000 |
| `apps/vscode/package.json` | Version bump |
| `CHANGELOG.md` | Описание изменений |
