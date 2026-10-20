# Security

[Русская версия](security-ru.md)

## Path sandbox

The agent works **only** inside the open workspace:

- block `..` and absolute paths outside workspace folders;
- after resolving a symlink, the path is checked again for workspace membership;
- relative paths are resolved from the workspace root.

## Path ignore layers

A path is unavailable to tools if **any** layer matches:

| Layer               | Source                     | Purpose                                              |
|---------------------|----------------------------|------------------------------------------------------|
| Workspace / symlink | built-in                   | Do not leave the project                             |
| `.gitignore`        | file at workspace **root** | Like git: build output, `node_modules`, logs...      |
| `.genignore`        | file at workspace **root** | Hide paths/folders from the agent (gitignore syntax) |

The `.gitignore` / `.genignore` matcher is cached for one agent turn (`ignore` package, **no** `git check-ignore` spawn). The `.git` directory is always closed.

`vendor` / `target` are **not** hard-coded - the repo’s ignore should cover them.

### Why `.genignore`

`.gitignore` - what not to commit.  
`.genignore` - what the **agent must not read/touch**, even if the file is in the repo.

Example `.genignore`:

```gitignore
# secrets that still sit in the tree
.env.local
secrets/
*.pem
credentials.json

# noisy data
fixtures/large/
*.dump
datasets/

# internal
.gen/
docs/private/
```

## Secret redaction

`secretPatterns` in user/project JSON (not Settings UI) - JS regexps, one per line.  
Matches in text sent to the LLM / shown from tools become `[REDACTED]`.  
Empty list - no redaction. Invalid regexps are skipped.

Sensitive **writes** (e.g. `.env*`) use `sensitivePathPatterns` in the same JSON files (ask/deny on write even with auto-approve). Folder/path hide-from-agent belongs in `.genignore`, not these keys.

## Commands (`run_command`)

No shell/pipe.

**Denied binaries** come from `deniedCommands` in user/project JSON (not Settings UI). Default list includes shells (`sh`, `bash`, ...), network (`curl`, `wget`, `ssh`, ...), destructive (`rm`, `chmod`, ...), containers (`docker`, `kubectl`, ...). Empty list - do not block by binary name.

Still always blocked in code:

- package install / publish subcommands (`npm install`, ...)
- `git push` / `commit` / `reset` / ...
- eval flags with code (`node -e`, `python -c`); `gcc -c file.c` and `git -c key=value` are allowed

`run_tests` / `run_command` follow `approvalPolicy.shell` (and `autoApprove`) in **Settings -> Security**.

## Permissions

See [chat.md](chat.md#permissions-security).

## API keys (SecretStorage vault)

LLM `apiKey`, optional `embeddingsApiKey`, and `webSearchApiKey` live in VS Code **SecretStorage** only. The Settings webview receives `*Set` booleans, never the secret values.

| Action | Effect |
|--------|--------|
| **Rotate** | Type a new value in the field and **Save** - overwrites the stored secret |
| **Clear** | **Clear stored key**, then **Save** - host asks for confirmation, then deletes the secret |
| **Plain value** | Stored as-is in SecretStorage |
| **`${env:NAME}`** | Resolved at use time from `process.env` |
| **`{file:path}`** | Resolved at use time from file contents (workspace-relative path); use **Browse file...** in Settings |

Embeddings requests use `embeddingsApiKey` when set; otherwise they use the LLM `apiKey`.
