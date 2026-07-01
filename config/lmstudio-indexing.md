# LM Studio — индексация кода в Agentario

## Кратко

| Что | Где |
|-----|-----|
| **Чат (Agentario)** | Модель в **LLM/VLM-слоте** (например `qwen/qwen3.5-9b`) |
| **Индексация (embeddings)** | Модель в **embedding-слоте** (type: `embeddings` в API) |
| **Настройка в Agentario** | Индексация кода → выбор embedding-модели |
| **Индекс на диске** | `%USERPROFILE%\.agentario\data\indexes\` |

Семантическая индексация строит **векторы** через API LM Studio (`/api/v0/embeddings`, `/v1/embeddings`). Chat-модель из того же списка, что и qwen, **не заменяет** embedding-модель — даже если в имени есть слово «embedding».

---

## Domain Type → Embedding (ваш случай: `lfm2.5-embedding-350m`)

Модель может лежать в общем каталоге «My Models», но LM Studio классифицирует её по **domain**:

| Domain в LM Studio | type в API | `/embeddings` |
|--------------------|------------|---------------|
| LLM (по умолчанию) | `llm` | ❌ |
| **Embedding** | `embeddings` | ✅ после загрузки в Developer |

**Один раз в GUI:**

1. **My Models** → модель → ⚙️ → **Domain Type → Embedding** → Save.
2. **Developer** → Load model → выбрать эту модель (она попадёт в embedding-слот).
3. В Agentario → **Индексация кода** → выбрать ту же модель → **Пересоздать**.

### Контекст и память

После смены domain на Embedding LM Studio пересчитывает память под embedding-режим:

- Было как LLM: ~120k context.
- Стало Embedding: ~20k context (типично меньше из‑за другого режима работы).
- Это **нормально** и часто всё равно выгоднее, чем `text-embedding-qwen3-embedding-0.6b` (~6k context при нехватке VRAM).

Для индексации Agentario режет файлы на чанки (~2 KB, до 12 на файл) — 20k context для embedding обычно достаточно.

---

## Альтернатива: отдельная embedding-модель

Если не хотите менять domain у `lfm2.5-embedding-350m`:

- Загрузите в Developer модель с type **`embeddings`** (например `text-embedding-qwen3-embedding-0.6b`, `text-embedding-nomic-embed-text-v1.5`).
- Выберите её в Agentario → Индексация.

**Ограничение LM Studio:** часто одновременно несколько LLM **или** одна embedding-модель в embedding-слоте. Chat и embedding могут делить VRAM — следите за загрузкой GPU/RAM.

---

## Headless: LM Studio без GUI (экономия памяти)

Официальная документация: [Run LM Studio as a service (headless)](https://lmstudio.ai/docs/developer/core/headless), CLI: [lms](https://lmstudio.ai/docs/cli).

### Два варианта

| Вариант | Когда |
|---------|--------|
| **llmster / `lms daemon`** | Сервер без GUI (рекомендуется LM Studio) |
| **Desktop + tray** | Settings → «Run LLM server on login», сворачивание в tray |

### Восстановление «последнего состояния»

LM Studio сохраняет **last server state** и восстанавливает при:

```bat
lms daemon up
lms server start
```

То есть модели, контекст и прочие параметры загрузки, которые вы настроили в GUI/CLI в последний раз для этого профиля, подхватываются **без повторного открытия окна LM Studio**. Это удобно, если вы уже подобрали context length и GPU offload вручную.

> **Важно:** Presets в LM Studio **не всегда** содержат load-параметры (context, GPU). Надёжнее один раз настроить загрузку в GUI, затем использовать режим `restore` в скрипте.

### Явная загрузка (если restore не подходит)

```bat
lms daemon up
lms load qwen/qwen3.5-9b --context-length 100100 --yes
lms load lfm2.5-embedding-350m --context-length 20480 --yes
lms server start --port 1234 --bind 0.0.0.0
lms ps
```

Ключи моделей: `lms ls`. Загруженные: `lms ps`. Оценка памяти без загрузки: `lms load --estimate-only <model> --context-length N`.

### JIT loading

В настройках сервера LM Studio можно включить **Just-In-Time loading**: inference-запрос сам подгрузит модель. Для индексации Agentario надёжнее **заранее загрузить embedding-модель** в embedding-слот.

---

## Скрипт для ПК с LM Studio

В репозитории: [`scripts/lmstudio-headless-server.cmd`](../scripts/lmstudio-headless-server.cmd)

```bat
scripts\lmstudio-headless-server.cmd
```

Режимы (переменная `MODE` в начале файла):

| MODE | Поведение |
|------|-----------|
| `restore` | `daemon up` + `server start` — последнее сохранённое состояние |
| `load` | Явно грузит chat + embedding с `--context-length` из конфига скрипта |

Перед первым запуском отредактируйте в скрипте:

- `CHAT_MODEL`, `EMBED_MODEL`
- `CHAT_CONTEXT`, `EMBED_CONTEXT` (скопируйте из LM Studio после удачной ручной загрузки)
- `LMSTUDIO_PORT`, `LMSTUDIO_BIND` (`0.0.0.0` для LAN)

**Требования:**

- LM Studio установлен; CLI `lms` доступен (`%USERPROFILE%\.lmstudio\bin\lms.exe` или в PATH).
- Хотя бы раз запускали GUI или выполнили `irm https://lmstudio.ai/install.ps1 | iex` (llmster).

### Автозапуск Windows (опционально)

1. `Win+R` → `shell:startup`
2. Ярлык на `lmstudio-headless-server.cmd`
3. Либо Планировщик заданий: при входе в систему, «скрыто», без GUI LM Studio.

---

## Agentario: проверка

1. LM Studio: `lms server status` → порт 1234 (или ваш).
2. `curl http://127.0.0.1:1234/api/v0/models` — embedding-модель с `"state": "loaded"`, type `embeddings`.
3. Agentario → Индексация → embedding-модель → **Пересоздать**.
4. В логах LM Studio: `POST /api/v0/embeddings` (не только `/v1/embeddings`).

---

## Ссылки LM Studio

- [Headless / service](https://lmstudio.ai/docs/developer/core/headless)
- [lms load](https://lmstudio.ai/docs/cli/local-models/load)
- [lms server start](https://lmstudio.ai/docs/cli/serve/server-start)
- [lms daemon up](https://lmstudio.ai/docs/cli/daemon/daemon-up)
- [OpenAI-compatible embeddings](https://lmstudio.ai/docs/developer/openai-compat/embeddings)
