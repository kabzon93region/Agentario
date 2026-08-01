content = """# Agentario v0.14.75

## Исправления

### Токены компакции приведены к методу провайдера
- Масштабирование `providerScale` (EMA) теперь применяется ко всем расчётам токенов в компакции: `tokensBefore`, `chatTokens`, `/api/compact` — цифры соответствуют методу подсчёта провайдера (BPE), а не сырому `chars/3`
- Контекстный бюджет: `providerScale` теперь передаётся в метаданных `CONTEXT_BUDGET_NOTICE` из оркестратора и сохраняется в `MessageTranslatorState` для использования координатором компакции и API

### Исправлено ложное `compaction_already_in_progress`
- Вместо немедленного отклонения координатор теперь ждёт завершения текущей компакции (polling до 120с)
- Добавлен `lastCompactCompletedAt` для отслеживания завершения
- Метод `buildPostCompactionResult()` с причиной `compaction_just_completed` — легитимный пропуск при недавнем завершении компакции
"""
path = r'z:\T\Agentario\release\notes\v0.14.75.md'
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Release notes created')
