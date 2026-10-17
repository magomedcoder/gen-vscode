# Settings

[Русская версия](settings-ru.md)

**Reset to defaults** restores all fields to defaults; the **API key is not cleared**.

## Settings screens

Sidebar is a single flat list (**6 screens**). Sections inside a screen are collapsible.

**Connection** (incl. Requests) **Chat** **Agent** **Security** (incl. Permissions) **Project** (Indexing, Rules, Personas, Agents, Hooks) **Journal** (Usage, Activity, Logs).

Use Base URL + model list for any OpenAI-compatible endpoint (e.g. `http://127.0.0.1:8080/v1` for llama.cpp).

## Config layers (JSON)

Effective `GenSettings` is merged from several layers (**low * high** precedence):

1. Built-in `DEFAULT_SETTINGS`
2. User: `~/.config/gen/config.json` (Linux: `$XDG_CONFIG_HOME/gen` or `~/.config/gen`; Windows: `%APPDATA%/gen`; macOS: `~/.config/gen`; override: `GEN_CONFIG_DIR`)
3. Gen Settings UI (extension `globalState`) - only fields that **differ from defaults** (excludes `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` - not from UI)
4. Project: `<workspace>/.gen/config.json` (only keys present in the file)
5. **Admin policy** (highest): locks/forces a security subset - cannot be overridden by project or UI

**Not implemented:** remote `.well-known`, full MDM/SSO.

### Admin policy (managed)

Optional machine-wide policy file (first match):

1. `GEN_ADMIN_POLICY` - absolute path to a JSON file (if set, only this path is tried)
2. Linux / macOS: `/etc/gen/policy.json`
3. Windows: `%ProgramData%/gen/policy.json`

Keys present in the file are **locked** and force effective settings. Supported lock keys: `approvalPolicy`, `autoApprove`, `continueLoopOnDeny`, `enableTerminal`, `enableFileReading`, `enableWorkspaceContext`, `webSearchEnabled`, `webFetchEnabled`, `allowExternalDirectory`, `otelEnabled`, `otelEndpoint`, `indexingEnabled`, `embeddingsBaseUrl`, `baseUrl`, `planModel`, `actModel`, `smallModel`, and `localEmbeddingsMode`.

Example:

```json
{
  "$schema": "./schemas/gen-policy.schema.json",
  "webSearchEnabled": false,
  "webFetchEnabled": false,
  "allowExternalDirectory": false,
  "otelEnabled": false
}
```

When active, Gen Settings shows a read-only banner listing locked keys. Invalid policy values are ignored instead of being locked. Schema: `schemas/gen-policy.schema.json`.

The Gen Settings UI stays intact: layers are an additive overlay. Project overrides user and non-default UI values for keys set in JSON. Admin wins for locked keys. The only VSCode Settings key (`gen.chatViewLocation`) is synced from effective config for view `when` clauses.

Supported JSON keys (GenSettings subset): `systemPrompt`, `commentSystemPrompt`, `primaryTools`, `watcherIgnore`, `webSearch*` (`webSearchBackend`: `duckduckgo` \| `exa` \| `parallel` \| `http`), `webFetchEnabled`, `skillsPaths` / `skillsUrls` / `instructionUrls`, `personaId`, `usernameDisplay`, `deniedCommands` / `sensitivePathPatterns` / `secretPatterns` (JSON only - not Settings UI), agent/indexing knobs (`outlineEngine`, `chunkEngine`, `treeSitterLanguages`, `indexStorageBackend`, ...), timeouts, `chatMode`, `planShellPolicy` (`ask` \| `deny`), `shareMode`, `revealOnEdit`, `thinkingDisplay`, `chatViewLocation`, and more - see `FILE_LAYER_KEYS` in `src/core/config/layers.ts`. Path/folder ignore is **not** a settings key - use `.genignore`.

Also in JSON:

- `hooksPath` - path to `hooks.json` (workspace-relative or absolute)
- `hooks` - inline hook commands (same shape as `.gen/hooks.json`); non-empty lists override the file

### Hooks (`.gen/hooks.json`)

Shell commands per event. Always set `GEN_HOOK_EVENT`. Non-zero exit **vetoes** unless noted as notify-only.

| Event                | When                                            | Payload (env)                                     | stdout / control                                                                                    |
|----------------------|-------------------------------------------------|---------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `beforeSubmit`       | Before chat send                                | `GEN_HOOK_TEXT`                                   | exit ≠ 0 * block submit                                                                             |
| `beforeShell`        | Before agent shell tools                        | `GEN_HOOK_COMMAND`                                | exit ≠ 0 * block command                                                                            |
| `shell.env`          | After `beforeShell`, before `run_command` spawn | `GEN_HOOK_COMMAND`, `GEN_HOOK_CWD`                | JSON `{"env":{"K":"V"}}` / `{"K":"V"}` or `KEY=value` lines * merge into child env; exit ≠ 0 * veto |
| `session.diff`       | After turn file writes                          | `GEN_HOOK_PATHS`, `GEN_HOOK_TURN_ID`              | notify-only                                                                                         |
| `session.compacting` | Before `/compact`                               | -                                                 | exit ≠ 0 * block compact                                                                            |
| `file.watcher`       | Debounced changes under `.gen/**`               | `GEN_HOOK_PATH`, `GEN_HOOK_FILE_EVENT` (`create`\ | `change`\                                                                                           |`delete`), `GEN_HOOK_PATHS`, `GEN_HOOK_FILE_EVENTS` | notify-only                                                                                         |

Project metadata (`version`, `createdAt`, `$schema`) is not mapped into settings. Arrays (e.g. `deniedCommands`, `skillsPaths`) are **replaced** on merge, not concatenated.

User and project JSON are validated when loaded. Diagnostics include JSON Pointer paths. If an existing file becomes malformed, the last valid in-memory layer remains active instead of silently replacing it with an empty layer.

### JSON Schema

With the extension installed, VSCode validates matching files via `contributes.jsonValidation` (no `$schema` required):

| File                                                   | Schema in extension                  |
|--------------------------------------------------------|--------------------------------------|
| `**/.gen/config.json`, `**/gen/config.json` (user XDG) | `schemas/gen-config.schema.json`     |
| `**/.gen/hooks.json`                                   | `schemas/gen-hooks.schema.json`      |
| `**/.gen/references.json`, `**/.gen/references/*.json` | `schemas/gen-references.schema.json` |
| `/etc/gen/policy.json`, `**/.config/gen/policy.json`   | `schemas/gen-policy.schema.json`     |

Optional `$schema` (editors without the extension, or explicit pinning):

```json
{
  "$schema": "https://raw.githubusercontent.com/magomedcoder/gen-vscode/main/schemas/gen-config.schema.json"
}
```

Same pattern for hooks / references - swap the filename (`gen-hooks.schema.json`, `gen-references.schema.json`). Relative path from a workspace that vendors the repo: `"$schema": "./schemas/gen-config.schema.json"` (adjust depth).

## General

| Field      | Default         | Description                                                                                    |
|------------|-----------------|------------------------------------------------------------------------------------------------|
| Base URL   | empty           | API root: primarily **llama.cpp** (`http://127.0.0.1:8080`), or any OpenAI-compatible endpoint |
| API key    | -               | In `SecretStorage`; empty - do not send a header                                               |
| Key header | `Authorization` | HTTP header name                                                                               |
| Key scheme | `Bearer`        | Value prefix; empty scheme - raw key                                                           |
| Model      | empty           | Model id; list is loaded from the URL                                                          |

## Chat & Agent

| Field           | Default | Description                   |
|-----------------|---------|-------------------------------|
| Chat mode       | `ask`   | Ask or Agent                  |
| Iteration limit | `40`    | 0 = unlimited; otherwise 1-40 |

Permissions: **Settings -> Security** (`approvalPolicy` / `autoApprove`) - see [chat.md](chat.md#permissions-security).

Comment options live on the **Chat** screen (collapsible **Comments** section): style, diff before apply, extra system prompt. Details: [comments.md](comments.md).

Indexing (Tree-sitter engines, merkle/sqlite backend, status/repair) lives on **Settings -> Project**. Details: [codebase-index.md](codebase-index.md).

## Requests

| Field                | Default  | Description                       |
|----------------------|----------|-----------------------------------|
| Temperature          | `0.2`    | 0-2; keep low for stable format   |
| Max response tokens  | `8192`   | min 64                            |
| Timeout (ms)         | `120000` | min 1000                          |
| Max input characters | `8000`   | Limit for comment fragments, etc. |

## Security (UI)

Settings -> Security keeps agent capabilities and approval policy (presets / Always / allow ask review deny).

### Path ignore & project policy - files, not UI

| What                                | Edit where                            | Description                                                |
|-------------------------------------|---------------------------------------|------------------------------------------------------------|
| Paths and folders                   | **`.genignore`** at workspace root    | Gitignore syntax; primary way to hide files from the agent |
| Commands / redact / sensitive write | **`.gen/config.json`** (or user JSON) | Keys below; **not** for folder ignore                      |

In `config.json` (not Settings UI, not globalState):

| Key                     | Default           | Description                         |
|-------------------------|-------------------|-------------------------------------|
| `sensitivePathPatterns` | `.env`, `.env.*`  | Sensitive paths (ask/deny on write) |
| `deniedCommands`        | built-in denylist | Binary names for `run_command`      |
| `secretPatterns`        | `[]`              | JS regexps; matches -> `[REDACTED]` |

`Gen: Initialize project` seeds `.genignore` and a `config.json` with command/redact keys. Full policy: [security.md](security.md).

### Web search (`web_search`)

Backend (`webSearchBackend`, Settings * Request):

| Value                  | Key                                  | Endpoint                                                                                                  |
|------------------------|--------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `duckduckgo` (default) | none                                 | DuckDuckGo HTML scrape                                                                                    |
| `exa`                  | `webSearchApiKey` * `x-api-key`      | `POST https://api.exa.ai/search` (`query`, `numResults`)                                                  |
| `parallel`             | `webSearchApiKey` * `x-api-key`      | `POST https://api.parallel.ai/v1/search` (`objective`, `search_queries`, `advanced_settings.max_results`) |
| `http`                 | optional key + `webSearchHttpHeader` | GET `webSearchHttpUrl` with `{query}`                                                                     |

Key supports `${env:NAME}` / `{file:path}`. Results normalize to `{ title, url }[]` (expected: `results[].title`/`url`; missing title falls back to url). Exa/Parallel are best-effort adapters from public docs.

## Logs

| Field      | Default | Description                                    |
|------------|---------|------------------------------------------------|
| Write logs | off     | Output `Gen LLM` / `Gen Agent` + files on disk |

**Open logs folder** button. Details: [logging.md](logging.md).
