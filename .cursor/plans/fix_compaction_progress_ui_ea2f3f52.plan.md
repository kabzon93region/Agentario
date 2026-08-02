---
name: Fix Compaction Progress UI
overview: Промежуточные статусы суммаризации не видны в чате, потому что emitInfo() не пушит state в webview; строка in:0/out:0 — ложный footer по нулевым api_req stats. Исправлю доставку прогресса и скрытие нулевых токенов.
todos:
  - id: emitinfo-push
    content: "emitInfo: debounced postStateToWebview + monotonic ts"
    status: completed
  - id: status-prefix
    content: Унифицировать emoji-префиксы всех statusCallback в agentic-compaction
    status: completed
  - id: chatrow-ru
    content: "ChatRow: матчить русские стартовые строки компакции"
    status: completed
  - id: hide-zero-tokens
    content: "formatMessageStatsLine: не показывать in:0/out:0"
    status: completed
  - id: bump
    content: Бамп версии + CHANGELOG + release notes
    status: completed
isProject: false
---

# Исправление прогресса суммаризации и in:0/out:0

## Диагноз

### Почему видно только «Полная суммаризация чата...»

На history-пути (чат из истории, нет active session) в [`sdk-compaction-coordinator.ts`](apps/vscode/src/sdk/sdk-compaction-coordinator.ts):

1. Первый статус + flush:
```ts
this.emitInfo("Полная суммаризация чата...")
await this.options.postStateToWebview()  // ← UI обновляется
```

2. Дальше `statusCallback` → тот же `emitInfo()`:
```ts
statusCallback: (msg) => this.emitInfo(msg)
```

3. `emitInfo()` только делает `appendAndEmit` с `event.type === "status"`. В [`webview-grpc-bridge.ts`](apps/vscode/src/sdk/webview-grpc-bridge.ts) для `status` **не** вызывается full state update — только partial. Без `postStateToWebview()` промежуточные info-сообщения в чате не появляются.

Компакция при этом идёт (в логах есть чанки generateSummary), просто UI «застыл» на первом сообщении.

Автокомпакция через `emitHookMessage` пушит сообщения надёжнее — manual path слабее.

### Почему `in: 0 · out: 0 · total: 0`

Это не статистика компакции. [`formatMessageStatsLine`](apps/vscode/src/shared/message-display.ts) рисует footer под сообщением, когда у связанного `api_req_started` есть `tokensIn`/`tokensOut` (в т.ч. `0`). `isApiReqComplete` считает запрос завершённым при `tokensIn != null`, даже если значение `0`.

---

## План исправления

### 1. Надёжная доставка progress в UI (`emitInfo`)

Файл: [`apps/vscode/src/sdk/sdk-compaction-coordinator.ts`](apps/vscode/src/sdk/sdk-compaction-coordinator.ts)

- После `appendAndEmit` вызывать debounced `postStateToWebview()` (например 150–200 ms), чтобы частые `statusCallback` не заспамили webview, но прогресс был виден.
- Для `ts` использовать monotonic id (MessageIdMinter / аналог), а не `Date.now()`, чтобы несколько статусов за одну миллисекунду не сливались.
- Опционально: если есть `emitHookMessage` / `pushMessageToWebview` в options — использовать его как в auto-compaction (прямой push), плюс debounce state.

### 2. Единые префиксы статусов

Файл: [`sdk/packages/core/src/extensions/context/agentic-compaction.ts`](sdk/packages/core/src/extensions/context/agentic-compaction.ts)

- Все `statusCallback` без эмодзи (например «Чанк N на входе») — добавить `🔄` / `❌` / `✅`.
- В начале map-reduce фазы явно эмитить: число чанков, токены на входе, прогресс `Чанк i/N ...`.

### 3. ChatRow: русские стартовые строки

Файл: [`apps/vscode/webview-ui/src/components/chat/ChatRow.tsx`](apps/vscode/webview-ui/src/components/chat/ChatRow.tsx)

- `isCompacting` расширить: матчить `"Полная суммаризация чата"`, `"Сжатие контекста"`, не только английский `"compacting"`.
- Для стартовых строк показывать анимированный индикатор + **реальный текст** сообщения (не всегда «Сжатие контекста...»).

### 4. Скрыть нулевые токены

Файл: [`apps/vscode/src/shared/message-display.ts`](apps/vscode/src/shared/message-display.ts)

- В `formatMessageStatsLine`: если `(tokensIn ?? 0) === 0 && (tokensOut ?? 0) === 0` — возвращать `undefined` (не показывать `in: 0 · out: 0 · total: 0`).

### 5. Версия

- Bump `0.14.79` → `0.14.80` (или следующий PATCH после текущей в package.json).
- CHANGELOG + `release/notes/v0.14.80.md` на русском.

---

## Ожидаемое поведение после фикса

В чате при полной суммаризации последовательно:

```
🔄 Полная суммаризация чата...
🔄 Суммаризация: N сообщений, режим: полный чат
🔄 Расчёт: X ток. ..., на суммаризацию: Y ...
🔄 Чанк 1/5: ~Z ток. на входе
🔄 Чанк 1/5 готов: ~W ток. на выходе
...
✅ Сжатие выполнено: N→M сообщ., A→B ток. (...)
```

Без `in: 0 · out: 0 · total: 0` под info-строками.

## Вне скоупа

- Качество суммаризации модели qwen (долгий reasoning) — отдельная задача.
- Пересчёт providerScale / alignment токенов UI vs compaction — уже частично сделано в 0.14.77; не трогать без новых симптомов.
