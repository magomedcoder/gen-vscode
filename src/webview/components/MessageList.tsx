import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UIEvent, WheelEvent } from 'react';
import type { ThinkingDisplay } from '../../core/config/types';
import type { ChatUiMessage, PendingConfirm, PendingQuestion } from '../../features/chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { ToolCallCard, type ToolDetailsMode } from './ToolCallCard';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownMessage } from './MarkdownMessage';
import { TokenMeter } from './TokenMeter';
import { ConfirmCard } from './ConfirmCard';
import { QuestionCard } from './QuestionCard';

interface MessageListProps {
	messages: ChatUiMessage[];
	busy: boolean;
	busyDetail?: string;
	detailsExpanded?: boolean;
	thinkingDisplay?: ThinkingDisplay;
	pendingConfirm?: PendingConfirm;
	pendingQuestion?: PendingQuestion;
	// Смена сессии - сразу показать низ (последние сообщения), без анимации
	sessionId?: string;
}

const STICK_THRESHOLD_PX = 96;

type EditPhase = 'compose' | 'confirm';

function distanceFromBottom(el: HTMLElement): number {
	return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function MessageList({
	messages,
	busy,
	busyDetail,
	detailsExpanded = true,
	thinkingDisplay = 'collapsed',
	pendingConfirm,
	pendingQuestion,
	sessionId,
}: MessageListProps) {
	const detailsMode: ToolDetailsMode = detailsExpanded ? 'full' : 'compact';
	const listRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const programmaticScroll = useRef(false);
	const prevBusy = useRef(false);
	const [editingId, setEditingId] = useState<string | undefined>();
	const [draft, setDraft] = useState('');
	const [editPhase, setEditPhase] = useState<EditPhase>('compose');

	const resetEdit = () => {
		setEditingId(undefined);
		setDraft('');
		setEditPhase('compose');
	};

	// Мгновенный pin к низу (без smooth - иначе глюки на стриме / открытии)
	const pinToBottom = () => {
		const el = listRef.current;
		if (!el || !stickToBottom.current) {
			return;
		}

		programmaticScroll.current = true;
		el.scrollTop = el.scrollHeight;
		// сброс после текущего кадра scroll-событий
		requestAnimationFrame(() => {
			programmaticScroll.current = false;
		});
	};

	useEffect(() => {
		if (busy && editingId) {
			resetEdit();
		}
	}, [busy, editingId]);

	// Открытие чата / смена сессии: сразу последние сообщения (до paint)
	useLayoutEffect(() => {
		stickToBottom.current = true;
		pinToBottom();
	}, [sessionId]);

	// Старт генерации - снова follow
	useLayoutEffect(() => {
		if (busy && !prevBusy.current) {
			stickToBottom.current = true;
			pinToBottom();
		}
		prevBusy.current = busy;
	}, [busy]);

	useEffect(() => {
		if (!editingId) {
			return;
		}

		const stillThere = messages.some((msg) => msg.id === editingId && msg.role === 'user');
		if (!stillThere) {
			resetEdit();
		}
	}, [messages, editingId]);

	// Follow при стриме / новых сообщениях - только instant pin, если пользователь у низа
	useLayoutEffect(() => {
		pinToBottom();
	}, [messages, pendingConfirm, pendingQuestion]);

	useEffect(() => {
		if (editPhase !== 'confirm') {
			return;
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				setEditPhase('compose');
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [editPhase]);

	const startEdit = (msg: ChatUiMessage) => {
		if (busy || msg.role !== 'user' || !msg.content.trim()) {
			return;
		}
		setEditingId(msg.id);
		setDraft(msg.content);
		setEditPhase('compose');
		stickToBottom.current = false;
	};

	const onListScroll = (_event: UIEvent<HTMLDivElement>) => {
		if (programmaticScroll.current) {
			return;
		}

		const el = listRef.current;
		if (!el) {
			return;
		}

		stickToBottom.current = distanceFromBottom(el) < STICK_THRESHOLD_PX;
	};

	// Колесо вверх - сразу отпускаем follow
	const onListWheel = (event: WheelEvent<HTMLDivElement>) => {
		if (event.deltaY < 0) {
			stickToBottom.current = false;
		}
	};

	const requestSend = () => {
		if (!editingId || !draft.trim()) {
			return;
		}
		setEditPhase('confirm');
	};

	const commitEdit = (revertFiles: boolean) => {
		if (!editingId || !draft.trim()) {
			return;
		}

		vscodeApi.postMessage({
			type: 'editMessage',
			id: editingId,
			content: draft,
			revertFiles: revertFiles || undefined,
		});
		resetEdit();
	};

	return (
		<div
			className="messages"
			ref={listRef}
			onScroll={onListScroll}
			onWheel={onListWheel}
		>
			{messages.length === 0
				? (<div className="msg msg--hint">{t('chat.messages.emptyHint')}</div>)
				: (messages.filter((msg) => {
					if (msg.role === 'tool') {
						return false;
					}

					if (msg.role === 'assistant' && !msg.content && !msg.thinking?.trim() && !msg.toolCalls?.length && !busy) {
						return false;
					}

					return true;
				}).map((msg) => {
					const isEditing = msg.role === 'user' && editingId === msg.id;
					const isSystemLike = msg.role === 'system' || msg.role === 'error';
					const canEdit = !busy && !editingId && msg.role === 'user' && Boolean(msg.content.trim());
					const canFork = !busy
						&& !isSystemLike
						&& (msg.role === 'user' || msg.role === 'assistant')
						&& Boolean(msg.id)
						&& Boolean(msg.content.trim() || msg.toolCalls?.length);
					const showThinking = msg.role === 'assistant' && Boolean(msg.thinking?.trim());
					const isTyping = msg.role === 'assistant' && busy && !msg.content && !msg.toolCalls?.length && !msg.thinking?.trim();
					// Пока последний assistant стримится - plain text; ReactMarkdown после finalize
					const isStreamingAssistant = Boolean(
						busy
						&& msg.role === 'assistant'
						&& msg.content
						&& msg.id === [...messages].reverse().find((m) => m.role === 'assistant')?.id,
					);
					const showActions = !isEditing && !isSystemLike && (canEdit || canFork);

					return (
						<div
							key={msg.id}
							className={`msg-wrap msg-wrap--${msg.role}${isEditing ? ' msg-wrap--editing' : ''}`}
						>
							<div className={`msg msg--${msg.role}${isEditing ? ' msg--editing' : ''}`}>
								{!isEditing && showThinking ? (
									<ThinkingBlock thinking={msg.thinking!} display={thinkingDisplay} />
								) : null}
								{isEditing ? (
									<div className="msg-edit">
										<div className="msg-edit__head">
											<span className="msg-edit__title">{t('chat.messages.edit')}</span>
											<button
												type="button"
												className="msg-edit__close"
												title={t('chat.messages.editCancel')}
												aria-label={t('chat.messages.editCancel')}
												onClick={resetEdit}
											>
												<span className="codicon codicon-close" aria-hidden="true" />
											</button>
										</div>
										<textarea
											className="msg-edit__input"
											rows={4}
											value={draft}
											autoFocus={editPhase === 'compose'}
											placeholder={t('chat.edit.placeholder')}
											onChange={(e) => setDraft(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === 'Escape') {
													e.preventDefault();
													resetEdit();
												}

												if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
													e.preventDefault();
													requestSend();
												}
											}}
										/>
										<div className="msg-edit__footer">
											<span className="msg-edit__hint">{t('chat.edit.sendHint')}</span>
											<div className="msg-edit__actions">
												<button
													type="button"
													className="msg-edit__btn msg-edit__btn--ghost"
													onClick={resetEdit}
												>
													{t('chat.messages.editCancel')}
												</button>
												<button
													type="button"
													className="msg-edit__btn msg-edit__btn--send"
													disabled={!draft.trim()}
													onClick={requestSend}
												>
													<span className="codicon codicon-send" aria-hidden="true" />
													{t('chat.messages.editSave')}
												</button>
											</div>
										</div>
									</div>
								) : msg.role === 'assistant' && msg.content
									? (isStreamingAssistant
										? <div className="msg__body msg__body--stream">{msg.content}</div>
										: <MarkdownMessage content={msg.content} />)
									: isTyping
										? (
											<span className="msg__typing" aria-label={t('chat.messages.typing')}>
												<span className="msg__typing-dot" />
												<span className="msg__typing-dot" />
												<span className="msg__typing-dot" />
											</span>
										)
										: msg.role === 'assistant' ? null : (
											<div className="msg__body">{msg.content}</div>
										)}
								{!isEditing && msg.toolCalls?.length ? (
									<div className="tool-calls">
										{msg.toolCalls.map((call) => (<ToolCallCard key={call.id} call={call} detailsMode={detailsMode} />))}
									</div>
								) : null}
								{!isEditing && msg.role === 'assistant' && msg.usage ? (
									<div className="msg__toolbar">
										<span className="msg__toolbar-meta">
											<TokenMeter usage={msg.usage} />
										</span>
									</div>
								) : null}
							</div>
							{showActions ? (
								<div className="msg-actions">
									{canFork ? (
										<button
											type="button"
											className="msg__icon"
											title={t('chat.messages.fork')}
											aria-label={t('chat.messages.fork')}
											onClick={() => vscodeApi.postMessage({ type: 'forkSession', messageId: msg.id })}
										>
											<span className="codicon codicon-repo-forked" aria-hidden="true" />
										</button>
									) : null}
									{canEdit ? (
										<button
											type="button"
											className="msg__icon"
											title={t('chat.messages.edit')}
											aria-label={t('chat.messages.edit')}
											onClick={() => startEdit(msg)}
										>
											<span className="codicon codicon-edit" aria-hidden="true" />
										</button>
									) : null}
								</div>
							) : null}
						</div>
					);
				})
			)}
			{busyDetail ? (
				<div className="msg-wrap msg-wrap--system">
					<div className="msg msg--system" role="status">{busyDetail}</div>
				</div>
			) : null}
			{pendingConfirm ? (
				<div className="msg msg--confirm"><ConfirmCard confirm={pendingConfirm} /></div>
			) : null}
			{pendingQuestion ? (
				<div className="msg msg--confirm"><QuestionCard question={pendingQuestion} /></div>
			) : null}
			{editPhase === 'confirm' && editingId ? (
				<div
					className="msg-modal"
					role="presentation"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) {
							setEditPhase('compose');
						}
					}}
				>
					<div
						className="msg-modal__dialog"
						role="dialog"
						aria-modal="true"
						aria-labelledby="msg-edit-confirm-title"
					>
						<div className="msg-modal__head">
							<span className="msg-modal__icon" aria-hidden="true">
								<span className="codicon codicon-history" />
							</span>
							<div className="msg-modal__titles">
								<div id="msg-edit-confirm-title" className="msg-modal__title">
									{t('chat.edit.confirmTitle')}
								</div>
								<p className="msg-modal__text">{t('chat.edit.confirmDetail')}</p>
							</div>
							<button
								type="button"
								className="msg-modal__close"
								title={t('chat.messages.editCancel')}
								aria-label={t('chat.messages.editCancel')}
								onClick={() => setEditPhase('compose')}
							>
								<span className="codicon codicon-close" aria-hidden="true" />
							</button>
						</div>
						<div className="msg-modal__actions">
							<button
								type="button"
								className="msg-edit-confirm__btn msg-edit-confirm__btn--ghost"
								onClick={() => setEditPhase('compose')}
							>
								{t('chat.messages.editCancel')}
							</button>
							<button
								type="button"
								className="msg-edit-confirm__btn msg-edit-confirm__btn--keep"
								autoFocus
								onClick={() => commitEdit(false)}
							>
								<span className="codicon codicon-check" aria-hidden="true" />
								{t('chat.edit.keepChanges')}
							</button>
							<button
								type="button"
								className="msg-edit-confirm__btn msg-edit-confirm__btn--revert"
								onClick={() => commitEdit(true)}
							>
								<span className="codicon codicon-discard" aria-hidden="true" />
								{t('chat.edit.revertChanges')}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
