import type { ApprovalPolicy } from './approvalTypes';
import { DEFAULT_APPROVAL_POLICY } from './approvalTypes';

export type ChatMode = 'ask' | 'agent' | 'debug' | 'design' | 'plan' | 'multitask' | 'project';
export type CommentStyle = 'inline' | 'block';
// Как показывать reasoning/thinking в чате
export type ThinkingDisplay = 'off' | 'collapsed' | 'expanded';
// Политика при переполнении контекста (локальные движки / длинные чаты)
export type ContextOverflowPolicy = 'auto_compact_retry' | 'ask' | 'fail_fast';
// Режим share активного редактора
export type ShareMode = 'manual' | 'auto' | 'disabled';
// Как открывать файл после правки агента: never / preview (без фокуса) / focus
export type RevealOnEdit = 'never' | 'preview' | 'focus';
// Бэкенд web_search: DuckDuckGo HTML, Exa/Parallel presets или произвольный HTTP JSON API
export type WebSearchBackend = 'duckduckgo' | 'exa' | 'parallel' | 'http';
export type ImageQualityPreset = 'low' | 'medium' | 'high';
/**
 * Shell в режиме Plan: `ask` - run_command/run_tests с обязательным confirm;
 * `deny` - shell-инструменты скрыты (как раньше). Правки в Plan всегда запрещены.
 */
export type PlanShellPolicy = 'deny' | 'ask';
// После правки агента: diagnostics / related tests в tool result
export type VerifyAfterEdit = 'off' | 'diagnostics' | 'diagnostics_tests' | 'full';
// При лимите вкладок: блокировать new / закрывать самые старые idle
export type TabEvictionPolicy = 'block' | 'closeOldestIdle';
// Движок outline: Tree-sitter wasm / LSP / TypeScript API / auto
export type OutlineEngine = 'auto' | 'treesitter' | 'lsp' | 'typescript';
// Нарезка чанков: AST через Tree-sitter / построчная эвристика / auto
export type ChunkEngine = 'auto' | 'treesitter' | 'lines';

// Режимы с tool-calling (не ask). Список режимов - CHAT_MODE_DEFS; ask единственный non-agent-like.
export function isAgentLikeMode(mode: ChatMode): boolean {
	return mode !== 'ask';
}

// Модель для заголовка, сжатия и сводки; пусто - undefined (основная модель как резервная в клиенте)
export function resolveSmallModel(settings: Pick<GenSettings, 'smallModel'>): string | undefined {
	const m = settings.smallModel.trim();
	return m || undefined;
}

// Модель для текущего режима: planModel в Plan, actModel в agent-like, иначе model
export function resolveModeModel(
	settings: Pick<GenSettings, 'model' | 'planModel' | 'actModel' | 'chatMode'>,
): string {
	if (settings.chatMode === 'plan') {
		const p = settings.planModel.trim();
		if (p) {
			return p;
		}
	} else if (settings.chatMode !== 'ask') {
		const a = settings.actModel.trim();
		if (a) {
			return a;
		}
	}

	return settings.model.trim();
}

export interface GenSettings {
	baseUrl: string;
	model: string;
	/**
	 * Дешёвая модель для title / summary / compaction (пусто - как основная)
	 */
	smallModel: string;
	/**
	 * Модель для режима Plan (пусто - как model)
	 */
	planModel: string;
	/**
	 * Модель для Agent / Act и прочих agent-like режимов (пусто - как model)
	 */
	actModel: string;
	/**
	 * Режим чата по умолчанию: ask / agent / debug / design / plan / multitask / project
	 */
	chatMode: ChatMode;
	/**
	 * Политика подтверждений по типам действий (shell / edits / delete / ...)
	 */
	approvalPolicy: ApprovalPolicy;
	/**
	 * Авто-одобрять ask (deny остаётся deny)
	 */
	autoApprove: boolean;
	/**
	 * Сохранять Always-паттерны между перезагрузками (workspaceState).
	 * По умолчанию false - только на текущую сессию вкладки.
	 */
	persistAlwaysAllow: boolean;
	/**
	 * Не прерывать цикл агента после deny - вернуть причину модели и продолжить
	 */
	continueLoopOnDeny: boolean;
	/**
	 * Подмешивать контекст workspace в prompt
	 */
	enableWorkspaceContext: boolean;
	/**
	 * Постоянно (always-on): короткая сводка (git status -sb, недавние файлы) в каждый turn.
	 * Отдельно от shareMode (активный редактор / выделение).
	 */
	alwaysOnWorkspaceContext: boolean;
	/**
	 * Режим share активного редактора: manual | auto | disabled.
	 * по умолчанию - manual
	 */
	shareMode: ShareMode;
	/**
	 * Имена tools только для primary-агента (пустой список = все доступные).
	 * Субагенты этот фильтр не применяют.
	 */
	primaryTools: string[];
	/**
	 * Маршрутизация patch по модели: GPT-семейство получает `apply_patch`; остальные - только write/edit.
	 * false - всегда отдавать `apply_patch` (как раньше).
	 * по умолчанию - true
	 */
	modelRoutedPatch: boolean;
	/**
	 * Glob/gitignore-паттерны: FS-watcher не переиндексирует совпавшие пути.
	 * по умолчанию - []
	 */
	watcherIgnore: string[];
	/**
	 * После правки агента: не открывать / preview без фокуса / focus (как раньше).
	 * по умолчанию - never
	 */
	revealOnEdit: RevealOnEdit;
	/**
	 * Фоновые правки: не открывать/фокусировать редактор (эквивалент revealOnEdit=never).
	 * по умолчанию - true
	 */
	backgroundEditMode: boolean;
	/**
	 * Показать vscode notification, когда ход агента завершён.
	 */
	notifyOnComplete: boolean;
	/**
	 * Короткий beep в chat webview при завершении хода (если notifyOnComplete).
	 */
	notifySoundOnComplete: boolean;
	/**
	 * Разрешить чтение файлов tools
	 */
	enableFileReading: boolean;
	/**
	 * Разрешить терминал / run_command
	 */
	enableTerminal: boolean;
	/**
	 * Разрешить web_search
	 */
	webSearchEnabled: boolean;
	/**
	 * Бэкенд web_search: duckduckgo (по умолчанию) | exa | parallel | http
	 */
	webSearchBackend: WebSearchBackend;
	/**
	 * URL HTTP-бэкенда: шаблон с `{query}` или база, к которой дописывается `?q=`
	 * (только для `http`; Exa/Parallel используют фиксированные endpoints)
	 */
	webSearchHttpUrl: string;
	/**
	 * Имя заголовка для API-ключа HTTP-бэкенда (например Authorization).
	 * Для exa/parallel игнорируется - всегда `x-api-key`.
	 */
	webSearchHttpHeader: string;
	/**
	 * Разрешить fetch_page / @link
	 */
	webFetchEnabled: boolean;
	/**
	 * Разрешить design_screenshot (headless Chromium через optional playwright).
	 */
	designScreenshotEnabled: boolean;
	/**
	 * Разрешить browser_action (Playwright computer-use loop).
	 */
	browserComputerUseEnabled: boolean;
	/** 
	 * Ширина viewport для browser_action / launch. 
	 */
	browserViewportWidth: number;
	/** 
	 * Высота viewport для browser_action / launch. 
	 */
	browserViewportHeight: number;
	/**
	 * CDP endpoint (например http://127.0.0.1:9222); пусто = headless launch.
	 */
	browserCdpEndpoint: string;
	/** 
	 * Путь к custom Chrome/Chromium; пусто = Playwright по умолчанию.
	 */
	browserChromePath: string;
	/**
	 * Включить ghost text (InlineCompletionItemProvider) на локальном baseUrl.
	 */
	inlineCompletionEnabled: boolean;
	/** 
	 * Маскировать вероятные секреты в карточках инструментов и статусе UI.
	 */
	privacyMode: boolean;
	/** 
	 * Запрещать нелокальные URL для web_search/fetch_page/design_inspect/design_screenshot/browser_action.
	 */
	blockNonLocalUrls: boolean;
	/**
	 * Доп. system prompt для чата/агента (поверх правил проекта)
	 */
	systemPrompt: string;
	/**
	 * Температура
	 *
	 * минимум - 0,
	 * максимум - 2,
	 *
	 * по умолчанию - 0.2
	 *
	 * лучше держать низкой для стабильного формата
	 */
	temperature: number;
	/**
	 * Максимум токенов в ответе модели
	 *
	 * минимум - 64
	 *
	 * по умолчанию - 8192
	 */
	maxTokens: number;
	/**
	 * Оценка окна контекста (токены) для UI / budget; сверка с n_ctx сервера при overflow.
	 * по умолчанию - 128000
	 */
	maxContextTokens: number;
	/**
	 * Что делать при exceed_context_size / preflight overflow:
	 * auto_compact_retry - ужать/повторить; ask - понятная ошибка; fail_fast - сразу ошибка.
	 * по умолчанию - auto_compact_retry
	 */
	contextOverflowPolicy: ContextOverflowPolicy;
	/**
	 * Таймаут HTTP-запроса в миллисекундах
	 *
	 * минимум - 1000
	 *
	 * по умолчанию - 120000
	 */
	requestTimeoutMs: number;
	/**
	 * Таймаут tool/shell по умолчанию (мс), если в args нет timeout_ms
	 * по умолчанию - 60000
	 */
	defaultToolTimeoutMs: number;
	/**
	 * Верхняя граница таймаута tool/shell (мс).
	 * по умолчанию - 300000
	 */
	maxToolTimeoutMs: number;
	/**
	 * Максимальное количество символов на входе
	 *
	 * минимум - 500
	 *
	 * по умолчанию - 8000
	 */
	maxInputChars: number;
	/**
	 * Стиль комментариев
	 *
	 * inline - короткие строковые комментарии
	 * block - короткие блочные комментарии
	 */
	commentStyle: CommentStyle;
	previewBeforeApply: boolean;
	/**
	 * Дополнительные инструкции к system prompt для комментариев
	 * Пусто - только стандартный prompt
	 */
	commentSystemPrompt: string;
	/**
	 * Glob’ы чувствительных путей: запись/удаление всегда ask (или deny по политике),
	 * даже при autoApprove/session-allow. По умолчанию: `.env`, `.env.*`.
	 * Только user/project JSON, не Settings UI.
	 * Игнор путей/папок - `.genignore`, не этот ключ.
	 */
	sensitivePathPatterns: string[];
	/**
	 * Разрешить пути вне workspace folders (external_directory).
	 * false (по умолчанию) - deny; true - разрешение пути и действие подтверждения `outside`.
	 */
	allowExternalDirectory: boolean;
	/**
	 * Имена бинарников, запрещённых для run_command (по одному на строку).
	 * Пусто - не запрещать по имени (eval / git write / package install остаются в коде).
	 * Только user/project JSON, не Settings UI.
	 */
	deniedCommands: string[];
	/**
	 * JS-регулярки для маскировки секретов в тексте, уходящем в LLM.
	 * Пусто - не маскировать.
	 * Только user/project JSON, не Settings UI.
	 */
	secretPatterns: string[];
	/**
	 * Имя HTTP-заголовка с ключом.
	 * Пусто - Authorization.
	 */
	authHeader: string;
	/**
	 * Схема значения (Bearer).
	 * Пусто - сырой ключ без префикса.
	 */
	authScheme: string;
	/**
	 * Писать план агента в `.gen/plan.md` в workspace.
	 * Выключено - план только в памяти сессии.
	 */
	planWriteToFile: boolean;
	/**
	 * Shell в Plan: `ask` (по умолчанию) - команды только с подтверждением; `deny` - shell недоступен.
	 * Не влияет на Debug/Design/Multitask; правки в Plan всегда запрещены.
	 */
	planShellPolicy: PlanShellPolicy;
	/**
	 * Снимки файлов для /undo (checkpoint + undo stack).
	 * Выключено - remember no-op, стек undo не пополняется.
	 */
	snapshotEnabled: boolean;
	/**
	 * Писать логи в Output и в файлы.
	 * По умолчанию выключено.
	 */
	loggingEnabled: boolean;
	/**
	 * Максимум символов в ответе одного tool (обрезка хвоста) - UI/хранение.
	 */
	toolOutputMaxChars: number;
	/**
	 * Макс. символов tool output в model path при shrink/prune (отдельно от UI card).
	 * по умолчанию - 2000
	 */
	toolOutputModelMaxChars: number;
	/**
	 * Лимит вложенности tool `task` (субагенты).
	 * минимум - 1, максимум - 4, по умолчанию - 2
	 */
	subagentDepth: number;
	/**
	 * Git worktrees для субагентов (`task`): по умолчанию создавать worktree под `.gen/worktrees/`.
	 * Переопределяется аргументом `use_worktree` у tool `task`.
	 * по умолчанию - false
	 */
	worktreesEnabled: boolean;
	/**
	 * Команда (shell `-c`), один раз после `git worktree add` в cwd worktree.
	 * Пусто - не запускать. Пример: `npm install` / `yarn`.
	 */
	worktreeStartCommand: string;
	/**
	 * Доп. каталоги skills (относительно workspace или абсолютные).
	 * Базовые: `.gen/skills`, `.agents/skills`.
	 */
	skillsPaths: string[];
	/**
	 * HTTPS URL на удалённые SKILL.md (имя из basename URL).
	 */
	skillsUrls: string[];
	/**
	 * HTTPS URL с инструкциями - текст добавляется к правилам проекта.
	 */
	instructionUrls: string[];
	/**
	 * Доверенные npm plugins: точные package@version, опционально `#sha256=<bin digest>`.
	 * `.gen/npm-plugins.json` - проектный список разрешённых пакетов в том же формате.
	 */
	trustedPlugins: string[];
	/**
	 * Id персоны из `.gen/personas/*.md` (пусто - без персоны).
	 */
	personaId: string;
	/**
	 * После успешного write_file / apply_patch форматировать документ (editor.action.formatDocument).
	 * По умолчанию выключено.
	 */
	formatAfterEdit: boolean;
	/**
	 * После успешной правки: вшить diagnostics / related tests в tool result.
	 * off | diagnostics (default) | diagnostics_tests | full (tests auto-run при shell allow)
	 */
	verifyAfterEdit: VerifyAfterEdit;
	/**
	 * Если true - attempt_completion отказывается при красных diagnostics после правок в этом turn.
	 */
	verifyGateCompletion: boolean;
	/**
	 * Auto-Keep через git-sync: если pending-файл clean в git (нет изменений по path) - принять pending-хунки.
	 * По умолчанию выключено.
	 */
	gitSyncAutoKeep: boolean;
	/**
	 * Включить semantic_search / embeddings / автоиндексацию.
	 */
	indexingEnabled: boolean;
	/**
	 * Автоиндексировать новые workspace folders при открытии.
	 * по умолчанию - true
	 */
	indexNewFolders: boolean;
	/**
	 * Разрешить codebase_search / semantic_search по индексу.
	 * grep / glob работают независимо.
	 * по умолчанию - true
	 */
	indexForGrep: boolean;
	/**
	 * Base URL для OpenAI-compatible POST /embeddings (пусто - как baseUrl).
	 */
	embeddingsBaseUrl: string;
	/**
	 * Модель эмбеддингов.
	 */
	embeddingsModel: string;
	/**
	 * Локальный offline semantic path:
	 * - off: только удалённый embeddings
	 * - trigram: при недоступном удалённом - IndexManager trigram (по умолчанию)
	 * - vector: плотный feature-hash индекс (vectors.json) + удалённый -> локальный -> trigram
	 */
	localEmbeddingsMode: 'off' | 'trigram' | 'vector';
	/**
	 * Движок outline: auto (Tree-sitter если есть, иначе LSP/TS) | treesitter | lsp | typescript
	 */
	outlineEngine: OutlineEngine;
	/**
	 * Движок нарезки чанков: auto (AST Tree-sitter если есть) | treesitter | lines
	 */
	chunkEngine: ChunkEngine;
	/**
	 * Языки Tree-sitter: пусто = полный набор (default langs); `*` / `all` = все доступные wasm;
	 * иначе список id (typescript, dart, kotlin, swift, css, html, ...). Без c_sharp/ruby/scala.
	 */
	treeSitterLanguages: string[];
	/**
	 * Разбирать Tree-sitter в worker_threads (при сбое - резервный разбор в текущем процессе).
	 * по умолчанию - false
	 */
	treeSitterUseWorker: boolean;
	/**
	 * Пропуск каталогов только при явном content-hash (без size+mtime gate).
	 * по умолчанию - false
	 */
	indexForceContentHash: boolean;
	/**
	 * Бэкенд индекса: json (по умолчанию) или sqlite sidecar для merkle в больших репозиториях.
	 */
	indexStorageBackend: 'json' | 'sqlite';
	/**
	 * Порог fileCount для записи merkle в SQLite (при backend=sqlite).
	 * по умолчанию - 500
	 */
	indexSqliteMinFiles: number;
	/**
	 * Сколько последних ходов оставлять при /compact.
	 * минимум - 1, максимум - 40, по умолчанию - 4
	 */
	compactTailTurns: number;
	/**
	 * При compact агрессивно ужимать tool-результаты и args в старых ходах.
	 * по умолчанию - true
	 */
	compactPruneToolResults: boolean;
	/**
	 * Свободный резерв контекста после сжатия. Это не целевой размер сводки.
	 * по умолчанию - 0
	 */
	compactReservedTokens: number;
	/**
	 * Мягкая пауза mid-loop (soft-stall): при near-budget один раз сжать apiMessages перед shrink (rule-based, без LLM).
	 * по умолчанию - true
	 */
	midLoopAutoCompact: boolean;
	/**
	 * LLM auto-compact перед turn, если после rule-based path всё ещё over budget.
	 * по умолчанию - false (ручной /compact всегда доступен)
	 */
	llmAutoCompact: boolean;
	/**
	 * Передавать картинки в chat completions как image_url (OpenAI-compatible multimodal).
	 * По умолчанию выключено: в сообщение попадает только `[image path]`.
	 */
	visionEnabled: boolean;
	/**
	 * Максимум длины base64 одной картинки в запросе к модели (символы).
	 * по умолчанию - 400000
	 */
	attachmentImageMaxBase64: number;
	/**
	 * Макс. ширина картинки перед отправкой (webview resize при ImageBitmap).
	 * по умолчанию - 2048
	 */
	attachmentImageMaxWidth: number;
	/**
	 * Макс. высота картинки перед отправкой (webview resize при ImageBitmap).
	 * по умолчанию - 2048
	 */
	attachmentImageMaxHeight: number;
	/**
	 * Уменьшать картинки в Composer (createImageBitmap + canvas), если превышают max W/H.
	 * Host по-прежнему режет по attachmentImageMaxBase64.
	 * по умолчанию - true
	 */
	attachmentImageAutoResize: boolean;
	/** 
	 * Предустановка качества и размера кодирования изображений на стороне хоста.
	 */
	attachmentImageQuality: ImageQualityPreset;
	/** 
	 * Страницы PDF для vision; жёсткий предел - 6.
	 */
	pdfVisionMaxPages: number;
	/**
	 * Показ reasoning/thinking в чате: скрыть / свёрнуто / развёрнуто.
	 * по умолчанию - 'collapsed'
	 */
	thinkingDisplay: ThinkingDisplay;
	/**
	 * Подробности tool-вызовов в чате (аргументы/результат).
	 * true - подробно, false - кратко. по умолчанию - true
	 */
	toolDetailsExpanded: boolean;
	/**
	 * Максимум открытых чат-сессий (вкладок).
	 * минимум - 1, максимум - 40, по умолчанию - 10
	 */
	maxTabCount: number;
	/**
	 * Максимум одновременных agent/ask runs по всем вкладкам.
	 * минимум - 1, максимум - 10, по умолчанию - 3
	 */
	maxConcurrentRuns: number;
	/**
	 * Что делать при new/fork/handoff, если вкладок уже maxTabCount.
	 * block - предупреждение; closeOldestIdle - закрыть самые старые idle (не current, не busy).
	 * по умолчанию - closeOldestIdle
	 */
	tabEvictionPolicy: TabEvictionPolicy;
}

// Шаблоны для seed `.genignore` при init проекта
export const DEFAULT_GENIGNORE_PATTERNS: string[] = ['.env','.env.*','credentials.json','secrets.json','id_rsa','id_ed25519','id_ecdsa','.npmrc','.pypirc','.netrc','*.pem','*.key','*.p12','*.pfx','node_modules','.git',];

// Стандартные sensitivePathPatterns: правки `.env*` -> запрос или запрет (отдельно от .genignore)
export const DEFAULT_SENSITIVE_PATH_PATTERNS: string[] = ['.env', '.env.*'];

export const EXAMPLE_DENIED_COMMANDS: string[] = ['sudo', 'doas', 'su', 'rm', 'rmdir', 'unlink', 'dd', 'mkfs', 'fdisk', 'chmod', 'chown', 'chgrp', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'docker', 'podman', 'kubectl', 'nerdctl', 'sh', 'bash', 'zsh', 'fish', 'dash', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh',];

export const EXAMPLE_SECRET_PATTERNS: string[] = [
	String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
	String.raw`\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}`,
	String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
	String.raw`\bBearer\s+[A-Za-z0-9\-._~+/]+=*`,
];

export const DEFAULT_SETTINGS: GenSettings = {
	baseUrl: '',
	model: '',
	smallModel: '',
	planModel: '',
	actModel: '',
	chatMode: 'ask',
	approvalPolicy: structuredClone(DEFAULT_APPROVAL_POLICY),
	autoApprove: false,
	persistAlwaysAllow: false,
	continueLoopOnDeny: true,
	enableWorkspaceContext: true,
	alwaysOnWorkspaceContext: false,
	shareMode: 'manual',
	primaryTools: [],
	modelRoutedPatch: true,
	watcherIgnore: [],
	revealOnEdit: 'never',
	backgroundEditMode: true,
	notifyOnComplete: false,
	notifySoundOnComplete: false,
	enableFileReading: true,
	enableTerminal: true,
	webSearchEnabled: true,
	webSearchBackend: 'duckduckgo',
	webSearchHttpUrl: '',
	webSearchHttpHeader: 'Authorization',
	webFetchEnabled: true,
	designScreenshotEnabled: false,
	browserComputerUseEnabled: false,
	browserViewportWidth: 1280,
	browserViewportHeight: 720,
	browserCdpEndpoint: '',
	browserChromePath: '',
	inlineCompletionEnabled: false,
	privacyMode: false,
	blockNonLocalUrls: false,
	systemPrompt: '',
	temperature: 0.2,
	maxTokens: 8192,
	maxContextTokens: 128_000,
	contextOverflowPolicy: 'auto_compact_retry',
	requestTimeoutMs: 120_000,
	defaultToolTimeoutMs: 60_000,
	maxToolTimeoutMs: 300_000,
	maxInputChars: 8000,
	commentStyle: 'inline',
	previewBeforeApply: true,
	commentSystemPrompt: '',
	sensitivePathPatterns: [...DEFAULT_SENSITIVE_PATH_PATTERNS],
	allowExternalDirectory: false,
	deniedCommands: [...EXAMPLE_DENIED_COMMANDS],
	secretPatterns: [],
	authHeader: 'Authorization',
	authScheme: 'Bearer',
	planWriteToFile: true,
	planShellPolicy: 'ask',
	snapshotEnabled: true,
	loggingEnabled: false,
	toolOutputMaxChars: 12_000,
	toolOutputModelMaxChars: 2_000,
	subagentDepth: 2,
	worktreesEnabled: false,
	worktreeStartCommand: '',
	skillsPaths: [],
	skillsUrls: [],
	instructionUrls: [],
	trustedPlugins: [],
	personaId: '',
	formatAfterEdit: false,
	verifyAfterEdit: 'diagnostics',
	verifyGateCompletion: false,
	gitSyncAutoKeep: false,
	indexingEnabled: true,
	indexNewFolders: true,
	indexForGrep: true,
	embeddingsBaseUrl: '',
	embeddingsModel: 'text-embedding-3-small',
	localEmbeddingsMode: 'trigram',
	outlineEngine: 'auto',
	chunkEngine: 'auto',
	treeSitterLanguages: [],
	treeSitterUseWorker: false,
	indexForceContentHash: false,
	indexStorageBackend: 'json',
	indexSqliteMinFiles: 500,
	compactTailTurns: 4,
	compactPruneToolResults: true,
	compactReservedTokens: 0,
	midLoopAutoCompact: true,
	llmAutoCompact: false,
	visionEnabled: false,
	attachmentImageMaxBase64: 400_000,
	attachmentImageMaxWidth: 2048,
	attachmentImageMaxHeight: 2048,
	attachmentImageAutoResize: true,
	attachmentImageQuality: 'medium',
	pdfVisionMaxPages: 3,
	thinkingDisplay: 'collapsed',
	toolDetailsExpanded: true,
	maxTabCount: 10,
	maxConcurrentRuns: 3,
	tabEvictionPolicy: 'closeOldestIdle',
};
