import { useEffect, useState } from 'react';
import type { DiffHunkPayload, ToolCallUi } from '../../features/chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

const RESULT_PREVIEW = 500;

function statusLabel(status: ToolCallUi['status']): string {
	if (status === 'awaiting_confirm') {
		return t('chat.tool.status.awaitingConfirm');
	}

	if (status === 'pending') {
		return t('chat.tool.status.pending');
	}

	if (status === 'ok') {
		return t('chat.tool.status.ok');
	}

	if (status === 'denied') {
		return t('chat.tool.status.denied');
	}

	return t('chat.tool.status.error');
}

function formatRemaining(ms: number): string {
	const sec = Math.max(0, Math.ceil(ms / 1000));
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m > 0) {
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	return `${s}s`;
}

// Схлопывает подряд идущие одинаковые строки в `строка *N`
export function collapseRepeatedLines(text: string): string {
	if (!text) {
		return text;
	}

	const lines = text.split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		let count = 1;
		while (i + count < lines.length && lines[i + count] === line) {
			count += 1;
		}

		out.push(count > 1 ? `${line} *${count}` : line);
		i += count;
	}

	return out.join('\n');
}

function DiffLinePreview({ preview }: { preview: string }) {
	return (
		<pre className="tool-card__block tool-card__diff">
			{preview.split('\n').map((line, i) => {
				const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
				return (<span key={i} className={`diff-line diff-line--${kind}`}>{line || ' '}</span>);
			})}
		</pre>
	);
}

function hunkStatusLabel(status: DiffHunkPayload['status']): string {
	if (status === 'accepted') {
		return t('chat.hunk.accepted');
	}

	if (status === 'rejected') {
		return t('chat.hunk.rejected');
	}

	return '';
}

function HunkReview({ callId, hunk }: { callId: string; hunk: DiffHunkPayload }) {
	const pending = hunk.status === 'pending';
	return (
		<div className={`hunk hunk--${hunk.status}`}>
			<div className="hunk__header">
				<span className="hunk__meta">
					{hunk.path ? (
						<button
							type="button"
							className="hunk__path hunk__path--link"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								vscodeApi.postMessage({ type: 'openPath', path: hunk.path! });
							}}
						>
							{hunk.path}
						</button>
					) : null}
					<span className="hunk__lines">@{hunk.newStart}</span>
					{hunk.status !== 'pending' ? <span className="hunk__status">{hunkStatusLabel(hunk.status)}</span> : null}
				</span>
				{pending ? (
					<span className="hunk__actions">
						<button
							type="button"
							className="hunk__btn hunk__btn--accept"
							onClick={() => vscodeApi.postMessage({
								type: 'reviewHunk',
								toolCallId: callId,
								hunkId: hunk.id,
								action: 'accept',
							})}
						>
							{t('chat.hunk.accept')}
						</button>
						<button
							type="button"
							className="hunk__btn hunk__btn--reject"
							onClick={() => vscodeApi.postMessage({
								type: 'reviewHunk',
								toolCallId: callId,
								hunkId: hunk.id,
								action: 'reject',
							})}
						>
							{t('chat.hunk.reject')}
						</button>
					</span>
				) : null}
			</div>
			<DiffLinePreview preview={hunk.preview} />
		</div>
	);
}

function PendingToolMeta({ call }: { call: ToolCallUi }) {
	const timeoutMs = call.timeoutMs;
	const startedAt = call.startedAt ?? Date.now();
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (call.status !== 'pending' || !timeoutMs) {
			return;
		}

		const id = window.setInterval(() => setNow(Date.now()), 250);
		return () => window.clearInterval(id);
	}, [call.status, timeoutMs]);

	const remaining = timeoutMs ? timeoutMs - (now - startedAt) : undefined;

	return (
		<span className="tool-card__pending-meta">
			{remaining !== undefined ? (
				<span className="tool-card__countdown" title={t('chat.tool.timeout')}>
					{formatRemaining(remaining)}
				</span>
			) : null}
			<button
				type="button"
				className="tool-card__stop"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					vscodeApi.postMessage({ type: 'cancelToolCall', id: call.id });
				}}
			>
				{t('chat.tool.stop')}
			</button>
		</span>
	);
}

export type ToolDetailsMode = 'full' | 'compact';

interface ToolCallCardProps {
	call: ToolCallUi;
	// Глобальная настройка деталей: compact скрывает args/result/diff, пока карточка не открыта
	detailsMode?: ToolDetailsMode;
}

export function ToolCallCard({ call, detailsMode = 'full' }: ToolCallCardProps) {
	const [expanded, setExpanded] = useState(false);
	const result = call.result ?? '';
	const collapsed = collapseRepeatedLines(result);
	const truncated = !expanded && collapsed.length > RESULT_PREVIEW;
	const shown = truncated ? `${collapsed.slice(0, RESULT_PREVIEW)}\n...` : collapsed;
	const hunks = call.hunks ?? [];
	const pendingCount = hunks.filter((h) => h.status === 'pending').length;
	const showHunks = hunks.length > 0;
	const hasExit = call.exitCode !== undefined;
	const modeDefaultOpen = detailsMode === 'full' && (call.status !== 'ok' || pendingCount > 0);
	const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		setUserOpen(undefined);
	}, [detailsMode]);

	const open = userOpen ?? modeDefaultOpen;
	const argsPretty = prettyToolArgs(call.arguments);

	return (
		<details
			className={`tool-card tool-card--${call.status}${detailsMode === 'compact' ? ' tool-card--compact' : ''}`}
			open={open}
			onToggle={(event) => {
				const next = (event.currentTarget as HTMLDetailsElement).open;
				if (next === open) {
					return;
				}

				setUserOpen(next);
			}}
		>
			<summary>
				<span className="tool-card__title">
					<span className="tool-card__name">{call.name}</span>
					{call.path ? (
						<button
							type="button"
							className="tool-card__path tool-card__path--link"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								vscodeApi.postMessage({ type: 'openPath', path: call.path! });
							}}
						>
							{call.path}
						</button>
					) : null}
					{call.cwd ? (
						<span className="tool-card__cwd" title={`${t('chat.tool.cwd')}: ${call.cwd}`}>
							{t('chat.tool.cwd')}: {call.cwd}
						</span>
					) : null}
				</span>
				<span className="tool-card__status-row">
					{call.status === 'pending' ? <PendingToolMeta call={call} /> : null}
					{call.status === 'awaiting_confirm' ? (<span className="tool-card__awaiting">{t('chat.tool.awaitingConfirmHint')}</span>) : null}
					<span className="tool-card__status">{statusLabel(call.status)}</span>
				</span>
			</summary>
			{call.status === 'awaiting_confirm' ? (<p className="tool-card__confirm-hint">{t('chat.tool.confirmBelow')}</p>) : null}
			{showHunks ? (
				<div className="hunk-list">
					{pendingCount > 0 ? (
						<div className="hunk-list__toolbar">
							<button
								type="button"
								className="hunk__btn hunk__btn--accept"
								onClick={() => vscodeApi.postMessage({
									type: 'reviewDiff',
									toolCallId: call.id,
									action: 'acceptAll',
								})}
							>
								{t('chat.hunk.acceptAll')}
							</button>
							<button
								type="button"
								className="hunk__btn hunk__btn--reject"
								onClick={() => vscodeApi.postMessage({
									type: 'reviewDiff',
									toolCallId: call.id,
									action: 'rejectAll',
								})}
							>
								{t('chat.hunk.rejectAll')}
							</button>
						</div>
					) : null}
					{hunks.map((hunk) => (
						<HunkReview key={hunk.id} callId={call.id} hunk={hunk} />
					))}
				</div>
			) : call.diff ? (
				<DiffLinePreview preview={call.diff} />
			) : null}
			{argsPretty && !call.diff && !showHunks ? (<pre className="tool-card__block"><code>{argsPretty}</code></pre>) : null}
			{result ? (<pre className="tool-card__block tool-card__block--result"><code>{shown}</code></pre>) : null}
			{collapsed.length > RESULT_PREVIEW ? (
				<button
					className="tool-card__more"
					type="button"
					onClick={(event) => {
						event.preventDefault();
						setExpanded((v) => !v);
					}}
				>
					{expanded ? t('chat.tool.collapse') : t('chat.tool.expand')}
				</button>
			) : null}
			{hasExit ? (
				<div className="tool-card__footer">
					<span
						className={`tool-card__exit ${call.exitCode === 0 ? 'tool-card__exit--ok' : 'tool-card__exit--fail'}`}
					>
						{t('chat.tool.exit', call.exitCode!)}
					</span>
				</div>
			) : null}
		</details>
	);
}

function prettyToolArgs(raw: string | undefined): string {
	if (!raw?.trim()) {
		return '';
	}
	
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}
