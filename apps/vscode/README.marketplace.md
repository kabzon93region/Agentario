# Agentario

**Agentario** — AI-ассистент для VS Code с доступом к редактору и терминалу.  
**Agentario** is a VS Code AI assistant that can use your editor and terminal (with your approval).

## Установка / Install

1. Скачайте VSIX из [релизов](https://github.com/kabzon93region/Agentario/releases) или соберите через `build.cmd`.
2. В VS Code: **Extensions → … → Install from VSIX…**
3. Откройте панель Agentario на activity bar.

## Локальные модели / Local models

Agentario работает автономно с **LM Studio**, **Ollama** и другими OpenAI-compatible API.  
Облако Cline **не требуется** — достаточно локального сервера моделей.

1. Запустите LM Studio (или Ollama).
2. Включите Local Server (по умолчанию `http://127.0.0.1:1234`).
3. В настройках Agentario выберите провайдер и модель.

## Возможности / Features

- Создание и правка файлов с diff и вашим подтверждением
- Команды в терминале
- Браузерная автоматизация (с разрешения)
- MCP — подключение внешних инструментов
- Локальные и облачные модели на ваш выбор

## Ссылки / Links

- Репозиторий: [github.com/kabzon93region/Agentario](https://github.com/kabzon93region/Agentario)
- Issues: [github.com/kabzon93region/Agentario/issues](https://github.com/kabzon93region/Agentario/issues)

## Лицензия / License

Apache 2.0 — см. [LICENSE](https://github.com/kabzon93region/Agentario/blob/main/LICENSE).
