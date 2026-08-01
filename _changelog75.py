path = r'z:\T\Agentario\CHANGELOG.md'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

new_section = """## [0.14.75] - 2026-08-01

### Fixed
- Токены компакции: масштабирование `providerScale` (EMA) теперь применяется ко всем расчётам токенов в компакции (`tokensBefore`, `chatTokens`, `/api/compact`) — цифры соответствуют методу подсчёта провайдера (BPE), а не сырому `chars/3`
- Контекстный бюджет: `providerScale` теперь передаётся в метаданных `CONTEXT_BUDGET_NOTICE` из оркестратора и сохраняется в `MessageTranslatorState` для использования координатором компакции и API
- `compaction_already_in_progress`: вместо немедленного отклонения координатор теперь ждёт завершения текущей компакции (polling до 120с). Добавлен `lastCompactCompletedAt` для отслеживания завершения и метод `buildPostCompactionResult()` с причиной `compaction_just_completed`

"""

content = new_section + content

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('CHANGELOG.md updated')
