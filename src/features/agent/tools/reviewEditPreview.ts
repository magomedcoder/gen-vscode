import { formatMiniDiff } from '../diff';
import { applySearchReplace, applySearchReplaceChain, pathsFromUnifiedDiff } from '../patch';
import type { ApprovalActionType, PermissionDecision } from '../permissionPolicy';
import { previewUnifiedDiff } from './fs/applyDiff';
import { parseWorkspaceEdits } from './fs/applyWorkspaceEdit';

export interface EditReviewEntry {
	path: string;
	before: string;
	after: string;
}

// Policy `review` для edits: явный Accept с diff, не эвристический allow
export function needsReviewDiffConfirm(
	decision: PermissionDecision,
	action: ApprovalActionType | undefined,
): boolean {
	return decision === 'review' && action === 'edits';
}

// Пути файлов из args edit-tools (для подгрузки before-снимков)
export function editPathsFromToolArgs(toolName: string, args: Record<string, unknown>): string[] {
	if (toolName === 'apply_workspace_edit') {
		const paths = parseWorkspaceEdits(args)
			.map((e) => e.path.trim())
			.filter(Boolean);
		return [...new Set(paths)];
	}

	if (toolName === 'apply_diff' && typeof args.patch === 'string') {
		return pathsFromUnifiedDiff(args.patch);
	}

	if (typeof args.path === 'string' && args.path.trim()) {
		return [args.path.trim()];
	}

	return [];
}

/**
 * Строит before/after для review preview без записи на диск.
 * `files` - текущее содержимое по path из args (нет ключа = новый файл).
 */
export function buildEditReviewEntriesFromArgs(
	toolName: string,
	args: Record<string, unknown>,
	files: ReadonlyMap<string, string>,
): EditReviewEntry[] | undefined {
	if (toolName === 'write_file') {
		const path = typeof args.path === 'string' ? args.path.trim() : '';
		const content = typeof args.content === 'string' ? args.content : undefined;
		if (!path || content === undefined) {
			return undefined;
		}

		return [{
			path,
			before: files.get(path) ?? '',
			after: content,
		}];
	}

	if (toolName === 'apply_diff') {
		const patch = typeof args.patch === 'string' ? args.patch : '';
		if (!patch.trim()) {
			return undefined;
		}
		
		const preview = previewUnifiedDiff(patch, files);
		if (!preview || preview.length === 0) {
			return undefined;
		}

		return preview.map((item) => ({
			path: item.path,
			before: item.before,
			after: item.after,
		}));
	}

	if (toolName === 'apply_patch') {
		return buildPatchEntry(args, files);
	}

	if (toolName === 'edit_file') {
		const hasOld = typeof args.old_string === 'string';
		const hasContent = typeof args.content === 'string';
		if (hasOld && !hasContent) {
			return buildPatchEntry(args, files);
		}

		if (hasContent && !hasOld) {
			const path = typeof args.path === 'string' ? args.path.trim() : '';
			if (!path) {
				return undefined;
			}

			return [{
				path,
				before: files.get(path) ?? '',
				after: args.content as string,
			}];
		}

		return undefined;
	}

	if (toolName === 'apply_workspace_edit') {
		const edits = parseWorkspaceEdits(args);
		if (edits.length === 0) {
			return undefined;
		}

		const byPath = new Map<string, string>();
		for (const path of editPathsFromToolArgs(toolName, args)) {
			byPath.set(path, files.get(path) ?? '');
		}

		const editsByPath = new Map<string, typeof edits>();
		for (const edit of edits) {
			const path = edit.path.trim();
			if (!path || !edit.old_string) {
				return undefined;
			}
			const list = editsByPath.get(path) ?? [];
			list.push(edit);
			editsByPath.set(path, list);
		}

		const entries: EditReviewEntry[] = [];
		for (const [path, pathEdits] of editsByPath) {
			const original = files.get(path) ?? byPath.get(path) ?? '';
			try {
				const next = applySearchReplaceChain(original, pathEdits);
				if (original !== next.text) {
					entries.push({ path, before: original, after: next.text });
				}
			} catch {
				return undefined;
			}
		}

		return entries.length > 0 ? entries : undefined;
	}

	if (toolName === 'create_dir') {
		const path = typeof args.path === 'string' ? args.path.trim() : '';
		if (!path) {
			return undefined;
		}

		return [{
			path,
			before: '',
			after: `<directory ${path}>`,
		}];
	}

	return undefined;
}

function buildPatchEntry(
	args: Record<string, unknown>,
	files: ReadonlyMap<string, string>,
): EditReviewEntry[] | undefined {
	const path = typeof args.path === 'string' ? args.path.trim() : '';
	const oldString = typeof args.old_string === 'string' ? args.old_string : undefined;
	const newString = typeof args.new_string === 'string' ? args.new_string : undefined;
	if (!path || oldString === undefined || newString === undefined) {
		return undefined;
	}

	const before = files.get(path) ?? '';
	try {
		const next = applySearchReplace(before, oldString, newString, Boolean(args.replace_all));
		return [{ path, before, after: next.text }];
	} catch {
		return undefined;
	}
}

// Unified / side summary для ConfirmCard до Apply
export function formatEditReviewPreview(entries: readonly EditReviewEntry[], maxChars = 4_000): string {
	if (entries.length === 0) {
		return '';
	}

	const parts: string[] = [];
	for (const entry of entries) {
		const kind = entry.before === '' && entry.after !== ''
			? 'new'
			: entry.after === '' && entry.before !== ''
				? 'delete'
				: 'edit';
		const label = kind === 'new'
			? `+++ ${entry.path} (новый)`
			: kind === 'delete'
				? `--- ${entry.path} (удаление)`
				: `--- a/${entry.path}\n+++ b/${entry.path}`;
		const body = formatMiniDiff(entry.before, entry.after);
		parts.push(body.trim() ? `${label}\n${body}` : label);
	}

	const text = parts.join('\n\n');
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, maxChars)}\n...`;
}
