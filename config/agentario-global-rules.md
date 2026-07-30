# Agentario — дополнительные правила

> Основные правила поведения, использования инструментов, работы с файлами и
> цикла ошибок уже вшиты в системный промпт Agentario. Ниже — только дополнения.

## Инструмент editor

- `insert_line` — число, не строка `"null"`.
- Для больших файлов или нескольких правок используйте MCP trueline: `trueline_outline` → `trueline_read` → `trueline_edit`.

## Команды (Windows/PowerShell)

- **Никогда не используйте `&&`** — PowerShell его не поддерживает. Используйте массив `commands` в `run_commands` или `;` только для git/build/test.
- **Запрещено** листить каталоги через shell (`Get-ChildItem` / `ls` / `dir` / `tree`) — даже «с `-Depth`». Для обзора: `git status` → `read_files` / `semantic_search`.
- Избегайте команд с огромным выводом (>100 строк) — фильтруйте через `Select-Object`, `Where-Object`.
