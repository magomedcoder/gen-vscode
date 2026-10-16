# Индекс кодовой базы

[English version](codebase-index.md)

Локальный индекс workspace в VS Code **workspace storage** (`ExtensionContext.storageUri`), не под `.gen/`.

Агент ищет по нему через tool `codebase_search` (триграммы), без отправки всего индекса в LLM.

## Зачем

- Быстрый обзор проекта без полного `grep` / `glob`
- Ранжирование фрагментов кода для контекста агента

## Как устроено

- Индекс пишется в workspace storage `index/<key>/manifest.json` (+ `merkle.json`: узлы, digests чанков/символов, метрики skip; опционально `index.sqlite` при `indexStorageBackend=sqlite` и числе файлов ≥ `indexSqliteMinFiles`). Flat `dirDigests` в манифесте зеркалит Merkle-каталоги.
- При обновлении неизменённые каталоги/файлы пропускаются по Merkle digests + **content-hash** (size+mtime gate; `indexForceContentHash` форсирует content-hash); неизменённые тела чанков и symbol leaves переиспользуются (стабильные content id / merkle patch).
- LSP **symbol index** (кэш): workspace storage `symbols.json` через `vscode.executeDocumentSymbolProvider`. Tools: `find_symbol` / `find_code` intent `symbol`, mention `@symbols`.
- **Outline** (`outlineEngine`): Tree-sitter wasm (`@vscode/tree-sitter-wasm`) с field-based правилами если доступен; `auto` падает на TypeScript `createSourceFile` (JS/TS) / LSP DocumentSymbol / regex. Режим `treesitter` - **строгий** (без fallback). Настройки: `auto` | `treesitter` | `lsp` | `typescript`.
- **Чанки** (`chunkEngine`): AST-span через Tree-sitter (`auto` с fallback или **строгий** `treesitter`) или построчные/эвристические окна (`lines`). Языки: `treeSitterLanguages` (пусто = MVP whitelist; `*` / `all` = все доступные wasm).
- `.gen/` не индексируется (как и `.git`, `node_modules` через ignore). Индексация идёт в фоне без `.gen/config.json`.
- При изменении файла переиндексируется только он (сравнение content-hash); outline/symbols обновляются **per-file** (debounce), полный rebuild - только после full index.
- Результаты `codebase_search` - фрагменты (path, строки, snippet, score).
- В чате: `@file`, `@folder`, `@codebase`, `@map`, `@symbols` (см. [chat-ru.md](chat-ru.md)).

### Локальные embeddings (`localEmbeddingsMode`)

| Режим               | Поведение                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `off`               | Только remote `/embeddings`                                                                                                    |
| `trigram` (default) | Remote по возможности; при ошибке / отсутствии remote - fallback на триграммы IndexManager для `semantic_search` / `find_code` |

Call hierarchy / «кто вызывает Y»: tool `find_references` (LSP references + definition; multi-root через `folder`/`root`; paging `limit`/`offset`; cross-lang при наличии language server).

## Использование

1. Открыть workspace и чат Gen - индексация стартует в фоне в `storageUri`.
2. Опционально **Gen: Инициализировать проект (.gen)** / slash `/init` для scaffold agents/commands/skills (для индекса не обязательно).
3. В режиме Agent вызвать `codebase_search` с `query` (символ, фраза, путь). Предпочтительнее `find_code` / `find_symbol` / `pack_context` / `similar_code`.
4. Для точного grep по строке - `grep` (пути через `glob`).

### Eval / CI (retrieval)

Offline gate качества (без remote embeddings): `src/test/eval/retrieval.eval.ts` + pure-метрики в `src/features/index/retrievalMetrics.ts` (precision@k, hit-rate, simpleScore). Smoke permissions/confirm: `src/test/eval/permissionsConfirm.eval.ts`.

```bash
npm run check-types
npm test -- --grep eval
# или: npm run test:eval
```

### Каталоги `.gen/` (scaffold)

При enable проекта или `/init` создаются (если ещё нет): `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` - плюс краткий `.gen/README.md` и `.gitkeep` в пустых каталогах. Существующие файлы не перезаписываются. `references.json` появляется по требованию, не при scaffold.

Подробнее про tools: [tools-ru.md](tools-ru.md).
