# Codebase index

[Русская версия](codebase-index-ru.md)

Local workspace index in VS Code **workspace storage** (`ExtensionContext.storageUri`), not under `.gen/`.

The agent searches it via the `codebase_search` tool (trigrams), without sending the whole index to the LLM.

## Why

- Fast project overview without a full `grep` / `glob` scan
- Ranking code fragments for agent context

## How it works

- The index is written to workspace storage `index/<key>/manifest.json` (+ `merkle.json`: nodes, chunk/symbol digests, skip metrics). Flat `dirDigests` in the manifest mirrors Merkle dirs.
- On update, unchanged dirs/files skip re-read when Merkle digests + **content-hash** match (size+mtime gate); unchanged chunk bodies are reused (stable content ids).
- LSP **symbol index** (optional cache): workspace storage `symbols.json` via `vscode.executeDocumentSymbolProvider`. Used by `find_symbol` / `find_code` intent `symbol` and `@symbols`.
- **Outline** (`outlineEngine`): Tree-sitter wasm (`@vscode/tree-sitter-wasm`) when available, else TypeScript `createSourceFile` (JS/TS) / LSP DocumentSymbol / regex fallback. Settings: `auto` | `treesitter` | `lsp` | `typescript`.
- **Chunks** (`chunkEngine`): AST spans via Tree-sitter (`auto`/`treesitter`) or line/heuristic windows (`lines`).
- `.gen/` is not indexed (same for `.git`, `node_modules` via ignore). Indexing runs in the background without requiring `.gen/config.json`.
- On file change, only that file is reindexed (content-hash compare); outline/symbols update **per-file** (debounced), full rebuild only after a complete index pass.
- `codebase_search` results are fragments (path, lines, snippet, score).
- In chat: `@file`, `@folder`, `@codebase`, `@map`, `@symbols` inject context (see [chat.md](chat.md)).

### Local embeddings (`localEmbeddingsMode`)

| Mode                | Behavior                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `off`               | Remote `/embeddings` only                                                                                          |
| `trigram` (default) | Prefer remote; when remote is missing or fails, `semantic_search` / `find_code` fall back to IndexManager trigrams |

Call hierarchy / “who calls Y”: tool `find_references` (LSP reference + definition providers; multi-root via `folder`/`root`; `limit`/`offset` paging; cross-lang when a language server is available).

## Usage

1. Open a workspace and open Gen chat - indexing starts in the background into `storageUri`.
2. Optionally run **Gen: Initialize project (.gen)** / slash `/init` for agents/commands/skills scaffold (not required for the index).
3. In Agent mode, call `codebase_search` with `query` (symbol, phrase, path). Prefer `find_code` / `find_symbol` / `pack_context` / `similar_code` for hybrid retrieval.
4. For exact line grep - `grep` (paths via `glob`).

### Eval / CI (retrieval)

Offline quality gate (no remote embeddings): `src/test/eval/retrieval.eval.ts` + pure metrics in `src/features/index/retrievalMetrics.ts` (precision@k, hit-rate, simpleScore). Permissions/confirm smoke: `src/test/eval/permissionsConfirm.eval.ts`.

```bash
npm run check-types
npm test -- --grep eval
# or: npm run test:eval
```

### `.gen/` directories (scaffold)

On project enable or `/init`, these are created if missing: `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` - plus a short `.gen/README.md` and `.gitkeep` in empty dirs. Existing files are never overwritten. `references.json` is created on demand, not during scaffold.

More on tools: [tools.md](tools.md).
