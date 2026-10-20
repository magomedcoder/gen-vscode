import type { ChatMode, ChatTextSize, GenSettings } from '../../core/config/types';
import type { TokenUsage } from '../../core/llm/usage';
import type { ConfirmChoice } from '../agent/types';
import type { DiffHunkPayload, HunkReviewStatus } from '../agent/diff';
import type { ActivityEntry } from '../../core/stores/activityStore';
import type { ModelUsage } from '../../core/stores/usageStore';
import type { IndexEngineStatus } from '../index/engineStatus';
import type { SessionSummary } from './sessionStore';
import type { DesignClickResult } from '../design/designVisual';

export type { ActivityEntry } from '../../core/stores/activityStore';
export type { DesignClickResult };
export type { IndexEngineStatus } from '../index/engineStatus';
export type { ChatMode, ConfirmChoice, DiffHunkPayload, HunkReviewStatus };
export type ChatRole = 'user' | 'assistant' | 'error' | 'tool';
export type PanelScreen = 'chat' | 'settings';
export type ToolCallStatus = 'pending' | 'awaiting_confirm' | 'ok' | 'error' | 'denied';
export type ConfirmVariant = 'agent' | 'binary';

/**
 * Design Mode visual click-to-code: см. `features/design/designVisual.ts`.
 * Design bridge разрешает URL и селектор через поиск подсказки на исходник в `design_inspect`.
 */

// Снимок admin policy для UI настроек (баннер заблокированных ключей)
export interface AdminPolicyInfo {
	active: boolean;
	path?: string;
	lockedKeys: string[];
}

// Последний Design click (workspaceState) для Settings / status UI
export interface DesignSessionPayload {
	path?: string;
	line?: number;
	url?: string;
	selector?: string;
	updatedAt?: number;
}

export interface ToolCallUi {
	id: string;
	name: string;
	arguments: string;
	status: ToolCallStatus;
	result?: string;
	path?: string;
	diff?: string;
	hunks?: DiffHunkPayload[];
	// Время в мс - когда инструмент перешёл в ожидание (для обратного отсчёта)
	startedAt?: number;
	// Таймаут tool в мс (например timeout_ms у run_command)
	timeoutMs?: number;
	// Рабочий каталог shell (из вывода `cwd:`)
	cwd?: string;
	// Код выхода shell (из вывода `exit:`)
	exitCode?: number;
}

export interface AgentPausedState {
	reason: 'max_steps';
	iterations: number;
}

export interface ChatUiMessage {
	id: string;
	role: ChatRole;
	content: string;
	// Рассуждения модели (только если API действительно их вернул)
	thinking?: string;
	toolCalls?: ToolCallUi[];
	toolCallId?: string;
	toolName?: string;
	toolArgs?: string;
	toolStatus?: ToolCallStatus;
	usage?: TokenUsage;
	// Картинки, сохранённые в `.gen/attachments/`
	attachments?: Array<{ path: string; mimeType: string }>;
}

export interface PendingConfirm {
	id: string;
	title: string;
	detail?: string;
	hint?: string;
	variant: ConfirmVariant;
	applyLabel: string;
	skipLabel: string;
	stopLabel: string;
	rejectLabel: string;
	alwaysLabel?: string;
	suggestion?: string;
	allowAlways?: boolean;
	// Кнопка «Разрешить остальные правки» при очереди правок в ходе
	allowRemaining?: boolean;
	allowRemainingLabel?: string;
	remainingEdits?: number;
}

// Вопрос агента mid-run (ask_question)
export interface PendingQuestion {
	id: string;
	title: string;
	prompt: string;
	options?: string[];
}

export interface ChatTodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// Статус research/subagent job для UI Teams
export type ResearchJobStatus = 'running' | 'done' | 'error' | 'aborted' | 'queued';

// Карточка research job в состоянии чата (хост заполняет, webview только отображает и отправляет прерывание)
export interface ResearchJobUi {
	id: string;
	status: ResearchJobStatus;
	subagent: string;
	promptPreview: string;
	// Полный prompt для возобновления (показывать в UI необязательно)
	prompt?: string;
	detail?: string;
	parentSessionId?: string;
	childSessionId?: string;
	worktreePath?: string;
	background?: boolean;
	mutating?: boolean;
	startedAt?: number;
	finishedAt?: number;
	reportSnippet?: string;
}

// Файлы, изменённые успешными инструментами мутации за один запуск агента
export interface SessionDiffEvent {
	turnId: string;
	paths: string[];
	// Epoch ms - когда ход завершился
	at: number;
}

export interface ChatProjectStatus {
	hasWorkspace: boolean;
	enabled: boolean;
	indexing: boolean;
	ready: boolean;
	error?: string;
	fileCount?: number;
	chunkCount?: number;
}

export interface ChatViewState {
	messages: ChatUiMessage[];
	busy: boolean;
	// Детали busy-состояния (например статус HTTP-retry)
	busyDetail?: string;
	// Сообщения в очереди, пока идёт текущий turn
	queuedCount: number;
	mode: ChatMode;
	usage?: TokenUsage;
	// Лимит контекста для context ring
	maxContextTokens?: number;
	// Оценка токенов prompt: usage.promptTokens сервера, иначе посимвольная оценка
	estimatedPromptTokens?: number;
	// Эффективный бюджет prompt после n_ctx и резервов
	contextBudget?: number;
	// Закэшированный n_ctx сервера (если probe/overflow уже знал)
	cachedNCtx?: number;
	// Около 80% бюджета - мягкое предупреждение
	nearBudget?: boolean;
	// предупреждение, если maxContextTokens > cachedNCtx
	nCtxWarn?: boolean;
	contextBreakdown?: {
		history: number;
		mentions: number;
		system: number;
		user: number;
	};
	mentionsTruncated?: boolean;
	mentionsTruncatedKinds?: string[];
	// Последнее сокращение контекста (отладка)
	lastContextPrune?: { 
		chars: number; 
		messages: number 
	};
	sessionId?: string;
	sessions?: SessionSummary[];
	pendingConfirm?: PendingConfirm;
	pendingQuestion?: PendingQuestion;
	todos?: ChatTodoItem[];
	project?: ChatProjectStatus;
	// Пользовательские slash-команды из `.gen/commands` для автодополнения Composer
	customSlashCommands?: Array<{
		id: string;
		name: string;
		detail?: string;
		mode?: ChatMode;
		needsArgs?: boolean;
		argsHint?: string;
		minPositionalArgs?: number;
	}>;
	// Мягкая пауза агента (лимит итераций) - Continue / Stop в UI
	agentPaused?: AgentPausedState;
	// Id выполняемого инструмента (для отдельной остановки)
	activeToolCallId?: string;
	// Размер текста чата из настроек (для CSS-класса .app)
	chatTextSize?: ChatTextSize;
	// План подтверждён в mode=plan - баннер «Run in Agent»
	planHandoff?: { title?: string };
	// Текущая модель сессии из getSettings().model
	model?: string;
	// Diff последнего agent-хода (уникальные пути)
	lastTurnDiff?: SessionDiffEvent;
	// Черновик Composer для текущей сессии (сохраняется по sessionId)
	composerDraft?: string;
	// Chips Composer (insert-строки mention) для текущей сессии
	composerChips?: string[];
	// Активные research/subagent jobs (UI Teams)
	researchJobs?: ResearchJobUi[];
	// Есть полный архив до сжатия (память/диск) - баннер восстановления
	hasExportArchive?: boolean;
}

export type ToWebviewMessage = | { type: 'state'; state: ChatViewState }
	| { type: 'settings'; settings: GenSettings; apiKeySet: boolean; webSearchApiKeySet?: boolean; embeddingsApiKeySet?: boolean; persistedAlwaysAllow?: string[]; personas?: PersonaOption[]; adminPolicy?: AdminPolicyInfo }
	| { type: 'settingsSaved'; settings: GenSettings; apiKeySet: boolean; webSearchApiKeySet?: boolean; embeddingsApiKeySet?: boolean; persistedAlwaysAllow?: string[]; personas?: PersonaOption[]; adminPolicy?: AdminPolicyInfo }
	| { type: 'secretFilePicked'; requestId: number; value?: string }
	| { type: 'settingsError'; message: string }
	| { type: 'models'; models: Array<{ id: string; label: string }>; requestId: number }
	| { type: 'modelsError'; message: string; requestId: number }
	| { type: 'connectionHealth'; ok: boolean; modelCount: number; message: string; requestId: number }
	| { type: 'mentionSuggestions'; requestId: number; items: MentionSuggestion[] }
	| { type: 'usageLedger'; ledger: Record<string, ModelUsage> }
	| { type: 'activityLedger'; entries: ActivityEntry[] }
	| { type: 'indexStatus'; status: IndexEngineStatus }
	| { type: 'hooksData'; beforeSubmit: string[]; beforeShell: string[]; sessionDiff: string[]; sessionCompacting: string[]; shellEnv: string[]; fileWatcher: string[]; path?: string; error?: string; }
	| { type: 'hooksSaved'; ok: boolean; error?: string }
	| { type: 'hookDryRunResult'; event: string; ok: boolean; exitCode?: number; stdout?: string; stderr?: string; error?: string }
	// Встроенные пресеты и пользовательские агенты из `.gen/agents/`
	| { type: 'agentsData'; presets: AgentPresetInfo[]; custom: AgentCustomInfo[]; error?: string }
	| { type: 'agentsCloned'; relativePath: string; created: boolean; error?: string }
	// Кандидаты правил и обнаруженные skills/plugins (UI только для чтения)
	| { type: 'rulesSkillsData'; rules: Array<{ label: string; path: string; exists: boolean }>; skills: Array<{ name: string; description: string; path: string }>; plugins: Array<{ kind: 'tool' | 'plugin' | 'npm'; name: string; description: string; path: string }>; ruleConflicts: Array<{ heading: string; sources: string[] }>; }
	// Список персон (builtin + `.gen/personas/*.md`) для Settings * Personas
	| { type: 'personasData'; personas: PersonaOption[] }
	// Короткий beep в chat webview (завершение хода)
	| { type: 'playNotifySound' }
	| { type: 'designSession'; session: DesignSessionPayload | null }
	| { type: 'designClickResult'; result: DesignClickResult };

export interface AgentPresetInfo {
	id: string;
	name: string;
	description: string;
	readonly: boolean;
	mode?: string;
}

export interface AgentCustomInfo {
	id: string;
	name: string;
	description: string;
	readonly: boolean;
}

export interface PersonaOption {
	id: string;
	name: string;
	description: string;
	// Путь к `.md` относительно workspace (пусто у встроенных)
	path?: string;
	// Источник: встроенный пресет или `.gen/personas/*.md`
	source?: 'builtin' | 'custom';
}

export interface MentionSuggestion {
	kind: 'file' | 'folder' | 'codebase' | 'code' | 'git' | 'git_changes' | 'branch_diff' | 'problems' | 'rules' | 'link' | 'docs' | 'agent' | 'terminals' | 'past' | 'alias' | 'ref' | 'map' | 'symbols';
	label: string;
	insert: string;
	detail?: string;
}

export interface IncomingImagePayload {
	name: string;
	mimeType: string;
	base64: string;
}

export type FromWebviewMessage = | { type: 'ready' }
	| { type: 'gen.design.click'; url: string; selector: string; snippet?: string; sourceHint?: string; x?: number; y?: number }
	| { type: 'send'; text: string; images?: IncomingImagePayload[] }
	| { type: 'cancel' }
	| { type: 'clear' }
	| { type: 'setChatMode'; mode: ChatMode }
	| { type: 'setModel'; model: string }
	| { type: 'openExternal'; url: string }
	| { type: 'openSettings' }
	| { type: 'saveSettings'; settings: GenSettings; apiKey?: string; clearApiKey?: boolean; webSearchApiKey?: string; clearWebSearchApiKey?: boolean; embeddingsApiKey?: string; clearEmbeddingsApiKey?: boolean; persistedAlwaysAllow?: string[] }
	| { type: 'pickSecretFile'; requestId: number }
	| { type: 'loadModels'; baseUrl: string; requestId: number }
	| { type: 'checkConnection'; baseUrl: string; requestId: number }
	| { type: 'openLogsFolder' }
	| { type: 'confirmChoice'; id: string; choice: ConfirmChoice }
	| { type: 'answerQuestion'; id: string; answer: string }
	| { type: 'mentionSuggest'; requestId: number; query: string }
	| { type: 'retryIndex' }
	| { type: 'editMessage'; id: string; content: string; revertFiles?: boolean }
	| { type: 'reviewHunk'; toolCallId: string; hunkId: string; action: 'accept' | 'reject' }
	| { type: 'reviewDiff'; toolCallId: string; action: 'acceptAll' | 'rejectAll' }
	// Принять или отклонить все ожидающие хунки одного файла (панель сессии)
	| { type: 'reviewPendingPath'; path: string; action: 'accept' | 'reject' }
	| { type: 'newSession' }
	| { type: 'switchSession'; id: string }
	| { type: 'renameSession'; id: string; title: string }
	| { type: 'archiveSession'; id: string; archived?: boolean }
	| { type: 'setSessionFilter'; query?: string; archived?: boolean }
	| { type: 'deleteSession'; id: string }
	| { type: 'forkSession'; messageId: string }
	// Черновик Composer (задержка в webview); chips - строки вставки
	| { type: 'setComposerDraft'; text: string; chips?: string[]; sessionId?: string }
	| { type: 'loadUsage' }
	| { type: 'resetUsage' }
	| { type: 'loadActivity' }
	| { type: 'clearActivity' }
	| { type: 'loadIndexStatus' }
	| { type: 'loadDesignSession' }
	| { type: 'cancelIndex' }
	| { type: 'repairIndex' }
	| { type: 'loadHooks' }
	| { type: 'saveHooks'; beforeSubmit: string[]; beforeShell: string[]; sessionDiff: string[]; sessionCompacting: string[]; shellEnv: string[]; fileWatcher: string[]; }
	| { type: 'openHooksFile' }
	| { type: 'dryRunHook'; event: 'beforeSubmit' | 'beforeShell' | 'session.diff' | 'session.compacting' | 'shell.env' | 'file.watcher'; sample?: string }
	| { type: 'loadAgents' }
	| { type: 'cloneAgentPreset'; id: string }
	| { type: 'loadRulesSkills' }
	// Пересканировать персоны (builtin + `.gen/personas/*.md`)
	| { type: 'loadPersonas' }
	// Открыть путь проекта / абсолютный файл в редакторе (или http(s) во внешнем браузере)
	| { type: 'openProjectPath'; path: string }
	| { type: 'continueAgent' }
	| { type: 'stopAgentPause' }
	| { type: 'cancelToolCall'; id: string }
	| { type: 'dismissPlanHandoff' }
	| { type: 'dismissTurnDiff' }
	| { type: 'openPath'; path: string }
	// Исследования / Teams
	| { type: 'interruptResearchJob'; id?: string; jobId?: string }
	| { type: 'interruptAllResearch' }
	| { type: 'resumeResearchJob'; id?: string; jobId?: string }
	| { type: 'openChildSession'; sessionId: string }
	| { type: 'attachResearchTranscript'; id?: string; jobId?: string }
	| { type: 'cleanupWorktree'; path: string }
	| { type: 'removeWorktree'; path: string }
	| { type: 'cleanupAllFinishedWorktrees' }
	| { type: 'openProjectReport'; path: string }
	/** Восстановить полную историю из exportArchive после compact */
	| { type: 'restoreExportArchive' };
