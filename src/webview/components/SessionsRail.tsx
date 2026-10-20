import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { SessionSummary } from '../../features/chat/sessionStore';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface SessionsRailProps {
	sessionId?: string;
	sessions?: SessionSummary[];
}

export function SessionsRail({ sessionId, sessions }: SessionsRailProps) {
	const list = sessions ?? [];
	const currentId = sessionId ?? list[0]?.id ?? '';
	const [sessionQuery, setSessionQuery] = useState('');
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState('');
	const [menuId, setMenuId] = useState<string | null>(null);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const skipRenameBlurRef = useRef(false);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			vscodeApi.postMessage({
				type: 'setSessionFilter',
				query: sessionQuery,
			});
		}, 150);
		return () => window.clearTimeout(timer);
	}, [sessionQuery]);

	useEffect(() => {
		if (!renamingId) {
			return;
		}
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [renamingId]);

	useEffect(() => {
		if (!menuId) {
			return;
		}
		const onDoc = () => setMenuId(null);
		window.addEventListener('click', onDoc);
		return () => window.removeEventListener('click', onDoc);
	}, [menuId]);

	const onSwitch = (id: string) => {
		if (!id || id === currentId) {
			return;
		}
		setMenuId(null);
		vscodeApi.postMessage({ type: 'switchSession', id });
	};

	const startRename = (s: SessionSummary) => {
		setMenuId(null);
		setRenameDraft(s.title);
		setRenamingId(s.id);
	};

	const cancelRename = () => {
		skipRenameBlurRef.current = true;
		setRenamingId(null);
		setRenameDraft('');
	};

	const commitRename = () => {
		if (skipRenameBlurRef.current) {
			skipRenameBlurRef.current = false;
			return;
		}
		const id = renamingId;
		if (!id) {
			return;
		}
		const title = renameDraft.trim();
		const prev = list.find((s) => s.id === id)?.title;
		if (!title || title === prev) {
			setRenamingId(null);
			setRenameDraft('');
			return;
		}
		vscodeApi.postMessage({ type: 'renameSession', id, title });
		setRenamingId(null);
		setRenameDraft('');
	};

	const onRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelRename();
		}
	};

	const stop = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<aside className="sessions-rail" aria-label={t('chat.session.aria')}>
			<div className="sessions-rail__top">
				<button
					className="sessions-rail__new"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'newSession' })}
				>
					<span className="codicon codicon-add" aria-hidden="true" />
					<span>{t('chat.session.new')}</span>
				</button>
				<div className="sessions-rail__search-row">
					<span className="codicon codicon-search sessions-rail__search-icon" aria-hidden="true" />
					<input
						className="sessions-rail__search"
						type="search"
						value={sessionQuery}
						placeholder={t('chat.session.search')}
						aria-label={t('chat.session.search')}
						onChange={(e) => setSessionQuery(e.target.value)}
					/>
				</div>
			</div>

			<ul className="sessions-rail__list" role="listbox" aria-label={t('chat.session.aria')}>
				{list.length === 0 ? (
					<li className="sessions-rail__empty">
						<span className="codicon codicon-comment-discussion" aria-hidden="true" />
						<span>{t('chat.session.empty')}</span>
					</li>
				) : (
					list.map((s) => {
						const active = s.id === currentId;
						const child = Boolean(s.isChild || s.parentSessionId);
						const renaming = renamingId === s.id;
						const openMenu = menuId === s.id;
						const childrenCount = s.childSessionIds?.length ?? 0;

						return (
							<li
								key={s.id}
								className={`sessions-rail__row${active ? ' sessions-rail__row--active' : ''}${child ? ' sessions-rail__row--child' : ''}`}
							>
								{renaming ? (
									<input
										ref={renameInputRef}
										className="sessions-rail__rename"
										type="text"
										value={renameDraft}
										aria-label={t('chat.session.renamePrompt')}
										onChange={(e) => setRenameDraft(e.target.value)}
										onBlur={commitRename}
										onKeyDown={onRenameKeyDown}
										maxLength={120}
									/>
								) : (
									<>
										<button
											type="button"
											role="option"
											aria-selected={active}
											className={`sessions-rail__item${s.busy ? ' sessions-rail__item--busy' : ''}`}
											title={s.title}
											onClick={() => onSwitch(s.id)}
											onDoubleClick={() => startRename(s)}
										>
											<span className="sessions-rail__item-main">
												{s.busy ? (
													<span className="sessions-rail__busy" aria-hidden="true" />
												) : (
													<span
														className={`codicon ${child ? 'codicon-git-commit' : 'codicon-comment'} sessions-rail__item-icon`}
														aria-hidden="true"
													/>
												)}
												<span className="sessions-rail__item-title">{s.title}</span>
											</span>
											{childrenCount > 0 ? (
												<span className="sessions-rail__item-meta">
													<span className="sessions-rail__chip">
														{t('chat.session.childrenShort', childrenCount)}
													</span>
												</span>
											) : null}
										</button>
										<div className={`sessions-rail__item-actions${openMenu ? ' sessions-rail__item-actions--open' : ''}`}>
											<button
												type="button"
												className="sessions-rail__ghost"
												title={t('chat.session.more')}
												aria-label={t('chat.session.more')}
												aria-expanded={openMenu}
												onClick={(e) => {
													stop(e);
													setMenuId((id) => (id === s.id ? null : s.id));
												}}
											>
												<span className="codicon codicon-ellipsis" aria-hidden="true" />
											</button>
											{openMenu ? (
												<div className="sessions-rail__menu" role="menu" onClick={stop}>
													<button
														type="button"
														role="menuitem"
														className="sessions-rail__menu-item"
														onClick={() => startRename(s)}
													>
														<span className="codicon codicon-edit" aria-hidden="true" />
														{t('chat.session.rename')}
													</button>
													{s.parentSessionId ? (
														<button
															type="button"
															role="menuitem"
															className="sessions-rail__menu-item"
															onClick={() => onSwitch(s.parentSessionId!)}
														>
															<span className="codicon codicon-arrow-up" aria-hidden="true" />
															{t('chat.session.parentShort')}
														</button>
													) : null}
													<button
														type="button"
														role="menuitem"
														className="sessions-rail__menu-item sessions-rail__menu-item--danger"
														onClick={() => {
															setMenuId(null);
															vscodeApi.postMessage({ type: 'deleteSession', id: s.id });
														}}
													>
														<span className="codicon codicon-trash" aria-hidden="true" />
														{t('chat.session.delete')}
													</button>
												</div>
											) : null}
										</div>
									</>
								)}
							</li>
						);
					})
				)}
			</ul>

			<div className="sessions-rail__footer">
				<button
					className="sessions-rail__settings"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'openSettings' })}
				>
					<span className="codicon codicon-settings-gear" aria-hidden="true" />
					<span>{t('chat.header.settings')}</span>
				</button>
			</div>
		</aside>
	);
}
