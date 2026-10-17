# Безопасность

[English version](security.md)

## Path sandbox

Агент работает **только** внутри открытого workspace:

- запрет `..` и абсолютных путей вне папок workspace;
- после symlink путь снова проверяется на принадлежность workspace;
- относительные пути считаются от корня workspace.

## Слои ignore путей

Путь недоступен tools, если срабатывает **любой** слой:

| Слой                | Источник                   | Назначение                                                          |
|---------------------|----------------------------|---------------------------------------------------------------------|
| Workspace / symlink | встроенно                  | Не выйти за проект                                                  |
| `.gitignore`        | файл в **корне** workspace | Как у git: сборка, `node_modules`, логи...                          |
| `.genignore`        | файл в **корне** workspace | Способ закрыть пути/папки для агента (синтаксис как у `.gitignore`) |

Матчер `.gitignore` / `.genignore` кэшируется на один agent turn (пакет `ignore`, **без** spawn `git check-ignore`). Каталог `.git` всегда закрыт.

`vendor` / `target` **не** зашиты в код - их должен закрывать ignore репозитория.

### Зачем `.genignore`

`.gitignore` - что не коммитить.  
`.genignore` - что **нельзя читать/трогать агенту**, даже если файл в репозитории.

Пример `.genignore`:

```gitignore
# секреты, которые всё же в дереве
.env.local
secrets/
*.pem
credentials.json

# шумные данные
fixtures/large/
*.dump
datasets/

# внутреннее
.gen/
docs/private/
```

## Маскировка секретов

`secretPatterns` в user/project JSON (не Settings UI) - JS-regexp по одному на строку.  
Совпадения в тексте, уходящем в LLM / показываемом из tools, заменяются на `[REDACTED]`.  
Пустой список - маскировки нет. Невалидная регулярка пропускается.

Чувствительные **записи** (например `.env*`) - `sensitivePathPatterns` в тех же JSON (ask/deny на запись даже при auto-approve). Скрыть путь/папку от агента - в `.genignore`, не в этих ключах.

## Команды (`run_command`)

Без shell/pipe.

**Запрещённые бинарники** задаются через `deniedCommands` в user/project JSON (не Settings UI). По умолчанию: оболочки (`sh`, `bash`, ...), сеть (`curl`, `wget`, `ssh`, ...), разрушительное (`rm`, `chmod`, ...), контейнеры (`docker`, `kubectl`, ...). Пустой список - не блокировать по имени.

В коде по-прежнему всегда запрещены:

- package install / publish (`npm install`, ...)
- `git push` / `commit` / `reset` / ...
- eval-флаги с кодом (`node -e`, `python -c`); `gcc -c file.c` и `git -c key=value` - можно

`run_tests` / `run_command` подчиняются `approvalPolicy.shell` (и `autoApprove`) в **Settings -> Безопасность**.

## Права

См. [chat-ru.md](chat-ru.md#права-безопасность).
