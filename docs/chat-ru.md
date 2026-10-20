# Чат и агент

[English version](chat.md)

Чат в bottom-панели **Gen**. 

## Режимы

| Режим         | Как включить              | Поведение                                                                                                                                                                                       |
|---------------|---------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Ask**       | select / `/ask`           | Только текст, без tools. Не путать с Plan.                                                                                                                                                      |
| **Agent**     | select / `/agent`         | Цикл LLM -> tool calls -> результат tools -> снова LLM (до лимита итераций).                                                                                                                    |
| **Plan**      | select / `/plan`          | Чтение/поиск + `propose_plan`. Правки запрещены. Shell: `planShellPolicy` (`ask` по умолчанию - всегда confirm; `deny` - скрыт). Баннер Plan Agent после approve; напоминание при входе в Plan. |
| **Debug**     | select / `/debug`         | Как Agent, фокус на логи и диагностики (`find_logs`, `read_log_tail`).                                                                                                                          |
| **Design**    | select / `/design`        | Как Agent, фокус на UI preview (`open_browser`, `fetch_page`).                                                                                                                                  |
| **Multitask** | select / `/multitask`     | Координатор: без прямых правок, делегирование через `task`.                                                                                                                                     |
| **Project**   | select / `/project`       | Тимлид: делегирование через `task`, синтез отчётов.                                                                                                                                             |

Режимы - единый реестр `CHAT_MODE_DEFS`; в composer select у поля ввода (и slash `/...`). Default - Settings -> **Чат**. В поле ввода `/` - автодополнение; можно сразу с вопросом: `/debug почему падает auth?`.

## Права (Безопасность)

Подтверждения задаются в **Settings -> Безопасность** (`approvalPolicy` + `autoApprove`):

| Режим         | Поведение                                                                                                     |
|---------------|---------------------------------------------------------------------------------------------------------------|
| `allow`       | Без запроса                                                                                                   |
| `ask`         | Карточка (Применить / Always / Пропустить / Стоп)                                                             |
| `review`      | Edits: ConfirmCard с unified diff (Accept / Reject / Always) до записи; остальные action: heuristic ask/allow |
| `deny`        | Блок; причина модели                                                                                          |
| `autoApprove` | `ask` -> allow; **deny остаётся deny**                                                                        |

Действия: `shell`, `edits`, `delete`, `web`, `outside`, `task`, `skill`. Capability-флаги - грубые выключатели поверх матрицы.

Ignore путей/папок - **`.genignore`** (не Settings). Denylist команд / redact секретов / sensitive write - в user или `.gen/config.json` - см. [security-ru.md](security-ru.md).

## UI чата

- **Стоп** - отмена текущего запроса / turn (также снимает ожидание подтверждения).
- **Очистить** - очистка истории (не даёт in-flight запросу снова записать сообщения).
- **Подтверждение** - карточка над полем ввода (agent и остальные действия: комментарии, checkpoint, undo). Отдельной вкладки нет.
- Карточки tool-call: pending / ok / denied / error, мини-diff для правок.
- Счётчик токенов: сумма в шапке; вход/выход под ответами ассистента (если API отдаёт usage).

## Несколько файлов

Если задача затрагивает **больше одного файла**:

1. Агент вызывает `propose_plan` (заголовок + шаги с path).
2. Вы подтверждаете план.
3. План пишется в **`.gen/plan.md`** и показывается карточкой над полем ввода; подмешивается в следующие ходы.
4. Дальше правки по путям из плана без повторного `propose_plan`; прогресс - `update_plan` или автоматически по path.
5. Можно править `.gen/plan.md` руками («Открыть» в карточке) - на следующем ходе агент увидит diff и примет файл как канон.
6. Сброс плана - удаление `.gen/plan.md` или `update_plan clear`. «Очистить» чат историю **не** трогает план.

Один файл можно править без плана.

## Снимок (checkpoint)

Перед мутациями агент запоминает содержимое файлов. После хода можно **Восстановить снимок** - откат к состоянию до правок turn’а.

## Правки пользователя

После успешной записи агент хранит снимок файла. Если вы правите буфер руками, следующий ход видит user-diff в system prompt; полный `write_file` поверх таких файлов запрещён - только точечный patch (с confirm при конфликте).

## Контекст редактора и упоминания

В Ask и Agent в запрос может попасть активный файл / выделение. Агент также может сам читать файлы через tools.

В поле ввода можно набрать `@` и выбрать:

| Упоминание                      | Что подмешивается                                                     |
|---------------------------------|-----------------------------------------------------------------------|
| `@file path`                    | Содержимое файла                                                      |
| `@folder path`                  | Файлы из папки (с лимитом)                                            |
| `@code`                         | Выделение в редакторе или символ у курсора                            |
| `@Docs` / `@Docs query`         | Ранжированные hits по `docs/` / markdown (квота токенов)              |
| `@terminals`                    | Ранжированные хвосты терминалов (квота; query = текст сообщения)      |
| `@past` / `@past title`         | Ранжированные прошлые чаты / сообщения (квота токенов)                |
| `@agent name`                   | Тело `.gen/agents/{name}.md`                                          |
| `@codebase` / `@codebase query` | Фрагменты из локального индекса + открытые редакторы                  |
| `@map`                          | Outline карты проекта (workspace storage)                             |
| `@symbols` / `@symbols query`   | Сводка / поиск по индексу символов (workspace storage `symbols.json`) |
| `@git` / `@git SHA`             | Последние коммиты или `git show` по SHA                               |
| `@branch_diff`                  | `git status` + `diff --stat`                                          |
| `@rules`                        | AGENTS.md / `.genrules`                                               |
| `@link url`                     | Текст страницы (HTTP fetch, с лимитом)                                |
| `@alias name` / `@ref:name`     | Reference из `.gen/references.json` (кэш в `.gen/cache/references/`)  |

Автодополнение: стрелки / Tab / Enter.

### References (`@alias`)

Именованные ссылки на локальный путь или git-репозиторий. Манифест - `.gen/references.json` (или отдельные файлы `.gen/references/<alias>.json`):

```json
{
  "version": 1,
  "references": {
    "sdk": { "path": "packages/sdk", "description": "Локальный пакет" },
    "upstream": { "git": "https://github.com/org/repo.git", "branch": "main" }
  }
}
```

При первом `@alias sdk` / `@ref:sdk` содержимое копируется (path) или shallow-clone (git) в `.gen/cache/references/<alias>/`, затем подмешивается как `@folder` / `@file`.

Картинки: вставка (paste) или drag-and-drop в Composer -> файл в `.gen/attachments/` и маркер `[image path]` в сообщении. Если в настройках включён **visionEnabled**, в запрос к модели добавляются `image_url` (с лимитом `attachmentImageMaxBase64`).

Подробнее про индекс: [codebase-index-ru.md](codebase-index-ru.md).

## Ограничения

- Пути только внутри workspace (см. [security-ru.md](security-ru.md)).
- Большие файлы: короткая заготовка `write_file`, дальше `apply_patch` кусками (иначе JSON tool-args обрежется по `max_tokens`).
- Лимит итераций агента: 0 = без лимита; иначе 1-40 (по умолчанию 40).
