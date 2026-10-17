import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ThinkingDisplay } from '../../core/config/types';
import type { SessionSummary } from '../../features/chat/sessionStore';
import type { TokenUsage } from '../../core/llm/usage';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	estimatedPromptTokens?: number;
	contextBudget?: number;
	cachedNCtx?: number;
	lastContextPrune?: { chars: number; messages: number };
	nearBudget?: boolean;
	nCtxWarn?: boolean;
	contextBreakdown?: {
		history: number;
		mentions: number;
		system: number;
		user: number;
	};
	mentionsTruncated?: boolean;
	sessionId?: string;
	sessions?: SessionSummary[];
	toolDetailsExpanded?: boolean;
	onSetToolDetailsExpanded?: (expanded: boolean) => void;
	thinkingDisplay?: ThinkingDisplay;
	onSetThinkingDisplay?: (mode: ThinkingDisplay) => void;
	models?: Array<{ id: string; label: string }>;
	model?: string;
	modelsLoading?: boolean;
	onLoadModels?: () => void;
}

export function ChatHeader({
	usage,
	maxContextTokens,
	estimatedPromptTokens,
	contextBudget,
	cachedNCtx,
	lastContextPrune,
	nearBudget,
	nCtxWarn,
	contextBreakdown,
	mentionsTruncated,
	sessionId,
	sessions,
	toolDetailsExpanded = true,
	onSetToolDetailsExpanded,
	thinkingDisplay = 'collapsed',
	onSetThinkingDisplay,
	models,
	model,
	modelsLoading = false,
	onLoadModels,
}: ChatHeaderProps) {
	const list = sessions ?? [];
	const currentId = sessionId ?? list[0]?.id ?? '';
	const current = list.find((s) => s.id === currentId);
	const currentBusy = Boolean(current?.busy);
	const parentSessionId = current?.parentSessionId;
	const isChild = Boolean(current?.isChild || parentSessionId);
	const parentSession = parentSessionId
		? list.find((s) => s.id === parentSessionId)
		: undefined;
	const childCount = current?.childSessionIds?.length ?? 0;
	const modelList = models ?? [];
	const currentModel = model ?? '';
	const [renaming, setRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState('');
	const [sessionQuery, setSessionQuery] = useState('');
	const [showArchived, setShowArchived] = useState(false);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const skipRenameBlurRef = useRef(false);
	const optsRef = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		onLoadModels?.();
	}, [onLoadModels]);

	useEffect(() => {
		setRenaming(false);
	}, [currentId]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			vscodeApi.postMessage({
				type: 'setSessionFilter',
				query: sessionQuery,
				archived: showArchived ? true : undefined,
			});
		}, 150);
		return () => window.clearTimeout(timer);
	}, [sessionQuery, showArchived]);

	useEffect(() => {
		if (!renaming) {
			return;
		}

		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [renaming]);

	const onSwitch = (id: string) => {
		if (!id || id === currentId) {
			return;
		}

		vscodeApi.postMessage({ type: 'switchSession', id });
	};

	const startRename = () => {
		if (!currentId) {
			return;
		}

		setRenameDraft(current?.title ?? '');
		setRenaming(true);
	};

	const cancelRename = () => {
		skipRenameBlurRef.current = true;
		setRenaming(false);
		setRenameDraft('');
	};

	const commitRename = () => {
		if (skipRenameBlurRef.current) {
			skipRenameBlurRef.current = false;
			return;
		}

		if (!currentId) {
			setRenaming(false);
			return;
		}

		const title = renameDraft.trim();
		if (!title || title === current?.title) {
			setRenaming(false);
			setRenameDraft('');
			return;
		}

		vscodeApi.postMessage({ type: 'renameSession', id: currentId, title });
		setRenaming(false);
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

	const onDelete = () => {
		if (!currentId) {
			return;
		}

		vscodeApi.postMessage({ type: 'deleteSession', id: currentId });
	};

	const onModelChange = (next: string) => {
		if (!next || next === currentModel) {
			return;
		}

		vscodeApi.postMessage({ type: 'setModel', model: next });
		optsRef.current?.removeAttribute('open');
	};

	const modelInList = currentModel
		? modelList.some((item) => item.id === currentModel)
		: true;

	const modelSummary = currentModel
		? (modelList.find((item) => item.id === currentModel)?.label ?? currentModel)
		: t('chat.model.label');

	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">{t('chat.header.title')}</span>
				{list.length > 0 ? (
					<div className="session-bar" role="group" aria-label={t('chat.session.aria')}>
						<input
							className="session-bar__rename"
							type="search"
							value={sessionQuery}
							placeholder={t('chat.session.search')}
							aria-label={t('chat.session.search')}
							onChange={(event) => setSessionQuery(event.target.value)}
						/>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							aria-pressed={showArchived}
							title={showArchived ? t('chat.session.showActive') : t('chat.session.showArchived')}
							onClick={() => setShowArchived((value) => !value)}
						>
							<span className="codicon codicon-archive" aria-hidden="true" />
						</button>
						{renaming ? (
							<input
								ref={renameInputRef}
								className="session-bar__rename"
								type="text"
								value={renameDraft}
								aria-label={t('chat.session.renamePrompt')}
								onChange={(e) => setRenameDraft(e.target.value)}
								onBlur={commitRename}
								onKeyDown={onRenameKeyDown}
								maxLength={120}
							/>
						) : (
							<select
								className="session-bar__select"
								value={currentId}
								data-busy={currentBusy ? 'true' : undefined}
								onChange={(e) => onSwitch(e.target.value)}
								title={t('chat.session.switch')}
							>
								{list.map((s) => {
									const childMark = s.isChild || s.parentSessionId ? '↳ ' : '';
									return (
										<option
											key={s.id}
											value={s.id}
											className={s.busy ? 'session-bar__option--busy' : undefined}
										>
											{s.busy ? ` ${childMark}${s.title}` : `${childMark}${s.title}`}
										</option>
									);
								})}
							</select>
						)}
						{isChild ? (
							<span className="session-bar__badge session-bar__badge--child" title={t('chat.session.child')}>
								{t('chat.session.child')}
							</span>
						) : null}
						{parentSessionId ? (
							<button
								className="btn btn--secondary session-bar__badge session-bar__badge--parent"
								type="button"
								title={t('chat.session.parent', parentSession?.title ?? parentSessionId)}
								aria-label={t('chat.session.parent', parentSession?.title ?? parentSessionId)}
								onClick={() => onSwitch(parentSessionId)}
							>
								{t('chat.session.parentShort')}
							</button>
						) : null}
						{childCount > 0 ? (
							<span
								className="session-bar__badge session-bar__badge--children"
								title={t('chat.session.children', childCount)}
							>
								{t('chat.session.childrenShort', childCount)}
							</span>
						) : null}
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.new')}
							aria-label={t('chat.session.new')}
							onClick={() => vscodeApi.postMessage({ type: 'newSession' })}
						>
							<span className="codicon codicon-add" aria-hidden="true" />
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.rename')}
							aria-label={t('chat.session.rename')}
							disabled={renaming}
							onClick={startRename}
						>
							<span className="codicon codicon-edit" aria-hidden="true" />
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={current?.archived ? t('chat.session.unarchive') : t('chat.session.archive')}
							aria-label={current?.archived ? t('chat.session.unarchive') : t('chat.session.archive')}
							onClick={() => vscodeApi.postMessage({ type: 'archiveSession', id: currentId, archived: !current?.archived })}
						>
							<span className="codicon codicon-archive" aria-hidden="true" />
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.delete')}
							aria-label={t('chat.session.delete')}
							onClick={onDelete}
						>
							<span className="codicon codicon-trash" aria-hidden="true" />
						</button>
					</div>
				) : null}
			</div>
			<div className="header__actions">
				<TokenMeter
					usage={usage}
					maxContextTokens={maxContextTokens}
					estimatedPromptTokens={estimatedPromptTokens}
					contextBudget={contextBudget}
					cachedNCtx={cachedNCtx}
					lastContextPrune={lastContextPrune}
					nearBudget={nearBudget}
					nCtxWarn={nCtxWarn}
					contextBreakdown={contextBreakdown}
					mentionsTruncated={mentionsTruncated}
					compact
				/>
				<details ref={optsRef} className="header-opts">
					<summary className="btn btn--secondary header-opts__summary" title={t('chat.header.options')}>
						<span className="header-opts__summary-text">{modelSummary}</span>
						<span className="header-opts__chevron" aria-hidden="true">▾</span>
					</summary>
					<div className="header-opts__panel" onClick={(e) => e.stopPropagation()}>
						<label className="header-opts__row">
							<span className="header-opts__label">{t('chat.model.label')}</span>
							<select
								className="header-opts__select"
								value={currentModel}
								disabled={modelsLoading || modelList.length === 0}
								onChange={(e) => onModelChange(e.target.value)}
								aria-label={t('chat.model.aria')}
							>
								{!modelInList && currentModel ? (
									<option value={currentModel}>{currentModel}</option>
								) : null}
								{modelList.length === 0 ? (
									<option value="">{modelsLoading ? '...' : '-'}</option>
								) : (
									modelList.map((item) => (
										<option key={item.id} value={item.id}>{item.label}</option>
									))
								)}
							</select>
						</label>
						{onSetToolDetailsExpanded ? (
							<label className="header-opts__row">
								<span className="header-opts__label">{t('chat.tool.details.label')}</span>
								<select
									className="header-opts__select"
									value={toolDetailsExpanded ? 'full' : 'compact'}
									onChange={(e) => {
										onSetToolDetailsExpanded(e.target.value === 'full');
										optsRef.current?.removeAttribute('open');
									}}
									aria-label={t('chat.tool.details.label')}
								>
									<option value="full">{t('chat.tool.details.full')}</option>
									<option value="compact">{t('chat.tool.details.compact')}</option>
								</select>
							</label>
						) : null}
						{onSetThinkingDisplay ? (
							<label className="header-opts__row">
								<span className="header-opts__label">{t('chat.thinking.menuLabel')}</span>
								<select
									className="header-opts__select"
									value={thinkingDisplay}
									onChange={(e) => {
										onSetThinkingDisplay(e.target.value as ThinkingDisplay);
										optsRef.current?.removeAttribute('open');
									}}
									aria-label={t('chat.thinking.menuLabel')}
								>
									<option value="off">{t('chat.thinking.option.off')}</option>
									<option value="collapsed">{t('chat.thinking.option.collapsed')}</option>
									<option value="expanded">{t('chat.thinking.option.expanded')}</option>
								</select>
							</label>
						) : null}
					</div>
				</details>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'openSettings' })}
				>
					{t('chat.header.settings')}
				</button>
			</div>
		</header>
	);
}
