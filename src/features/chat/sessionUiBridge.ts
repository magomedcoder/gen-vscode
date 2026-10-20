import type { ChatViewState, ToWebviewMessage } from './protocol';

export type ChatSessionListener = (state: ChatViewState) => void;

// Задержка coalesce полного emit mid-stream
const EMIT_COALESCE_MS = 75;
// Задержка coalesce streamPatch (content/thinking)
const STREAM_PATCH_COALESCE_MS = 64;

interface StreamPatchPending {
	sessionId: string;
	messageId: string;
	content?: string;
	thinking?: string;
}

// Зависимости моста от ChatSession (без доступа к приватным полям)
export interface SessionUiBridgeHost {
	getState(opts: { light: boolean }): ChatViewState;
	// Есть ли активный run на текущей вкладке (включает coalesce / light state)
	hasInflight(): boolean;
	getCurrentSessionId(): string;
	// Вызывается после рассылки state слушателям (git-sync auto-Keep и т.п.)
	afterEmit(): void;
}

// UI-мост ChatSession: подписчики, coalesce полного emit (~75ms) и streamPatch (~64ms), postMessage в webview
export class SessionUiBridge {
	private readonly listeners = new Set<ChatSessionListener>();
	private postToWebview?: (message: ToWebviewMessage) => void;
	// Coalesce full emit mid-stream
	private emitTimer?: ReturnType<typeof setTimeout>;
	private emitQueued = false;
	// Coalesce streamPatch content/thinking
	private streamPatchTimer?: ReturnType<typeof setTimeout>;
	private streamPatchPending?: StreamPatchPending;

	constructor(private readonly host: SessionUiBridgeHost) {}

	subscribe(listener: ChatSessionListener): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	// Привязать postMessage к chat webview (ChatViewProvider)
	setPoster(post: (message: ToWebviewMessage) => void): void {
		this.postToWebview = post;
	}

	// Отправить сообщение в webview, если poster привязан
	post(message: ToWebviewMessage): void {
		this.postToWebview?.(message);
	}

	// Полный emit; mid-stream можно coalesce (~75ms), tool/end - сразу
	emit(opts?: { coalesce?: boolean }): void {
		if (opts?.coalesce && this.host.hasInflight()) {
			this.emitQueued = true;
			if (!this.emitTimer) {
				this.emitTimer = setTimeout(() => {
					this.emitTimer = undefined;
					if (this.emitQueued) {
						this.emitQueued = false;
						this.flushEmit(true);
					}
				}, EMIT_COALESCE_MS);
			}
			return;
		}
		this.flushEmit(false);
	}

	flushEmit(light: boolean): void {
		if (this.emitTimer) {
			clearTimeout(this.emitTimer);
			this.emitTimer = undefined;
		}

		this.emitQueued = false;
		this.flushStreamPatch();
		const state = this.host.getState({ 
			light: light && this.host.hasInflight() 
		});
		for (const listener of this.listeners) {
			listener(state);
		}

		this.host.afterEmit();
	}

	scheduleStreamPatch(
		sessionId: string,
		messageId: string,
		patch: { content?: string; thinking?: string },
	): void {
		const prev = this.streamPatchPending;
		if (prev && prev.sessionId === sessionId && prev.messageId === messageId) {
			this.streamPatchPending = {
				...prev,
				...patch,
			};
		} else {
			this.flushStreamPatch();
			this.streamPatchPending = {
				sessionId,
				messageId,
				...patch,
			};
		}
		if (!this.streamPatchTimer) {
			this.streamPatchTimer = setTimeout(() => {
				this.streamPatchTimer = undefined;
				this.flushStreamPatch();
			}, STREAM_PATCH_COALESCE_MS);
		}
	}

	flushStreamPatch(): void {
		if (this.streamPatchTimer) {
			clearTimeout(this.streamPatchTimer);
			this.streamPatchTimer = undefined;
		}

		const pending = this.streamPatchPending;
		if (!pending || !this.postToWebview) {
			this.streamPatchPending = undefined;
			return;
		}

		this.streamPatchPending = undefined;
		// Только для активной вкладки - иначе webview всё равно ждёт switch
		if (pending.sessionId !== this.host.getCurrentSessionId()) {
			return;
		}

		this.postToWebview({
			type: 'streamPatch',
			sessionId: pending.sessionId,
			messageId: pending.messageId,
			content: pending.content,
			thinking: pending.thinking,
		});
	}

	// Сбросить таймеры и pending (dispose сессии); listeners не трогаем
	dispose(): void {
		if (this.emitTimer) {
			clearTimeout(this.emitTimer);
			this.emitTimer = undefined;
		}
		
		if (this.streamPatchTimer) {
			clearTimeout(this.streamPatchTimer);
			this.streamPatchTimer = undefined;
		}

		this.streamPatchPending = undefined;
	}
}
