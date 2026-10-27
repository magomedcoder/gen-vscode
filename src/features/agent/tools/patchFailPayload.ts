import type { UnifiedFilePatch } from '../patch';

const SLICE_RADIUS = 18;
const MAX_HUNK_CHARS = 2_500;
const MAX_SLICE_CHARS = 3_500;

type PatchHunkLike = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
};

export type FailedHunkDiagnosis = {
	hunkIndex: number;
	hunkText: string;
	// 0-based line в файле, где контекст перестал совпадать (если известно)
	mismatchLine?: number;
	sliceStart: number;
	sliceEnd: number;
	sliceText: string;
};

function formatHunkUnified(hunk: PatchHunkLike): string {
	const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
	const body = (hunk.lines ?? []).join('\n');
	let text = `${header}\n${body}`;
	if (text.length > MAX_HUNK_CHARS) {
		text = `${text.slice(0, MAX_HUNK_CHARS)}\n...`;
	}

	return text;
}

function numberSlice(lines: readonly string[], start: number, end: number): string {
	const out: string[] = [];
	for (let i = start; i < end; i += 1) {
		out.push(`${String(i + 1).padStart(6, ' ')}|${lines[i] ?? ''}`);
	}

	let text = out.join('\n');
	if (text.length > MAX_SLICE_CHARS) {
		text = `${text.slice(0, MAX_SLICE_CHARS)}\n...`;
	}

	return text;
}

// Найти первый hunk, чей old-контекст не совпадает с файлом (fuzzFactor=0, trimEnd как в apply)
export function diagnoseFailedHunk(
	fileContent: string,
	file: UnifiedFilePatch,
): FailedHunkDiagnosis | undefined {
	const hunks = file.parsed.hunks ?? [];
	if (hunks.length === 0) {
		return undefined;
	}

	const fileLines = fileContent.split(/\r?\n/);
	const matchLine = (fileLine: string, patchBody: string) =>
		fileLine.trimEnd() === patchBody.trimEnd();

	for (let hi = 0; hi < hunks.length; hi += 1) {
		const hunk = hunks[hi]!;
		let fi = Math.max(0, (hunk.oldStart ?? 1) - 1);
		// add с oldStart=0: нет old-контекста для сверки
		if (file.kind === 'add' && (hunk.oldLines ?? 0) === 0) {
			continue;
		}

		for (const raw of hunk.lines ?? []) {
			const tag = raw.charAt(0);
			const body = raw.slice(1);
			if (tag === '+') {
				continue;
			}

			// ' ' или '-' должны совпасть с текущей строкой файла
			if (fi >= fileLines.length || !matchLine(fileLines[fi]!, body)) {
				const mismatchLine = Math.min(fi, Math.max(0, fileLines.length - 1));
				const sliceStart = Math.max(0, mismatchLine - SLICE_RADIUS);
				const sliceEnd = Math.min(fileLines.length, mismatchLine + SLICE_RADIUS + 1);
				return {
					hunkIndex: hi,
					hunkText: formatHunkUnified(hunk),
					mismatchLine,
					sliceStart,
					sliceEnd,
					sliceText: numberSlice(fileLines, sliceStart, sliceEnd),
				};
			}
			fi += 1;
		}
	}

	// Все hunks локально совпали, но apply всё равно упал - показать первый + срез у oldStart
	const hunk = hunks[0]!;
	const center = Math.max(0, (hunk.oldStart ?? 1) - 1);
	const sliceStart = Math.max(0, center - SLICE_RADIUS);
	const sliceEnd = Math.min(fileLines.length, center + SLICE_RADIUS + 1);
	return {
		hunkIndex: 0,
		hunkText: formatHunkUnified(hunk),
		mismatchLine: center,
		sliceStart,
		sliceEnd,
		sliceText: numberSlice(fileLines, sliceStart, sliceEnd),
	};
}

// Для search-replace: old_string как «failed hunk» + срез вокруг первого похожего места
export function diagnoseSearchReplaceFail(
	fileContent: string,
	oldString: string,
): FailedHunkDiagnosis {
	const fileLines = fileContent.split(/\r?\n/);
	const needle = oldString.split(/\r?\n/)[0]?.trim() ?? '';
	let center = 0;
	if (needle) {
		const idx = fileLines.findIndex((l) => l.includes(needle) || needle.includes(l.trim()));
		if (idx >= 0) {
			center = idx;
		}
	}
	const sliceStart = Math.max(0, center - SLICE_RADIUS);
	const sliceEnd = Math.min(fileLines.length, center + SLICE_RADIUS + 1);
	let hunkText = oldString;
	if (hunkText.length > MAX_HUNK_CHARS) {
		hunkText = `${hunkText.slice(0, MAX_HUNK_CHARS)}\n...`;
	}

	return {
		hunkIndex: 0,
		hunkText,
		mismatchLine: center,
		sliceStart,
		sliceEnd,
		sliceText: numberSlice(fileLines, sliceStart, sliceEnd),
	};
}

export function formatPatchFailConstraint(paths: readonly string[]): string {
	const list = paths.length > 0 ? paths.join(', ') : '(failed path)';
	return [
		'### Patch fail - ограничение следующего вызова',
		`paths: ${list}`,
		'Следующий вызов tool ОБЯЗАН быть одним из: apply_diff | edit_file | apply_patch.',
		'Только failed paths выше. Не вызывай write_file на весь файл. Не повторяй тот же падающий hunk без правок.',
		'Исправь hunk по file_slice ниже и повтори один раз.',
	].join('\n');
}

// User-nudge для одного auto model-retry turn после patch fail
export function buildPatchFailAutoRetryPrompt(paths: readonly string[]): string {
	const list = paths.length > 0 ? paths.join(', ') : '(failed path)';
	return [
		`apply_diff/apply_patch не применился к: ${list}.`,
		'В tool result уже есть failed_hunk + file_slice и constraint.',
		'Сейчас сделай ровно один вызов: apply_diff или edit_file или apply_patch только по этим paths.',
		'Не пиши write_file целиком и не вызывай другие tools в этом ходе.',
	].join(' ');
}

export function formatStructuredPatchFail(params: {
	errorMessage: string;
	path: string;
	diagnosis?: FailedHunkDiagnosis;
}): string {
	const parts: string[] = [
		params.errorMessage,
		'',
		formatPatchFailConstraint([params.path]),
	];

	if (params.diagnosis) {
		parts.push(
			'',
			`### failed_hunk (index ${params.diagnosis.hunkIndex})`,
			'```diff',
			params.diagnosis.hunkText,
			'```',
			'',
			`### file_slice ${params.path} (lines ${params.diagnosis.sliceStart + 1}-${params.diagnosis.sliceEnd})`,
			params.diagnosis.sliceText,
		);
	}

	return parts.join('\n');
}

// Tools, разрешённые на auto-retry после patch fail
export const PATCH_FAIL_RETRY_TOOLS = ['apply_diff', 'edit_file', 'apply_patch'] as const;

export function isPatchFailRetryCode(code: string | undefined): boolean {
	return code === 'diff_apply_failed' || code === 'patch_not_found' || code === 'patch_stale';
}
