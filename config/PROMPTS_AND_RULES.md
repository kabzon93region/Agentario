# Agentario — системный промпт и Rules

## Кратко

| Что | Где настраивается | Редактирование |
|-----|-------------------|----------------|
| **Системный промпт (ядро)** | Встроен в Agentario + файл в VSIX | `Documents/Agentario/Rules/` не заменяет system prompt целиком |
| **Rules (доп. инструкции)** | `Documents/Agentario/Rules/*.md` | VS Code → Customize (иконка «закон») → Rules |
| **Rules проекта** | `.agentariorules/` в корне workspace | Тот же UI → Workspace Rules |
| **LM Studio System Prompt** | LM Studio → модель | Оставьте **пустым** или 1 строку — основной текст в Agentario |

## Первый запуск

При установке Agentario **0.4.0+** (standalone):

1. В `%USERPROFILE%\Documents\Agentario\Rules\` создаются файлы:
   - `agentario-global-rules.md` — правила для всех проектов
   - `agentario-system-prompt.md` — копия для справки (редактируемая)
2. В API-запрос к модели добавляется встроенный системный промпт из VSIX (`agentario-system-prompt.md`).
3. Rules из папки **подмешиваются** к system prompt автоматически (если включены в Customize → Rules).

Переустановка VSIX не затирает ваши правки в `Documents/Agentario/Rules/` — только дополняет отсутствующие файлы.

## Как открыть Rules в UI

1. Откройте чат Agentario.
2. Нажмите иконку **Customize** (codicon-law) над полем ввода.
3. Вкладки: **Правила** | **Hooks** | **Skills**.
4. Включите/выключите переключателем нужные `.md` файлы.

## LM Studio

1. Запустите **Local Server** (`http://127.0.0.1:1234`).
2. Agentario → Settings → API → **LM Studio**, укажите URL и модель.
3. В LM Studio **System Prompt модели** — пусто (рекомендуется).
4. Модель должна поддерживать **tool use / function calling** (в LM Studio — capability «Tool Use»). Без этого агент не сможет вызывать `read_files`, `editor` и т.д.

**Таймауты (LM Studio / Ollama):** в Settings → API → **Request Timeout (ms)** задаётся ожидание ответа модели и таймаут `run_commands` / `search_codebase`. Для локальных моделей по умолчанию **120 с** (если поле пустое). Увеличьте при медленном префилле или тяжёлых командах.

Шаблон для ручной вставки в LM Studio (если нужен дубль): см. `config/lmstudio-system-prompt.md`.

## Индексация кода (embeddings)

См. **[config/lmstudio-indexing.md](lmstudio-indexing.md)** — domain type, embedding vs LLM, headless-сервер, скрипт `scripts/lmstudio-headless-server.cmd`.

## Plan vs Act

| Режим | Tools |
|-------|--------|
| **Act** | Полный набор: read, search, bash, editor, MCP… |
| **Plan** | Read/search/bash — да; **editor** — нет (только планирование). Переключение в Act: tool `switch_to_act_mode` после согласования плана. |

## Скрипт setup

```bat
scripts\setup-agentario-mcp.ps1
```

Копирует global rules и MCP-настройки в `%USERPROFILE%\.agentario\`.

## Файлы в репозитории

| Файл | Назначение |
|------|------------|
| `config/agentario-global-rules.md` | Шаблон global rules |
| `config/lmstudio-system-prompt.md` | Справка для LM Studio UI |
| `config/lmstudio-indexing.md` | Индексация: embedding domain, headless, память |
| `config/RELEASE.md` | Публикация релиза на GitHub, структура release notes |
| `release/notes/TEMPLATE.md` | Шаблон описания релиза для `publish-release.cmd` |
| `scripts/lmstudio-headless-server.cmd` | Запуск LM Studio без GUI |
| `publish-release.cmd` | Commit, tag, GitHub Release + VSIX |
| `apps/vscode/agentario-system-prompt.md` | Встроенный prompt в VSIX |
| `config/PROMPTS_AND_RULES.md` | Эта инструкция |
