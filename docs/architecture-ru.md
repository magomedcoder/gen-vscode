# Архитектура (для разработки)

[English version](architecture.md)

## Потоки данных

```
Chat (webview)
  -> ChatViewProvider / ChatSession
      -> Ask: HttpLlmClient.complete
      -> Agent: AgentSession.run -> tools -> resolveWorkspacePath -> policy + gitIgnore

Comment command
  -> runCommentPipeline
      -> buildCommentMessages -> LLM -> extract -> validate -> showCommentDiff -> apply
```

## Политика путей

1. `resolveAgainstFolders` / symlink check  
2. `.gitignore` + `.genignore` (`gitIgnore.ts`, кэш на turn)

## Совместное редактирование

- После успешного `write_file` / `apply_diff` / `apply_patch` / `apply_workspace_edit` сессия хранит снимок «как агент оставил» (`AgentWriteTracker`).
- Если буфер расходится со снимком: полный `write_file` запрещён; `apply_diff` / `apply_patch` / `apply_workspace_edit` - поверх актуального текста + confirm при конфликте.
- В system prompt на ход подмешивается краткий user-diff по затронутым файлам.

## Sticky plan

- После approve `propose_plan` план пишется в **`.gen/plan.md`**, если включён `planWriteToFile`; в памяти - только на текущую сессию.
- При перезапуске расширения / workspace план загружается из **`.gen/plan.md`**, не из storage.
- «Очистить» чат **не** сбрасывает план; сброс - `update_plan clear` / удаление `.gen/plan.md`.
- Перед agent turn файл перечитывается; ручной diff -> system prompt; watcher на правки файла снаружи.

## Правила проекта (`.genrules`)

- Опциональный markdown/текст в корне workspace: стиль кода, архитектура, договорённости команды.
- Загружается при старте расширения и при изменении файла; подмешивается в промпты agent / ask / комментариев (обрезка до 12k символов).

## Локальные plugins / tools (shipped)

Discovery доступен через каталог в system prompt и tools `list_plugins` / `plugin` (+ Open в Settings Rules/Skills).

| Вид          | Путь                              | Заметки                                                                        |
|--------------|-----------------------------------|--------------------------------------------------------------------------------|
| Tool (файл)  | `.gen/tools/<name>.md`            | Только prompt-макрос; YAML frontmatter: `name`, `description`                  |
| Tool (пакет) | `.gen/tools/<name>/TOOL.md`       | Только prompt-макрос; как skills/`SKILL.md`                                    |
| Plugin       | `.gen/plugins/<name>/plugin.json` | Обязательная точка обнаружения: `{ "name"?, "description"?, "instructions"? }` |
| Plugin body  | `.gen/plugins/<name>/PLUGIN.md`   | Если `instructions` в JSON пуст                                                |

Агент читает prompt-макросы и тела plugins через `plugin` или `read_file`; host JS из `.gen/tools` не выполняется.

npm plugins попадают в каталог из `.gen/npm-plugins.json`, либо из `package.json` только при совпадении с `trustedPlugins`. Trust-запись фиксирует точный `package@version` и может содержать `#sha256=<digest declared bin>`. `run_plugin` запускает только объявленный пакетом `bin` внутри workspace - не произвольный `command`/PATH executable - с обычным shell confirm и timeout.

Удалённые skills и instruction URLs используют постоянный кэш, поддерживают опциональный `#sha256=<content digest>` и при offline используют подходящую stale-копию. Settings показывает повторяющиеся Markdown-заголовки при merge project, user и remote rules.

## Слои конфига

- User JSON + project `.gen/config.json` мержатся в effective `GenSettings` (`src/core/config/layers.ts`).
- Settings UI (`globalState`) хранит только non-default ключи и **никогда** `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` (`UI_LAYER_EXCLUDED_KEYS`).
- Опциональная **admin policy** (`GEN_ADMIN_POLICY` / `/etc/gen/policy.json` / `%ProgramData%/gen/policy.json`) блокирует security-subset - наивысший приоритет (`src/core/config/adminPolicy.ts`).
- Приоритет: defaults -> user -> UI (non-default) -> project -> **admin policy**. Remote `.well-known` / полный MDM - не реализован.
- Подробнее: [settings-ru.md](settings-ru.md).

## Opt-in `.gen/` и scaffold

- При открытии папки `.gen/` **не** создаётся. Opt-in: кнопка в чате (enable + индекс) или `/init`.
- `enableProject` / `ensureGenScaffold` (`src/features/project/config.ts`): `config.json` (seed ключей команд/redact) + каталоги `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` (`.gitkeep`, README; без перезаписи).
- Также seed **`.genignore`** в корне workspace (`DEFAULT_GENIGNORE_PATTERNS`), если файла ещё нет - ignore путей/папок для агента.
- Подробнее: [codebase-index-ru.md](codebase-index-ru.md), [security-ru.md](security-ru.md).

## Индекс кодовой базы

- Фоновая индексация в VSCode workspace storage (`storageUri` / `src/features/index/`).
- Tree-sitter wasm (field-based правила): outline + AST-чанки; режимы `outlineEngine` / `chunkEngine` = `treesitter` - **строгие** (без fallback).
- Merkle v2 (`merkle.json`, опционально `index.sqlite`); skip по content-hash + reuse листьев чанков/символов.
- Scan учитывает `.gitignore` / `.genignore`; `.gen/` не индексируется.
- UI движков/статуса/repair: **Settings -> Проект**.
- Tool `codebase_search` - триграммный поиск по chunks.
- Context Engine (`contextEngine.ts`): ранжирует hits индекса и открытых редакторов; используется в `@codebase` и при сборке контекста упоминаний.
- Подробнее: [codebase-index-ru.md](codebase-index-ru.md), упоминания - [chat-ru.md](chat-ru.md).

## Сборка

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Тесты: `yarn test` (vscode-test)
- Локализация: `package.nls*.json` (команды/манифест), `l10n/bundle.l10n*.json` (host + UI webview). Строки webview инжектятся как `window.__GEN_L10N__` по локали host.
