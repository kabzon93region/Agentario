# Публикация релиза Agentario на GitHub

Автоматизация: **`publish-release.cmd`** (двойной клик или из корня репозитория).

Требования: **Git**, **GitHub CLI (`gh`)**, авторизация `gh auth login`, права `repo` на `kabzon93region/Agentario`.

---

## Чеклист перед публикацией

1. **`apps/vscode/package.json`** — поле `"version"` (источник истины).
2. **Описание релиза** — один из вариантов ниже (скрипт подхватит автоматически).
3. **`CHANGELOG.md`** — секция `## [x.y.z] — YYYY-MM-DD` (рекомендуется; перенесите пункты из `[Unreleased]`).
4. **`README.md`** — строка «Версия расширения» и пример VSIX.
5. Сборка (скрипт запустит сам, если VSIX нет): `build.cmd` → `release/agentario-<version>.vsix`.

---

## Структура описания релиза (для скрипта)

Скрипт **`scripts/publish-release.ps1`** читает версию из `apps/vscode/package.json` и ищет текст release notes **в таком порядке**:

| Приоритет | Путь | Пример |
|-----------|------|--------|
| 1 | `release/notes/v{VERSION}.md` | `release/notes/v0.4.8.md` |
| 2 | `release/notes/{VERSION}.md` | `release/notes/0.4.8.md` |
| 3 | Секция в **`CHANGELOG.md`** | `## [0.4.8] — 2026-07-01` … до `---` или следующего `## [` |

Если ни один источник не найден — скрипт **останавливается** с подсказкой создать файл.

### Шаблон файла

Скопируйте [`release/notes/TEMPLATE.md`](../release/notes/TEMPLATE.md) → `release/notes/v<версия>.md` и заполните секции **Added / Changed / Fixed**.

Рекомендуемая структура тела (Markdown для GitHub Release):

```markdown
# Agentario v0.4.8

## Что нового

### Added
- …

### Changed
- …

### Fixed
- …

## Установка

1. Скачайте `agentario-0.4.8.vsix` из Assets.
2. VS Code → Extensions → Install from VSIX.
```

Файлы в `release/notes/` **коммитятся в git** (в отличие от `*.vsix`, который в `.gitignore`).

---

## Что делает `publish-release.cmd`

1. Читает версию из `apps/vscode/package.json`.
2. Находит файл описания (см. таблицу выше).
3. Проверяет `gh auth status`.
4. Собирает VSIX (`build.cmd`), если `release/agentario-<version>.vsix` отсутствует.
5. `git add` (исключая `Exports/`, `.env`), commit **`Release v<version>`**, push **`origin main`**.
6. Тег **`v<version>`** — создаёт и пушит, если ещё нет.
7. **`gh release create`** или обновляет существующий: notes + asset VSIX.
8. Пауза и **краткая сводка** (версия, URL релиза, путь к VSIX).

Переменные окружения (опционально):

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `AGENTARIO_SKIP_BUILD` | — | `1` — не запускать `build.cmd` |
| `AGENTARIO_SKIP_GIT` | — | `1` — не commit/push/tag |
| `AGENTARIO_GIT_REMOTE` | `origin` | remote для push |
| `AGENTARIO_GIT_BRANCH` | `main` | ветка |

---

## Ручная публикация (если нужно)

```bat
build.cmd
git add -A
git commit -m "Release v0.4.8"
git push origin main
git tag v0.4.8
git push origin v0.4.8
gh release create v0.4.8 release\agentario-0.4.8.vsix --title "Agentario v0.4.8" --notes-file release\notes\v0.4.8.md
```

---

## Ссылки

- [VERSIONING.md](../VERSIONING.md) — схема SemVer
- [CHANGELOG.md](../CHANGELOG.md) — журнал изменений
- [GitHub Releases](https://github.com/kabzon93region/Agentario/releases)
