import { applyPatch as jsDiffApplyPatch, parsePatch, type ParsedDiff } from 'diff';
import * as vscode from 'vscode';

export class PatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatchError';
	}
}

export type PatchMatchMode = 'exact' | 'newline' | 'whitespace';

export interface SearchReplaceResult {
	text: string;
	count: number;
	// Какой стратегией нашли old_string
	mode: PatchMatchMode;
}

export type UnifiedFileKind = 'modify' | 'add' | 'delete';

export interface UnifiedFilePatch {
	// Workspace-relative path to write (empty for pure delete of unknown path)
	path: string;
	kind: UnifiedFileKind;
	parsed: ParsedDiff;
}

export interface UnifiedApplyFileResult {
	path: string;
	kind: UnifiedFileKind;
	before: string;
	after: string;
}

// Снять a/ b/ и кавычки; /dev/null -> undefined (create/delete)
export function normalizePatchPath(fileName: string | undefined): string | undefined {
	if (!fileName) {
		return undefined;
	}

	let p = fileName.trim().replace(/\\/g, '/');
	if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
		p = p.slice(1, -1);
	}

	if (p === '/dev/null' || p === 'dev/null' || p === 'nul' || p === 'NUL') {
		return undefined;
	}

	if (/^[ab]\//.test(p)) {
		p = p.slice(2);
	}

	// git "--- a/foo\ttimestamp"
	const tab = p.indexOf('\t');
	if (tab !== -1) {
		p = p.slice(0, tab);
	}

	p = p.replace(/^\.\//, '');
	return p || undefined;
}

function fileKindFromParsed(parsed: ParsedDiff): { path: string; kind: UnifiedFileKind } {
	const oldP = normalizePatchPath(parsed.oldFileName);
	const newP = normalizePatchPath(parsed.newFileName);
	if (!oldP && newP) {
		return { path: newP, kind: 'add' };
	}

	if (oldP && !newP) {
		return { path: oldP, kind: 'delete' };
	}

	const path = newP ?? oldP ?? normalizePatchPath(parsed.index) ?? '';
	return { path, kind: 'modify' };
}

/**
 * Разобрать unified diff (один или несколько файлов).
 * Пути нормализуются (без a/b префиксов).
 */
export function parseUnifiedDiff(patchText: string): UnifiedFilePatch[] {
	const trimmed = patchText.trim();
	if (!trimmed) {
		throw new PatchError(vscode.l10n.t('patch.diffEmpty'));
	}

	const parsedList = parsePatch(trimmed);
	if (parsedList.length === 0) {
		throw new PatchError(vscode.l10n.t('patch.diffParseFailed'));
	}

	const out: UnifiedFilePatch[] = [];
	for (const parsed of parsedList) {
		const { path, kind } = fileKindFromParsed(parsed);
		if (!path) {
			throw new PatchError(vscode.l10n.t('patch.diffNoPath'));
		}
		out.push({ path, kind, parsed });
	}
	return out;
}

// Пути из unified diff (для plan guard / review)
export function pathsFromUnifiedDiff(patchText: string): string[] {
	try {
		return [...new Set(parseUnifiedDiff(patchText).map((f) => f.path))];
	} catch {
		return [];
	}
}

/**
 * Применить один file-patch к тексту.
 * fuzzFactor=0 (без слепого fuzzy); trailing whitespace на context-строках допускается.
 */
export function applyUnifiedFilePatch(
	content: string,
	file: UnifiedFilePatch,
): string {
	if (file.kind === 'add') {
		const next = jsDiffApplyPatch('', file.parsed, {
			fuzzFactor: 0,
			autoConvertLineEndings: true,
			compareLine: (_n, line, _op, patchContent) => line.trimEnd() === patchContent.trimEnd(),
		});
		if (next === false) {
			throw new PatchError(vscode.l10n.t('patch.diffApplyFailed', file.path));
		}

		return next;
	}

	if (file.kind === 'delete') {
		const next = jsDiffApplyPatch(content, file.parsed, {
			fuzzFactor: 0,
			autoConvertLineEndings: true,
			compareLine: (_n, line, _op, patchContent) => line.trimEnd() === patchContent.trimEnd(),
		});
		if (next === false) {
			throw new PatchError(vscode.l10n.t('patch.diffApplyFailed', file.path));
		}

		return next;
	}

	const next = jsDiffApplyPatch(content, file.parsed, {
		fuzzFactor: 0,
		autoConvertLineEndings: true,
		compareLine: (_n, line, _op, patchContent) => line.trimEnd() === patchContent.trimEnd(),
	});
	if (next === false) {
		throw new PatchError(vscode.l10n.t('patch.diffApplyFailed', file.path));
	}

	return next;
}

/**
 * Применить multi-file unified diff к карте path -> content.
 * Для add отсутствующий ключ = ''; для delete after = ''.
 */
export function applyUnifiedDiffToFiles(
	files: ReadonlyMap<string, string>,
	patchText: string,
): UnifiedApplyFileResult[] {
	const parsed = parseUnifiedDiff(patchText);
	const results: UnifiedApplyFileResult[] = [];

	for (const file of parsed) {
		const before = file.kind === 'add' ? '' : (files.get(file.path) ?? '');
		if (file.kind !== 'add' && !files.has(file.path) && before === '') {

		}

		const after = applyUnifiedFilePatch(before, file);
		results.push({
			path: file.path,
			kind: file.kind,
			before,
			after: file.kind === 'delete' ? '' : after,
		});
	}

	return results;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Единый LF для поиска; сохраняем стиль файла при записи new_string
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function fileUsesCrlf(content: string): boolean {
	return content.includes('\r\n');
}

function toFileNewlines(text: string, crlf: boolean): string {
	const lf = normalizeNewlines(text);
	return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

// Whitespace-flexible: пробелы/табы/переносы между токенами -> \\s+, но только если совпадение **единственное**
function findWhitespaceFlexibleMatches(content: string, oldString: string): Array<{ start: number; end: number; matched: string }> {
	const trimmed = oldString.trim();
	if (!trimmed) {
		return [];
	}

	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return [];
	}

	const pattern = tokens.map(escapeRegExp).join('\\s+');
	const re = new RegExp(pattern, 'g');
	const out: Array<{ start: number; end: number; matched: string }> = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		out.push({
			start: m.index,
			end: m.index + m[0].length,
			matched: m[0],
		});

		if (m[0].length === 0) {
			re.lastIndex += 1;
		}
	}

	return out;
}

function countExact(content: string, oldString: string): number {
	let count = 0;
	let from = 0;
	while (from <= content.length) {
		const idx = content.indexOf(oldString, from);
		if (idx === -1) {
			break;
		}
		count += 1;
		from = idx + Math.max(oldString.length, 1);
	}
	return count;
}

function replaceExact(content: string, oldString: string, newString: string, replaceAll: boolean): string {
	return replaceAll
		? content.split(oldString).join(newString)
		: content.replace(oldString, newString);
}

/**
 * Устойчивая замена old->new:
 * 1) exact
 * 2) exact после нормализации \\r\\n (с восстановлением стиля файла в new)
 * 3) unique whitespace-flexible (только одно вхождение)
 */
export function applySearchReplace(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): SearchReplaceResult {
	if (!oldString) {
		throw new PatchError(vscode.l10n.t('patch.emptyOld'));
	}

	if (oldString === newString) {
		throw new PatchError(vscode.l10n.t('patch.same'));
	}

	const crlf = fileUsesCrlf(content);

	// 1) Exact на сыром тексте
	const exactCount = countExact(content, oldString);
	if (exactCount > 0) {
		if (exactCount > 1 && !replaceAll) {
			throw new PatchError(vscode.l10n.t('patch.multiMatch', exactCount));
		}
		return {
			text: replaceExact(content, oldString, newString, replaceAll),
			count: replaceAll ? exactCount : 1,
			mode: 'exact',
		};
	}

	// 2) Exact на LF-нормализованном (типичный сбой модели: \\n vs \\r\\n)
	const contentLf = normalizeNewlines(content);
	const oldLf = normalizeNewlines(oldString);
	const newLf = normalizeNewlines(newString);
	if (oldLf !== oldString || contentLf !== content) {
		const nlCount = countExact(contentLf, oldLf);
		if (nlCount > 0) {
			if (nlCount > 1 && !replaceAll) {
				throw new PatchError(vscode.l10n.t('patch.multiMatch', nlCount));
			}

			const replacedLf = replaceExact(contentLf, oldLf, newLf, replaceAll);
			return {
				text: toFileNewlines(replacedLf, crlf),
				count: replaceAll ? nlCount : 1,
				mode: 'newline',
			};
		}
	}

	// 3) Unique whitespace-flexible (не для replace_all - слишком опасно)
	if (!replaceAll) {
		const hits = findWhitespaceFlexibleMatches(contentLf, oldLf);
		if (hits.length === 1) {
			const hit = hits[0]!;
			const nextLf = contentLf.slice(0, hit.start) + newLf + contentLf.slice(hit.end);
			return {
				text: toFileNewlines(nextLf, crlf),
				count: 1,
				mode: 'whitespace',
			};
		}
		if (hits.length > 1) {
			throw new PatchError(vscode.l10n.t('patch.multiMatch', hits.length));
		}
	}

	throw new PatchError(vscode.l10n.t('patch.notFoundHint'));
}

// Применить несколько search-replace к одному буферу по порядку (цепочка)
export function applySearchReplaceChain(
	content: string,
	edits: ReadonlyArray<{ old_string: string; new_string: string; replace_all?: boolean }>,
): { text: string; totalCount: number; modes: PatchMatchMode[] } {
	let text = content;
	let totalCount = 0;
	const modes: PatchMatchMode[] = [];
	for (const edit of edits) {
		const next = applySearchReplace(text, edit.old_string, edit.new_string, Boolean(edit.replace_all));
		text = next.text;
		totalCount += next.count;
		modes.push(next.mode);
	}
	
	return { text, totalCount, modes };
}
