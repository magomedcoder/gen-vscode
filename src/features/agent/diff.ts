import * as vscode from 'vscode';
import { extractPathFromPartialJson } from './types';

const CONTEXT = 2;
const MAX_LINES = 80;
const MAX_LCS_CELLS = 1_500_000;
const MAX_HUNKS = 40;

export interface DiffHunk {
	// Индекс строки (с 0) в тексте до правки
	oldStart: number;
	// Индекс строки (с 0) в тексте после правки
	newStart: number;
	oldLines: string[];
	newLines: string[];
	// Последняя неизменённая строка сразу перед хунком (для чистых удалений)
	beforeContext?: string;
	// Первая неизменённая строка сразу после хунка
	afterContext?: string;
}

export interface MiniDiff {
	text: string;
	hunks: DiffHunk[];
}

function joinLines(lines: readonly string[]): string {
	return lines.join('\n');
}

function formatHunkPreview(hunk: DiffHunk, ctxBefore: string[], ctxAfter: string[]): string {
	const lines: string[] = [];
	for (const line of ctxBefore) {
		lines.push(` ${line}`);
	}

	for (const line of hunk.oldLines) {
		lines.push(`-${line}`);
	}

	for (const line of hunk.newLines) {
		lines.push(`+${line}`);
	}

	for (const line of ctxAfter) {
		lines.push(` ${line}`);
	}

	return lines.join('\n');
}

// Один сплошной блок изменений (общий префикс/суффикс отброшен)
function singleBlockDiff(a: string[], b: string[]): DiffHunk[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start += 1;
	}

	let aEnd = a.length - 1;
	let bEnd = b.length - 1;
	while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
		aEnd -= 1;
		bEnd -= 1;
	}

	if (start > aEnd && start > bEnd) {
		return [];
	}

	const oldLines = a.slice(start, aEnd + 1);
	const newLines = b.slice(start, bEnd + 1);
	return [{
		oldStart: start,
		newStart: start,
		oldLines,
		newLines,
		beforeContext: start > 0 ? a[start - 1] : undefined,
		afterContext: aEnd + 1 < a.length ? a[aEnd + 1] : undefined,
	}];
}

function lcsHunks(a: string[], b: string[]): DiffHunk[] {
	const m = a.length;
	const n = b.length;
	const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
	for (let i = m - 1; i >= 0; i -= 1) {
		for (let j = n - 1; j >= 0; j -= 1) {
			dp[i][j] = a[i] === b[j]
				? (dp[i + 1][j + 1] + 1) as number
				: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const ops: Array<{ kind: 'eq' | 'del' | 'add'; line: string; ai: number; bi: number }> = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			ops.push({ kind: 'eq', line: a[i], ai: i, bi: j });
			i += 1;
			j += 1;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ kind: 'del', line: a[i], ai: i, bi: j });
			i += 1;
		} else {
			ops.push({ kind: 'add', line: b[j], ai: i, bi: j });
			j += 1;
		}
	}

	while (i < m) {
		ops.push({ kind: 'del', line: a[i], ai: i, bi: j });
		i += 1;
	}

	while (j < n) {
		ops.push({ kind: 'add', line: b[j], ai: i, bi: j });
		j += 1;
	}

	const hunks: DiffHunk[] = [];
	let k = 0;
	while (k < ops.length) {
		while (k < ops.length && ops[k].kind === 'eq') {
			k += 1;
		}
		if (k >= ops.length) {
			break;
		}

		const oldStart = ops[k].ai;
		const newStart = ops[k].bi;
		const oldLines: string[] = [];
		const newLines: string[] = [];
		while (k < ops.length && ops[k].kind !== 'eq') {
			if (ops[k].kind === 'del') {
				oldLines.push(ops[k].line);
			} else {
				newLines.push(ops[k].line);
			}
			k += 1;
		}

		const beforeContext = oldStart > 0 ? a[oldStart - 1] : undefined;
		const afterIdx = oldStart + oldLines.length;
		const afterContext = afterIdx < a.length ? a[afterIdx] : undefined;
		hunks.push({
			oldStart,
			newStart,
			oldLines,
			newLines,
			beforeContext,
			afterContext,
		});
	}

	if (hunks.length <= MAX_HUNKS) {
		return hunks;
	}

	const keep = hunks.slice(0, MAX_HUNKS - 1);
	const firstRest = hunks[MAX_HUNKS - 1];
	const merged = singleBlockDiff(a.slice(firstRest.oldStart), b.slice(firstRest.newStart));
	if (!merged[0]) {
		return keep;
	}

	return [
		...keep,
		{
			...merged[0],
			oldStart: firstRest.oldStart + merged[0].oldStart,
			newStart: firstRest.newStart + merged[0].newStart,
			beforeContext: firstRest.beforeContext,
		},
	];
}

function computeHunks(before: string, after: string): DiffHunk[] {
	if (before === after) {
		return [];
	}

	const a = before.split('\n');
	const b = after.split('\n');
	if (a.length * b.length > MAX_LCS_CELLS) {
		return singleBlockDiff(a, b);
	}

	return lcsHunks(a, b);
}

function buildPreviewText(before: string, after: string, hunks: DiffHunk[]): string {
	if (hunks.length === 0) {
		return '';
	}

	const a = before.split('\n');
	const parts: string[] = [];
	let used = 0;

	for (let hi = 0; hi < hunks.length; hi += 1) {
		const hunk = hunks[hi];
		const ctxStart = Math.max(0, hunk.oldStart - CONTEXT);
		const ctxBefore = a.slice(ctxStart, hunk.oldStart);
		const afterLine = hunk.oldStart + hunk.oldLines.length;
		const ctxEnd = Math.min(a.length, afterLine + CONTEXT);
		const ctxAfter = a.slice(afterLine, ctxEnd);
		const preview = formatHunkPreview(hunk, ctxBefore, ctxAfter);
		const previewLines = preview.split('\n');

		if (used + previewLines.length > MAX_LINES) {
			const room = Math.max(0, MAX_LINES - used);
			if (room > 0) {
				parts.push(previewLines.slice(0, room).join('\n'));
			}
			const remaining = hunks.length - hi;
			parts.push(vscode.l10n.t('diff.linesHidden', Math.max(1, remaining)));
			break;
		}

		parts.push(preview);
		used += previewLines.length;
		if (hi < hunks.length - 1) {
			parts.push('');
			used += 1;
		}
	}

	return parts.join('\n');
}

export function computeMiniDiff(before: string, after: string): MiniDiff {
	const hunks = computeHunks(before, after);
	return {
		hunks,
		text: buildPreviewText(before, after, hunks),
	};
}

export function formatMiniDiff(before: string, after: string): string {
	return computeMiniDiff(before, after).text;
}

export type HunkReviewStatus = 'pending' | 'accepted' | 'rejected';

export interface DiffHunkPayload {
	id: string;
	path?: string;
	oldStart: number;
	newStart: number;
	preview: string;
	status: HunkReviewStatus;
	oldLines: string[];
	newLines: string[];
	beforeContext?: string;
	afterContext?: string;
}

export function toDiffHunkPayloads(
	hunks: readonly DiffHunk[],
	before: string,
	options?: { path?: string; idPrefix?: string },
): DiffHunkPayload[] {
	const a = before.split('\n');
	const prefix = options?.idPrefix ?? 'h';
	return hunks.map((hunk, index) => {
		const ctxStart = Math.max(0, hunk.oldStart - CONTEXT);
		const ctxBefore = a.slice(ctxStart, hunk.oldStart);
		const afterLine = hunk.oldStart + hunk.oldLines.length;
		const ctxEnd = Math.min(a.length, afterLine + CONTEXT);
		const ctxAfter = a.slice(afterLine, ctxEnd);
		return {
			id: `${prefix}-${index}`,
			path: options?.path,
			oldStart: hunk.oldStart + 1,
			newStart: hunk.newStart + 1,
			preview: formatHunkPreview(hunk, ctxBefore, ctxAfter),
			// После apply запись уже на диске; post-apply Accept/Reject в чате отключён.
			// Permission спрашивается до вызова tool (ConfirmCard), не по hunk'ам.
			status: 'accepted' as const,
			oldLines: hunk.oldLines,
			newLines: hunk.newLines,
			beforeContext: hunk.beforeContext,
			afterContext: hunk.afterContext,
		};
	});
}

// Откатить хунк в текущем тексте файла. undefined - если применённое изменение уже не найти
export function revertHunkInText(
	current: string,
	hunk: Pick<DiffHunk, 'oldLines' | 'newLines' | 'beforeContext' | 'afterContext'>,
): string | undefined {
	const oldText = joinLines(hunk.oldLines);
	const newText = joinLines(hunk.newLines);

	if (newText.length > 0) {
		const idx = current.indexOf(newText);
		if (idx < 0) {
			return undefined;
		}

		return `${current.slice(0, idx)}${oldText}${current.slice(idx + newText.length)}`;
	}

	// Чистое удаление: вернуть oldText между строками контекста.
	if (oldText.length === 0) {
		return current;
	}

	const before = hunk.beforeContext;
	const after = hunk.afterContext;
	if (before !== undefined && after !== undefined) {
		const bridge = `${before}\n${after}`;
		const idx = current.indexOf(bridge);
		if (idx < 0) {
			return undefined;
		}

		const insertAt = idx + before.length + 1;
		return `${current.slice(0, insertAt)}${oldText}\n${current.slice(insertAt)}`;
	}

	if (before !== undefined) {
		const idx = current.indexOf(before);
		if (idx < 0) {
			return undefined;
		}

		const insertAt = idx + before.length;
		const suffix = current.slice(insertAt);
		if (suffix.startsWith('\n') || suffix.length === 0) {
			return `${current.slice(0, insertAt)}\n${oldText}${suffix}`;
		}

		return undefined;
	}

	if (after !== undefined) {
		const idx = current.indexOf(after);
		if (idx < 0) {
			return undefined;
		}

		return `${current.slice(0, idx)}${oldText}\n${current.slice(idx)}`;
	}

	// Откат добавления всего файла -> пустой файл
	if (current === newText || (newText === '' && current === oldText)) {
		return oldText;
	}

	return undefined;
}

export function pathFromToolArguments(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw.trim() || '{}') as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return extractPathFromPartialJson(raw);
		}

		const obj = parsed as Record<string, unknown>;
		if (typeof obj.path === 'string' && obj.path.trim()) {
			return obj.path.trim();
		}

		if (Array.isArray(obj.edits)) {
			const paths = obj.edits.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
				.map((item) => item.path)
				.filter((p): p is string => typeof p === 'string' && Boolean(p.trim()));

			if (paths.length === 0) {
				return undefined;
			}

			return [...new Set(paths)].join(', ');
		}

		if (Array.isArray(obj.steps)) {
			const paths = obj.steps.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
				.map((item) => item.path)
				.filter((p): p is string => typeof p === 'string' && Boolean(p.trim()));

			if (paths.length === 0) {
				return undefined;
			}

			return [...new Set(paths)].join(', ');
		}
	} catch {
		return extractPathFromPartialJson(raw);
	}

	return extractPathFromPartialJson(raw);
}
