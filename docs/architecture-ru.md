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
2. `deniedPaths` (`policy.ts`)  
3. `.gitignore` + `.genignore` (`gitIgnore.ts`, кэш на turn)

## Совместное редактирование

- После успешного `write_file` / `apply_patch` / `apply_workspace_edit` сессия хранит снимок «как агент оставил» (`AgentWriteTracker`).
- Если буфер расходится со снимком: полный `write_file` запрещён; `apply_patch` / `apply_workspace_edit` - поверх актуального текста + confirm при конфликте.
- В system prompt на ход подмешивается краткий user-diff по затронутым файлам.

## Sticky plan

- После approve `propose_plan` план пишется в **`.gen/plan.md`**, если включён `planWriteToFile`; в памяти - только на текущую сессию.
- При перезапуске расширения / workspace план загружается из **`.gen/plan.md`**, не из storage.
- «Очистить» чат **не** сбрасывает план; сброс - `update_plan clear` / удаление `.gen/plan.md`.
- Перед agent turn файл перечитывается; ручной diff -> system prompt; watcher на правки файла снаружи.

## Правила проекта (`.genrules`)

- Опциональный markdown/текст в корне workspace: стиль кода, архитектура, договорённости команды.
- Загружается при старте расширения и при изменении файла; подмешивается в промпты agent / ask / комментариев (обрезка до 12k символов).

## Локальные plugins / tools (MVP)

Без npm и без выполнения произвольного JS. Только discovery + каталог в system prompt + tools `list_plugins` / `plugin` (+ Open в Settings Rules/Skills).

| Вид          | Путь                              | Заметки                                                                        |
|--------------|-----------------------------------|--------------------------------------------------------------------------------|
| Tool (файл)  | `.gen/tools/<name>.md`            | YAML frontmatter: `name`, `description`                                        |
| Tool (пакет) | `.gen/tools/<name>/TOOL.md`       | Как skills/`SKILL.md`                                                          |
| Plugin       | `.gen/plugins/<name>/plugin.json` | Обязательная точка обнаружения: `{ "name"?, "description"?, "instructions"? }` |
| Plugin body  | `.gen/plugins/<name>/PLUGIN.md`   | Если `instructions` в JSON пуст                                                |

Агент читает тело через `plugin` (по имени) или `read_file` по пути из каталога. npm-пакеты плагинов - ещё нет.

## Слои конфига

- User JSON + project `.gen/config.json` мержатся в effective `GenSettings` (`src/core/config/layers.ts`).
- Опциональная **admin policy** (`GEN_ADMIN_POLICY` / `/etc/gen/policy.json` / `%ProgramData%/gen/policy.json`) блокирует security-subset - наивысший приоритет (`src/core/config/adminPolicy.ts`).
- Приоритет: defaults user UI (non-default) project **admin policy**. Remote `.well-known` / полный MDM - не реализован.
- Подробнее: [settings-ru.md](settings-ru.md).

## Opt-in `.gen/` и scaffold

- При открытии папки `.gen/` **не** создаётся. Opt-in: кнопка в чате (enable + индекс) или `/init`.
- `enableProject` / `ensureGenScaffold` (`src/features/project/config.ts`): `config.json` + каталоги `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` (`.gitkeep`, README; без перезаписи).
- Подробнее: [codebase-index-ru.md](codebase-index-ru.md).

## Индекс кодовой базы

- Фоновая индексация в VS Code workspace storage (`storageUri` / `src/features/index/`), Tree-sitter wasm outline/AST-чанки и Merkle v2 skip (`merkle.json`).
- Инкремент по hash файла; `.gen/` не индексируется.
- Tool `codebase_search` - триграммный поиск по chunks.
- Context Engine (`contextEngine.ts`): ранжирует hits индекса и открытых редакторов; используется в `@codebase` и при сборке контекста упоминаний.
- Подробнее: [codebase-index-ru.md](codebase-index-ru.md), упоминания - [chat-ru.md](chat-ru.md).

## Сборка

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Тесты: `yarn test` (vscode-test)
- Локализация: `package.nls*.json` (команды/манифест), `l10n/bundle.l10n*.json` (host + UI webview). Строки webview инжектятся как `window.__GEN_L10N__` по локали host.
