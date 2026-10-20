# Настройки

[English version](settings.md)

Кнопка **Сбросить по умолчанию** возвращает все поля к defaults; **API-ключ не сбрасывается**.

## Экраны настроек

В боковой панели один плоский список (**6 экранов**). Внутри экрана - сворачиваемые секции.

**Подключение** (вкл. Запросы) **Чат** **Агент** **Безопасность** (вкл. Права) **Проект** (Индекс, Rules, Personas, Agents, Hooks) **Журнал** (Usage, Activity, Логи).

Для любого OpenAI-compatible endpoint укажите Base URL и модель (например `http://127.0.0.1:8080/v1` для llama.cpp).

## Слои конфига (JSON)

Effective `GenSettings` собирается из нескольких слоёв (приоритет **низкий  высокий**):

1. Встроенные `DEFAULT_SETTINGS`
2. User: `~/.config/gen/config.json` (Linux: `$XDG_CONFIG_HOME/gen` или `~/.config/gen`; Windows: `%APPDATA%/gen`; macOS: `~/.config/gen`; override: `GEN_CONFIG_DIR`)
3. Gen Settings UI (extension `globalState`) - только поля, **отличающиеся от defaults** (без `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` - они не из UI)
4. Project: `<workspace>/.gen/config.json` (только явно заданные ключи)
5. **Admin policy** (наивысший): блокирует/форсирует security-subset - project/UI не могут переопределить

**Не реализовано:** remote `.well-known`, полный MDM/SSO.

### Admin policy (managed)

Опциональный машинный policy-файл (первый найденный):

1. `GEN_ADMIN_POLICY` - абсолютный путь к JSON (если задан - пробуется только он)
2. Linux / macOS: `/etc/gen/policy.json`
3. Windows: `%ProgramData%/gen/policy.json`

Ключи из файла **блокируются** и форсируют effective settings. Lock-ключи: `approvalPolicy`, `autoApprove`, `continueLoopOnDeny`, `enableTerminal`, `enableFileReading`, `enableWorkspaceContext`, `webSearchEnabled`, `webFetchEnabled`, `allowExternalDirectory`, `otelEnabled`, `otelEndpoint`.

Пример:

```json
{
  "$schema": "./schemas/gen-policy.schema.json",
  "webSearchEnabled": false,
  "webFetchEnabled": false,
  "allowExternalDirectory": false,
  "otelEnabled": false
}
```

При активной политике в Gen Settings - баннер только для чтения со списком locked keys. Schema: `schemas/gen-policy.schema.json` (подключена в `contributes.jsonValidation` в `package.json`).

UI настроек Gen не ломается: слои аддитивны. Project перекрывает user и изменённые UI-поля по ключам из JSON; admin побеждает для locked keys. Единственный ключ в VSCode Settings (`gen.chatViewLocation`) синхронизируется из effective config для `when`-clause views.

Поддерживаемые ключи JSON (subset `GenSettings`): `systemPrompt`, `commentSystemPrompt`, `primaryTools`, `watcherIgnore`, `webSearch*` (`webSearchBackend`: `duckduckgo` \| `exa` \| `parallel` \| `http`), `webFetchEnabled`, `skillsPaths` / `skillsUrls` / `instructionUrls`, `personaId`, `usernameDisplay`, `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` (только JSON - не Settings UI), agent/indexing knobs (`outlineEngine`, `chunkEngine`, `treeSitterLanguages`, `indexStorageBackend`, ...), timeouts, `chatMode`, `planShellPolicy` (`ask` \| `deny`), `shareMode`, `revealOnEdit`, `thinkingDisplay`, `chatViewLocation`, и др. - полный список в `FILE_LAYER_KEYS` (`src/core/config/layers.ts`). Ignore путей/папок - **не** ключ settings, а файл `.genignore`.

Дополнительно в JSON:

- `hooksPath` - путь к `hooks.json` (относительно workspace или абсолютный)
- `hooks` - inline-команды хуков (как в `.gen/hooks.json`); непустые списки перекрывают файл

### Хуки (`.gen/hooks.json`)

Shell-команды по событиям. Всегда есть `GEN_HOOK_EVENT`. Ненулевой exit - **veto**, если не указано notify-only.

| Событие              | Когда                                          | Payload (env)                                     | stdout / управление                                                                                             |
|----------------------|------------------------------------------------|---------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `beforeSubmit`       | Перед отправкой в чат                          | `GEN_HOOK_TEXT`                                   | exit ≠ 0 * блокирует send                                                                                       |
| `beforeShell`        | Перед shell-инструментами агента               | `GEN_HOOK_COMMAND`                                | exit ≠ 0 * блокирует команду                                                                                    |
| `shell.env`          | После `beforeShell`, перед spawn `run_command` | `GEN_HOOK_COMMAND`, `GEN_HOOK_CWD`                | JSON `{"env":{"K":"V"}}` / `{"K":"V"}` или строки `KEY=value` * merge в env дочернего процесса; exit ≠ 0 * veto |
| `session.diff`       | После записи файлов turn’ом                    | `GEN_HOOK_PATHS`, `GEN_HOOK_TURN_ID`              | только notify                                                                                                   |
| `session.compacting` | Перед `/compact`                               | -                                                 | exit ≠ 0 * блокирует compact                                                                                    |
| `file.watcher`       | Debounce изменений под `.gen/**`               | `GEN_HOOK_PATH`, `GEN_HOOK_FILE_EVENT` (`create`\ | `change`\                                                                                                       |`delete`), `GEN_HOOK_PATHS`, `GEN_HOOK_FILE_EVENTS` | только notify                                                                                                   |

Метаданные project-файла (`version`, `createdAt`, `$schema`) в settings не попадают. Массивы (например `deniedCommands`, `skillsPaths`) при merge **заменяются** целиком, не склеиваются.

### JSON Schema

С установленным расширением VSCode валидирует файлы через `contributes.jsonValidation` (`$schema` не обязателен):

| Файл                                                   | Схема в расширении                   |
|--------------------------------------------------------|--------------------------------------|
| `**/.gen/config.json`, `**/gen/config.json` (user XDG) | `schemas/gen-config.schema.json`     |
| `**/.gen/hooks.json`                                   | `schemas/gen-hooks.schema.json`      |
| `**/.gen/references.json`, `**/.gen/references/*.json` | `schemas/gen-references.schema.json` |

Опциональный `$schema` (редакторы без расширения или явное закрепление версии):

```json
{
  "$schema": "https://raw.githubusercontent.com/magomedcoder/gen-vscode/main/schemas/gen-config.schema.json"
}
```

Аналогично для hooks / references - подставьте имя файла (`gen-hooks.schema.json`, `gen-references.schema.json`). Относительный путь, если схемы лежат в workspace: `"$schema": "./schemas/gen-config.schema.json"` (с поправкой на глубину).

## Основное

| Поле            | По умолчанию    | Описание                                                                                                      |
|-----------------|-----------------|---------------------------------------------------------------------------------------------------------------|
| Базовый URL     | пусто           | Корень API: в первую очередь **llama.cpp** (`http://127.0.0.1:8080`), также любой OpenAI-совместимый endpoint |
| API-ключ        | -               | В `SecretStorage`; пусто - заголовок не отправлять                                                            |
| Заголовок ключа | `Authorization` | Имя HTTP-заголовка                                                                                            |
| Схема ключа     | `Bearer`        | Префикс значения; пустая схема - сырой ключ                                                                   |
| Модель          | пусто           | Идентификатор модели; список грузится по URL                                                                  |

## Чат и агент

| Поле           | По умолчанию | Описание                   |
|----------------|--------------|----------------------------|
| Режим чата     | `ask`        | Ask или Agent              |
| Лимит итераций | `40`         | 0 = без лимита; иначе 1-40 |

Права: **Settings -> Безопасность** (`approvalPolicy` / `autoApprove`) - см. [chat-ru.md](chat-ru.md#права-безопасность).

Настройки комментариев - на экране **Чат** (сворачиваемая секция **Комментарии**): стиль, diff перед apply, доп. system prompt. Подробнее: [comments-ru.md](comments-ru.md).

Индексация (движки Tree-sitter, merkle/sqlite, статус/repair) - на **Settings -> Проект**. Подробнее: [codebase-index-ru.md](codebase-index-ru.md).

## Запросы

| Поле                    | По умолчанию | Описание                                  |
|-------------------------|--------------|-------------------------------------------|
| Температура             | `0.2`        | 0-2; для стабильного формата лучше низкая |
| Макс. токенов ответа    | `8192`       | min 64                                    |
| Таймаут (мс)            | `120000`     | min 1000                                  |
| Макс. символов на входе | `8000`       | Лимит для фрагмента комментариев и т.п.   |

## Безопасность (UI)

В Settings -> Безопасность остаются возможности агента и политика подтверждений (пресеты / Always / allow ask review deny).

### Ignore путей и политика проекта - файлы, не UI

| Что                                | Где править                            | Описание                                                           |
|------------------------------------|----------------------------------------|--------------------------------------------------------------------|
| Пути и папки                       | **`.genignore`** в корне workspace     | Синтаксис как у `.gitignore`; основной способ закрыть файлы агенту |
| Команды / redact / sensitive write | **`.gen/config.json`** (или user JSON) | Ключи ниже; **не** для ignore папок                                |

В `config.json` (не Settings UI, не globalState):

| Ключ                    | По умолчанию        | Описание                                 |
|-------------------------|---------------------|------------------------------------------|
| `sensitivePathPatterns` | `.env`, `.env.*`    | Чувствительные пути (ask/deny на запись) |
| `deniedCommands`        | встроенный denylist | Имена бинарников для `run_command`       |
| `secretPatterns`        | `[]`                | JS-regexp; совпадения -> `[REDACTED]`    |

При `Gen: Инициализировать проект` создаются `.genignore` и `config.json` с ключами команд/redact. Полная политика: [security-ru.md](security-ru.md).

### Web search (`web_search`)

Бэкенд (`webSearchBackend`, UI: Request / Запросы):

| Значение               | Ключ                              | Endpoint                                                                                                  |
|------------------------|-----------------------------------|-----------------------------------------------------------------------------------------------------------|
| `duckduckgo` (default) | нет                               | HTML scrape DuckDuckGo                                                                                    |
| `exa`                  | `webSearchApiKey` * `x-api-key`   | `POST https://api.exa.ai/search` (`query`, `numResults`)                                                  |
| `parallel`             | `webSearchApiKey` * `x-api-key`   | `POST https://api.parallel.ai/v1/search` (`objective`, `search_queries`, `advanced_settings.max_results`) |
| `http`                 | опц. ключ + `webSearchHttpHeader` | GET `webSearchHttpUrl` с `{query}`                                                                        |

Ключ поддерживает `${env:NAME}` / `{file:path}`. Ответ нормализуется в `{ title, url }[]` (ожидаемые поля: `results[].title`/`url`; title может отсутствовать * fallback на url). Exa/Parallel - best-effort adapters по публичным docs.

## Логи

| Поле        | По умолчанию | Описание                                        |
|-------------|--------------|-------------------------------------------------|
| Писать логи | выкл.        | Output `Gen LLM` / `Gen Agent` + файлы на диске |

Кнопка **Открыть папку логов**. Подробнее: [logging-ru.md](logging-ru.md).
