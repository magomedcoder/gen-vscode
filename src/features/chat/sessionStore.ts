import * as vscode from 'vscode';
import type { Memento } from 'vscode';
import type { ChatUiMessage, ToolCallUi } from './protocol';

// Индекс метаданных + отдельный ключ с сообщениями на сессию (dirty-only rewrite)
const SESSION_INDEX_KEY = 'gen.chat.sessionIndex';
const SESSION_MSGS_PREFIX = 'gen.chat.session.msgs.';
const CURRENT_ID_KEY = 'gen.chat.currentSessionId';
// Черновики Composer: sessionId * текст
const DRAFTS_KEY = 'gen.chat.drafts';
// Chips Composer: sessionId * insert-строки
const DRAFT_CHIPS_KEY = 'gen.chat.draftChips';

const MAX_SESSIONS = 40;
const MAX_STORED_MESSAGES = 80;
// Cap tool.result в persist (полный текст остаётся в памяти / export archive)
export const MAX_STORED_TOOL_RESULT_CHARS = 4000;
const TOOL_RESULT_TRUNCATED_MARKER = '\n...[truncated for storage]';
// Debounce batch-записи messages при частых saveMessages (стрим / tool append)
const PERSIST_DEBOUNCE_MS = 800;

export interface StoredChatSession {
	id: string;
	title: string;
	messages: ChatUiMessage[];
	createdAt: number;
	updatedAt: number;
	// Родитель <-> потомок: вкладка субагента / передача
	parentSessionId?: string;
	childSessionIds?: string[];
}

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	// Сейчас в этой вкладке идёт ход agent/ask (индикатор UI)
	busy?: boolean;
	// Родительская сессия (если эта вкладка - дочерняя для субагента)
	parentSessionId?: string;
	// Дочерние сессии, порождённые из этой вкладки
	childSessionIds?: string[];
	// Явный флаг дочерней сессии (дублирует parentSessionId для UI)
	isChild?: boolean;
}

function newId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Сравнение для сортировки списка: switch без правок не должен bump'ать updatedAt
function messagesActivityEqual(a: ChatUiMessage[], b: ChatUiMessage[]): boolean {
	if (a.length !== b.length) {
		return false;
	}

	for (let i = 0; i < a.length; i += 1) {
		const left = a[i]!;
		const right = b[i]!;
		if (left.id !== right.id || left.role !== right.role || left.content !== right.content || (left.thinking ?? '') !== (right.thinking ?? '')) {
			return false;
		}

		const leftTools = left.toolCalls ?? [];
		const rightTools = right.toolCalls ?? [];
		if (leftTools.length !== rightTools.length) {
			return false;
		}

		for (let j = 0; j < leftTools.length; j += 1) {
			const lt = leftTools[j]!;
			const rt = rightTools[j]!;
			if (lt.id !== rt.id || lt.status !== rt.status || lt.name !== rt.name) {
				return false;
			}
		}
	}

	return true;
}

export function capToolResult(result: string): string {
	if (result.length <= MAX_STORED_TOOL_RESULT_CHARS || result.endsWith(TOOL_RESULT_TRUNCATED_MARKER)) {
		return result;
	}

	return result.slice(0, MAX_STORED_TOOL_RESULT_CHARS) + TOOL_RESULT_TRUNCATED_MARKER;
}

function slimToolCall(call: ToolCallUi): ToolCallUi {
	const resultTooBig = typeof call.result === 'string'
		&& call.result.length > MAX_STORED_TOOL_RESULT_CHARS
		&& !call.result.endsWith(TOOL_RESULT_TRUNCATED_MARKER);
	if (!call.hunks?.length && !resultTooBig) {
		return call;
	}

	return {
		...call,
		...(resultTooBig ? { result: capToolResult(call.result!) } : {}),
		...(call.hunks?.length
			? {
				hunks: call.hunks.map((hunk) => {
					const {
						oldLines: _o,
						newLines: _n,
						beforeContext: _b,
						afterContext: _a,
						...rest
					} = hunk;
					return {
						...rest,
						// Миграция: старые pending -> accepted (post-apply review убран)
						status: hunk.status === 'pending' ? 'accepted' : hunk.status,
						oldLines: [],
						newLines: [],
					};
				}),
			}
			: {}),
	};
}

export function slimMessages(messages: ChatUiMessage[]): ChatUiMessage[] {
	return messages.slice(-MAX_STORED_MESSAGES).map((msg) => {
		if (!msg.toolCalls?.length) {
			return msg;
		}

		return {
			...msg,
			toolCalls: msg.toolCalls.map(slimToolCall),
		};
	});
}

function toSummary(session: StoredChatSession): SessionSummary {
	return {
		id: session.id,
		title: session.title,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messageCount: session.messages.length,
		parentSessionId: session.parentSessionId,
		childSessionIds: session.childSessionIds?.length
			? [...session.childSessionIds]
			: undefined,
		isChild: Boolean(session.parentSessionId),
	};
}

// Сессия «начата» - пользователь уже что-то отправил в чат
export function sessionHasUserMessage(session: StoredChatSession): boolean {
	return session.messages.some((m) => m.role === 'user' && m.content.trim().length > 0);
}

export function defaultSessionTitle(): string {
	return vscode.l10n.t('chat.session.defaultTitle');
}

export function isDefaultSessionTitle(title: string | undefined): boolean {
	if (!title?.trim()) {
		return true;
	}

	return title.trim() === defaultSessionTitle();
}

function defaultTitle(): string {
	return defaultSessionTitle();
}

// Живой SessionStore для @past (mentions без ExtensionContext)
let sessionPeek: SessionStore | undefined;

export function setSessionPeek(store: SessionStore | undefined): void {
	sessionPeek = store;
}

export function getSessionPeek(): SessionStore | undefined {
	return sessionPeek;
}

// Сохранение нескольких чат-сессий в workspaceState (или переданный Memento)
export class SessionStore {
	private sessions: StoredChatSession[] = [];
	private currentId = '';
	// Dirty-tracking: пишем в memento только изменившиеся сессии
	private readonly dirty = new Set<string>();
	// Сессии, чьи msgs-ключи нужно удалить (delete / cap / orphan)
	private readonly removed = new Set<string>();
	private indexDirty = false;
	private currentDirty = false;
	private writtenCurrentId = '';
	private persistTimer: ReturnType<typeof setTimeout> | undefined;
	// Черновики Composer в памяти + workspaceState
	private drafts: Record<string, string> = {};
	private draftChips: Record<string, string[]> = {};

	constructor(private readonly memento: Memento) {
		this.load();
	}

	private static normalizeStored(s: Partial<StoredChatSession> & { id: string }, messages: unknown): StoredChatSession {
		return {
			id: s.id,
			title: String(s.title || defaultTitle()).slice(0, 120),
			// slim при загрузке: чистим старые memento от больших tool.result
			messages: Array.isArray(messages) ? slimMessages(messages as ChatUiMessage[]) : [],
			createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
			updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
			parentSessionId: s.parentSessionId,
			childSessionIds: Array.isArray(s.childSessionIds) ? s.childSessionIds : undefined,
		};
	}

	private load(): void {
		const index = this.memento.get<Array<Partial<StoredChatSession> & { id: string }>>(SESSION_INDEX_KEY);
		const current = this.memento.get<string>(CURRENT_ID_KEY, '');
		this.writtenCurrentId = current;
		this.drafts = this.loadDraftsMap();
		this.draftChips = this.loadDraftChipsMap();

		if (Array.isArray(index) && index.length > 0) {
			this.sessions = index
				.filter((m) => m && typeof m === 'object' && typeof m.id === 'string')
				.map((m) => SessionStore.normalizeStored(m, this.memento.get<ChatUiMessage[]>(SESSION_MSGS_PREFIX + m.id, [])));
		}

		if (this.sessions.length > 0) {
			this.currentId = this.sessions.some((s) => s.id === current) ? current : this.sessions[0]!.id;
			// Осиротевшие msgs-ключи (краш между записями / удалённые) - вычистить
			const known = new Set(this.sessions.map((s) => s.id));
			for (const key of this.memento.keys()) {
				if (key.startsWith(SESSION_MSGS_PREFIX)) {
					const id = key.slice(SESSION_MSGS_PREFIX.length);
					if (!known.has(id)) {
						this.removed.add(id);
					}
				}
			}
			if (this.removed.size > 0) {
				this.schedulePersist(true);
			}
			return;
		}

		const now = Date.now();
		const empty: StoredChatSession = {
			id: newId(),
			title: defaultTitle(),
			messages: [],
			createdAt: now,
			updatedAt: now,
		};
		this.sessions = [empty];
		this.currentId = empty.id;
		this.persistAll();
	}

	private loadDraftsMap(): Record<string, string> {
		const raw = this.memento.get<Record<string, string>>(DRAFTS_KEY);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return {};
		}

		const out: Record<string, string> = {};
		for (const [id, text] of Object.entries(raw)) {
			if (typeof text === 'string' && text.length > 0) {
				out[id] = text;
			}
		}

		return out;
	}

	private loadDraftChipsMap(): Record<string, string[]> {
		const raw = this.memento.get<Record<string, string[]>>(DRAFT_CHIPS_KEY);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return {};
		}

		const out: Record<string, string[]> = {};
		for (const [id, chips] of Object.entries(raw)) {
			if (!Array.isArray(chips)) {
				continue;
			}

			const cleaned = chips.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim());
			if (cleaned.length > 0) {
				out[id] = cleaned;
			}
		}

		return out;
	}

	private persistDrafts(): void {
		void this.memento.update(DRAFTS_KEY, this.drafts);
		void this.memento.update(DRAFT_CHIPS_KEY, this.draftChips);
	}

	private markDirty(id: string): void {
		this.dirty.add(id);
		this.indexDirty = true;
	}

	// Пометить все сессии dirty и записать сразу (create / delete / rename / seed)
	private persistAll(): void {
		for (const s of this.sessions) {
			this.markDirty(s.id);
		}

		this.schedulePersist(true);
	}

	// Сортировка по updatedAt + cap MAX_SESSIONS + валидный currentId (без slim: slim только у dirty при save)
	private normalizeSessions(): void {
		this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		if (this.sessions.length > MAX_SESSIONS) {
			for (const dropped of this.sessions.splice(MAX_SESSIONS)) {
				this.dirty.delete(dropped.id);
				this.removed.add(dropped.id);
			}

			this.indexDirty = true;
		}

		if (!this.sessions.some((s) => s.id === this.currentId) && this.sessions[0]) {
			this.currentId = this.sessions[0].id;
		}
	}

	/**
	 * immediate=true: структурные операции (create/delete/rename/...) пишем сразу.
	 * immediate=false: saveMessages - trailing throttle PERSIST_DEBOUNCE_MS (batch всех dirty).
	 */
	private schedulePersist(immediate: boolean): void {
		this.normalizeSessions();
		if (immediate) {
			void this.flush();
			return;
		}

		if (this.persistTimer) {
			return;
		}

		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			void this.flush();
		}, PERSIST_DEBOUNCE_MS);
	}

	// Сброс всех pending-записей в memento (idempotent; вызывать на dispose/deactivate)
	flush(): Thenable<void> {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}

		this.normalizeSessions();
		const writes: Array<Thenable<void>> = [];
		const dirtyIds = [...this.dirty];
		this.dirty.clear();
		for (const id of dirtyIds) {
			const session = this.sessions.find((s) => s.id === id);
			if (session) {
				writes.push(this.memento.update(SESSION_MSGS_PREFIX + id, session.messages));
			}
		}

		for (const id of this.removed) {
			writes.push(this.memento.update(SESSION_MSGS_PREFIX + id, undefined));
		}

		this.removed.clear();
		const hadDirty = this.indexDirty;
		this.indexDirty = false;
		const index = hadDirty
			? this.sessions.map(({ messages: _m, ...meta }) => meta)
			: undefined;
		const writeCurrent = this.currentId !== this.writtenCurrentId;
		if (writeCurrent) {
			this.writtenCurrentId = this.currentId;
		}

		// Порядок вызовов: сообщения раньше индекса (краш между ними оставит orphan-ключ, чистится на load)
		if (index) {
			writes.push(this.memento.update(SESSION_INDEX_KEY, index));
		}

		if (writeCurrent) {
			writes.push(this.memento.update(CURRENT_ID_KEY, this.currentId));
		}

		return Promise.all(writes).then(() => undefined);
	}

	dispose(): void {
		void this.flush();
	}

	listSessions(options?: { query?: string; startedOnly?: boolean }): SessionSummary[] {
		const query = options?.query?.trim().toLocaleLowerCase();
		return this.sessions
			.filter((session) => !options?.startedOnly || sessionHasUserMessage(session))
			.filter((session) => !query
				|| session.title.toLocaleLowerCase().includes(query)
				|| session.messages.some((message) => message.content.toLocaleLowerCase().includes(query)))
			.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(toSummary);
	}

	/**
	 * Удалить черновые сессии без user-сообщений (кроме keepIds / child / с детьми).
	 * @returns сколько удалили
	 */
	pruneUnstartedSessions(keepIds: Iterable<string> = []): number {
		const keep = new Set(keepIds);
		keep.add(this.currentId);
		const before = this.sessions.length;
		const kept: StoredChatSession[] = [];
		for (const session of this.sessions) {
			const keepIt = keep.has(session.id)
				|| Boolean(session.parentSessionId)
				|| (session.childSessionIds?.length ?? 0) > 0
				|| sessionHasUserMessage(session);
			if (keepIt) {
				kept.push(session);
			} else {
				this.dirty.delete(session.id);
				this.removed.add(session.id);
			}
		}

		if (kept.length === before) {
			return 0;
		}

		this.sessions = kept;
		this.indexDirty = true;
		if (this.sessions.length === 0) {
			const now = Date.now();
			const empty: StoredChatSession = {
				id: newId(),
				title: defaultTitle(),
				messages: [],
				createdAt: now,
				updatedAt: now,
			};
			this.sessions = [empty];
			this.currentId = empty.id;
			this.markDirty(empty.id);
		} else if (!this.sessions.some((s) => s.id === this.currentId)) {
			this.currentId = this.sessions[0]!.id;
		}

		this.schedulePersist(true);
		return before - this.sessions.length;
	}

	getCurrentSessionId(): string {
		return this.currentId;
	}

	// Черновик Composer для сессии (пустая строка если нет)
	getDraft(sessionId?: string): string {
		const id = sessionId ?? this.currentId;
		return this.drafts[id] ?? '';
	}

	// Chips Composer (insert-строки) для сессии
	getDraftChips(sessionId?: string): string[] {
		const id = sessionId ?? this.currentId;
		return this.draftChips[id] ? [...this.draftChips[id]!] : [];
	}

	// Сохранить черновик текущей (или указанной) сессии. Без emit - только persist
	setDraft(text: string, chips?: string[], sessionId?: string): void {
		const id = sessionId ?? this.currentId;
		if (!id) {
			return;
		}

		// Игнор черновика для неизвестной/удалённой сессии
		if (!this.getSession(id) && id !== this.currentId) {
			return;
		}

		const trimmed = text;
		let changed = false;
		if (trimmed.length === 0) {
			if (id in this.drafts) {
				delete this.drafts[id];
				changed = true;
			}
		} else if (this.drafts[id] !== trimmed) {
			this.drafts[id] = trimmed;
			changed = true;
		}

		if (chips !== undefined) {
			const nextChips = chips.filter((c) => typeof c === 'string' && c.trim().length > 0)
				.map((c) => c.trim());
			const prevChips = this.draftChips[id] ?? [];
			const chipsSame = prevChips.length === nextChips.length && prevChips.every((c, i) => c === nextChips[i]);
			if (nextChips.length === 0) {
				if (id in this.draftChips) {
					delete this.draftChips[id];
					changed = true;
				}
			} else if (!chipsSame) {
				this.draftChips[id] = nextChips;
				changed = true;
			}
		}

		if (changed) {
			this.persistDrafts();
		}
	}

	// Очистить черновик сессии
	clearDraft(sessionId?: string): void {
		const id = sessionId ?? this.currentId;
		if (!id) {
			return;
		}

		let changed = false;
		if (id in this.drafts) {
			delete this.drafts[id];
			changed = true;
		}

		if (id in this.draftChips) {
			delete this.draftChips[id];
			changed = true;
		}

		if (changed) {
			this.persistDrafts();
		}
	}

	getSession(id: string): StoredChatSession | undefined {
		return this.sessions.find((s) => s.id === id);
	}

	getCurrent(): StoredChatSession {
		const cur = this.getSession(this.currentId);
		if (cur) {
			return cur;
		}

		const created = this.createSession();
		return created;
	}

	// Сохранить сообщения текущей (или указанной) сессии.
	// updatedAt двигаем только при реальном изменении истории (не при switch вкладки).
	saveMessages(messages: ChatUiMessage[], sessionId?: string): void {
		const id = sessionId ?? this.currentId;
		const idx = this.sessions.findIndex((s) => s.id === id);
		if (idx < 0) {
			return;
		}

		const prev = this.sessions[idx]!;
		const nextMessages = slimMessages(messages);
		if (messagesActivityEqual(prev.messages, nextMessages)) {
			return;
		}

		// Title «Новый чат» оставляем - LLM-title (systemAgents) или renameSession обновят после хода
		this.sessions[idx] = {
			...prev,
			messages: nextMessages,
			updatedAt: Date.now(),
		};
		// Только эта сессия dirty; запись debounced (batch)
		this.markDirty(id);
		this.schedulePersist(false);
	}

	createSession(title?: string, opts?: { parentSessionId?: string }): StoredChatSession {
		const now = Date.now();
		const parentSessionId = opts?.parentSessionId?.trim() || undefined;
		const session: StoredChatSession = {
			id: newId(),
			title: (title?.trim() || defaultTitle()).slice(0, 120),
			messages: [],
			createdAt: now,
			updatedAt: now,
			parentSessionId,
		};
		this.sessions.unshift(session);
		this.markDirty(session.id);
		this.currentId = session.id;
		if (parentSessionId) {
			this.linkChild(parentSessionId, session.id);
		}

		this.schedulePersist(true);
		return session;
	}

	// Связать parent <-> child без смены currentId
	linkChildSession(parentId: string, childId: string): void {
		if (this.linkChild(parentId, childId)) {
			this.schedulePersist(true);
		}
	}

	// Только мета (index): messages у parent/child не меняются -> не dirty
	private linkChild(parentId: string, childId: string): boolean {
		const pIdx = this.sessions.findIndex((s) => s.id === parentId);
		const cIdx = this.sessions.findIndex((s) => s.id === childId);
		if (pIdx < 0 || cIdx < 0) {
			return false;
		}

		const parent = this.sessions[pIdx]!;
		const child = this.sessions[cIdx]!;
		const kids = new Set(parent.childSessionIds ?? []);
		kids.add(childId);
		this.sessions[pIdx] = {
			...parent,
			childSessionIds: [...kids],
			updatedAt: Date.now(),
		};
		this.sessions[cIdx] = {
			...child,
			parentSessionId: parentId,
			updatedAt: Date.now(),
		};
		this.indexDirty = true;
		return true;
	}

	switchSession(id: string): StoredChatSession | undefined {
		const session = this.getSession(id);
		if (!session) {
			return undefined;
		}

		this.currentId = id;
		if (this.writtenCurrentId !== id) {
			this.writtenCurrentId = id;
			void this.memento.update(CURRENT_ID_KEY, id);
		}

		return session;
	}

	renameSession(id: string, title: string): boolean {
		const trimmed = title.trim().slice(0, 120);
		if (!trimmed) {
			return false;
		}

		const idx = this.sessions.findIndex((s) => s.id === id);
		if (idx < 0) {
			return false;
		}

		this.sessions[idx] = {
			...this.sessions[idx]!,
			title: trimmed,
			updatedAt: Date.now(),
		};
		this.indexDirty = true;
		this.schedulePersist(true);
		return true;
	}

	deleteSession(id: string): boolean {
		if (this.sessions.length <= 1) {
			// Последнюю сессию не удаляем - очищаем сообщения
			const only = this.sessions[0];
			if (!only || only.id !== id) {
				return false;
			}

			this.sessions[0] = {
				...only,
				title: defaultTitle(),
				messages: [],
				updatedAt: Date.now(),
			};
			this.currentId = only.id;
			this.clearDraft(id);
			this.markDirty(id);
			this.schedulePersist(true);
			return true;
		}

		const next = this.sessions.filter((s) => s.id !== id);
		if (next.length === this.sessions.length) {
			return false;
		}

		this.sessions = next;
		this.dirty.delete(id);
		this.removed.add(id);
		this.indexDirty = true;
		if (this.currentId === id) {
			this.currentId = this.sessions[0]!.id;
		}
		this.clearDraft(id);
		this.schedulePersist(true);
		return true;
	}

	// Новая сессия с копией сообщений до messageId включительно.
	forkFromMessage(sourceId: string, messageId: string, title?: string): StoredChatSession | undefined {
		const source = this.getSession(sourceId);
		if (!source) {
			return undefined;
		}

		const idx = source.messages.findIndex((m) => m.id === messageId);
		if (idx < 0) {
			return undefined;
		}

		const copied = source.messages.slice(0, idx + 1).map((m) => structuredClone(m));
		const now = Date.now();
		const session: StoredChatSession = {
			id: newId(),
			title: (title?.trim() || source.title).slice(0, 120),
			messages: slimMessages(copied),
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.unshift(session);
		this.currentId = session.id;
		this.markDirty(session.id);
		this.schedulePersist(true);
		return session;
	}
}

function titleFromMessages(messages: ChatUiMessage[]): string {
	const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
	if (!firstUser) {
		return defaultSessionTitle();
	}

	const line = firstUser.content.trim().split(/\r?\n/)[0] ?? '';
	const cleaned = line.replace(/^\/\w+\s*/, '').trim();
	if (!cleaned) {
		return defaultSessionTitle();
	}

	return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

// Резервный заголовок из первого сообщения пользователя (если smallModel недоступен)
export function fallbackTitleFromMessages(messages: ChatUiMessage[]): string {
	return titleFromMessages(messages);
}
