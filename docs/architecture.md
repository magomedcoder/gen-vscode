# Architecture (for development)

[Русская версия](architecture-ru.md)

## Data flows

```
Chat (webview)
  -> ChatViewProvider / ChatSession
      -> Ask: HttpLlmClient.complete
      -> Agent: AgentSession.run -> tools -> resolveWorkspacePath -> policy + gitIgnore

Comment command
  -> runCommentPipeline
      -> buildCommentMessages -> LLM -> extract -> validate -> showCommentDiff -> apply
```

## Path policy

1. `resolveAgainstFolders` / symlink check  
2. `.gitignore` + `.genignore` (`gitIgnore.ts`, cached per turn)

## Collaborative editing

- After a successful `write_file` / `apply_diff` / `apply_patch` / `apply_workspace_edit`, the session keeps a snapshot of “how the agent left it” (`AgentWriteTracker`).
- If the buffer diverges from the snapshot: full `write_file` is blocked; `apply_diff` / `apply_patch` / `apply_workspace_edit` apply on current text + confirm on conflict.
- A short user-diff for touched files is injected into the system prompt each turn.

## Sticky plan

- After approving `propose_plan`, the plan is written to **`.gen/plan.md`** when `planWriteToFile` is enabled; in-memory cache for the current session only.
- On extension / workspace restart the plan loads from **`.gen/plan.md`**, not persisted storage.
- **Clear** chat does **not** reset the plan; reset via `update_plan clear` / delete `.gen/plan.md`.
- Before an agent turn the file is re-read; manual diff -> system prompt; file watcher for external edits.

## Project rules (`.genrules`)

- Optional markdown/text file in the workspace root: coding style, architecture, team conventions.
- Loaded at extension start and on file change; injected into agent, ask, and comment prompts (truncated at 12k chars).

## Local plugins / tools (shipped)

Discovery is exposed through the system-prompt catalog and tools `list_plugins` / `plugin` (+ Open in Settings Rules/Skills).

| Kind           | Path                              | Notes                                                                    |
|----------------|-----------------------------------|--------------------------------------------------------------------------|
| Tool (file)    | `.gen/tools/<name>.md`            | Prompt macro only; YAML frontmatter: `name`, `description`               |
| Tool (package) | `.gen/tools/<name>/TOOL.md`       | Prompt macro only; same idea as skills/`SKILL.md`                        |
| Plugin         | `.gen/plugins/<name>/plugin.json` | Required discovery entry: `{ "name"?, "description"?, "instructions"? }` |
| Plugin body    | `.gen/plugins/<name>/PLUGIN.md`   | Used when `instructions` in JSON is empty                                |

The agent loads prompt-macro/plugin bodies via `plugin` or `read_file`; no `.gen/tools` host JS is evaluated.

npm plugins are catalogued from `.gen/npm-plugins.json`, or from `package.json` only when matched by `trustedPlugins`. Trust entries pin an exact `package@version` and may add `#sha256=<declared-bin digest>`. `run_plugin` can spawn only the package's declared `bin` under the workspace-never an arbitrary `command`/PATH executable-and still uses shell confirmation and timeout policy.

Remote skills and instruction URLs use a persistent cache, accept optional `#sha256=<content digest>`, and fall back to matching stale cache content when offline. Settings also previews duplicate Markdown headings across merged project, user, and remote rules.

## Config layers

- User JSON + project `.gen/config.json` merge into effective `GenSettings` (`src/core/config/layers.ts`).
- Settings UI (`globalState`) stores only non-default keys and **never** `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` (`UI_LAYER_EXCLUDED_KEYS`).
- Optional **admin policy** (`GEN_ADMIN_POLICY` / `/etc/gen/policy.json` / `%ProgramData%/gen/policy.json`) locks a security subset - highest precedence (`src/core/config/adminPolicy.ts`).
- Precedence: defaults -> user -> UI (non-default) -> project -> **admin policy**. Remote `.well-known` / full MDM not implemented.
- Details: [settings.md](settings.md).

## Opt-in `.gen/` and scaffold

- Opening a folder does **not** create `.gen/`. Opt-in: chat banner (enable + index) or `/init`.
- `enableProject` / `ensureGenScaffold` (`src/features/project/config.ts`): `config.json` (seeds command/redact keys) plus dirs `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` (`.gitkeep`, README; never overwrite).
- Also seeds workspace-root **`.genignore`** (`DEFAULT_GENIGNORE_PATTERNS`) if missing - path/folder ignore for the agent.
- Details: [codebase-index.md](codebase-index.md), [security.md](security.md).

## Codebase index

- Background indexing into VSCode workspace storage (`storageUri` / `src/features/index/`).
- Tree-sitter wasm (field-based rules): outline + AST chunks; `outlineEngine` / `chunkEngine` modes `treesitter` are **strict** (no fallback).
- Merkle v2 (`merkle.json`, optional `index.sqlite`); content-hash skip + chunk/symbol leaf reuse.
- Scan respects `.gitignore` / `.genignore`; `.gen/` is not indexed.
- UI for engines/status/repair: **Settings -> Project**.
- Tool `codebase_search` - trigram search over chunks.
- Context Engine (`contextEngine.ts`): ranks index hits and open editors; used by `@codebase` and mention context packing.
- Details: [codebase-index.md](codebase-index.md), mentions - [chat.md](chat.md).

## Build

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Tests: `yarn test` (vscode-test)
- Localization: `package.nls*.json` (commands/manifest), `l10n/bundle.l10n*.json` (host + webview UI). Webview strings are injected as `window.__GEN_L10N__` from the host locale.
