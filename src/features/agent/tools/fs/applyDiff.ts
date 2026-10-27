import * as vscode from 'vscode';
import { computeMiniDiff, toDiffHunkPayloads } from '../../diff';
import { applyUnifiedDiffToFiles, applyUnifiedFilePatch, parseUnifiedDiff} from '../../patch';
import type { UnifiedFilePatch } from '../../patch';
import { AGENT_LIMITS } from '../../policy';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, withForcedConfirm } from '../confirm';
import { enhanceSuccessfulWrite } from '../postEdit';
import { appendFreshFileReads, appendPatchFailRecovery } from '../patchFailRead';

const MAX_DIFF_FILES = 20;
const MAX_FAIL_READ_CHARS = 6_000;

async function loadFileText(uri: vscode.Uri): Promise<string> {
	const doc = await vscode.workspace.openTextDocument(uri);
	return doc.getText();
}

type PrepareDiffFail = {
	ok: false;
	content: string;
	paths: string[];
	failedRelative?: string;
	failedBefore?: string;
	failedFile?: UnifiedFilePatch;
};

async function prepareDiff(
	files: UnifiedFilePatch[],
): Promise<{
	ok: true;
	prepared: Array<{
		file: UnifiedFilePatch;
		uri: vscode.Uri;
		relative: string;
		before: string;
		after: string;
		userDiff?: string;
	}>;
} | PrepareDiffFail> {
	const prepared: Array<{
		file: UnifiedFilePatch;
		uri: vscode.Uri;
		relative: string;
		before: string;
		after: string;
		userDiff?: string;
	}> = [];
	const paths: string[] = [];

	for (const file of files) {
		const resolved = await resolveWorkspacePath(file.path);
		paths.push(resolved.relative);
		const exists = await pathExists(resolved.uri);

		if (file.kind === 'add' && exists) {
		
		}

		if (file.kind !== 'add' && !exists) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
				paths,
			};
		}

		const before = file.kind === 'add' && !exists
			? ''
			: await loadFileText(resolved.uri);

		if (new TextEncoder().encode(before).byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileTooLargeForPatch', resolved.relative),
				paths,
			};
		}

		let after: string;
		try {
			after = applyUnifiedFilePatch(before, file);
			if (file.kind === 'delete') {
				after = '';
			}
		} catch (err) {
			return {
				ok: false,
				content: `${resolved.relative}: ${err instanceof Error ? err.message : String(err)}`,
				paths,
				failedRelative: resolved.relative,
				failedBefore: before,
				failedFile: file,
			};
		}

		if (file.kind !== 'delete') {
			const encoded = new TextEncoder().encode(after);
			if (encoded.byteLength > AGENT_LIMITS.maxWriteBytes) {
				return {
					ok: false,
					content: vscode.l10n.t('tool.resultTooLarge', resolved.relative),
					paths,
				};
			}
		}

		prepared.push({
			file,
			uri: resolved.uri,
			relative: resolved.relative,
			before,
			after,
		});
	}

	return { ok: true, prepared };
}

export const applyDiffTool: ToolDefinition = {
	name: 'apply_diff',
	description: 'Основной способ правок: применить unified diff (как git apply) к одному или нескольким файлам. Аргумент patch - полный diff с ---/+++ и @@ hunks. Для мелкой точечной замены можно apply_patch (old_string/new_string). Не используй слепой fuzzy: контекст hunks должен совпадать с файлом.',
	parameters: {
		type: 'object',
		properties: {
			patch: {
				type: 'string',
				description: 'Unified diff (один или несколько файлов). Пути относительно workspace; допускаются префиксы a/ и b/. Новые файлы: --- /dev/null; удаление: +++ /dev/null.',
			},
		},
		required: ['patch'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const patchText = asString(args, 'patch');
		if (!patchText.trim()) {
			return {
				ok: false,
				content: vscode.l10n.t('patch.diffEmpty'),
				retryable: false,
				category: 'validation',
			};
		}

		let files: UnifiedFilePatch[];
		try {
			files = parseUnifiedDiff(patchText);
		} catch (err) {
			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err),
				retryable: false,
				category: 'validation',
			};
		}

		if (files.length > MAX_DIFF_FILES) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.tooManyEdits', files.length, MAX_DIFF_FILES),
				retryable: false,
				category: 'validation',
			};
		}

		const failResult = async (fail: PrepareDiffFail): Promise<ToolResult> => {
			const path = fail.failedRelative ?? fail.paths[fail.paths.length - 1] ?? fail.paths.join(', ');
			const content = fail.failedFile && typeof fail.failedBefore === 'string' && fail.failedRelative
				? await appendPatchFailRecovery({
					errorMessage: fail.content,
					relativePath: fail.failedRelative,
					fileContent: fail.failedBefore,
					unifiedFile: fail.failedFile,
					maxTotalChars: MAX_FAIL_READ_CHARS,
				})
				: await appendFreshFileReads(fail.content, fail.paths, MAX_FAIL_READ_CHARS);
			return {
				ok: false,
				path,
				content,
				retryable: true,
				category: 'execution',
				code: 'diff_apply_failed',
			};
		};

		// 1) dry-run на текущих буферах
		let first = await prepareDiff(files);
		if (!first.ok) {
			return failResult(first);
		}

		for (const item of first.prepared) {
			item.userDiff = ctx.writes?.userDiff(item.uri, item.before);
		}

		const drifted = first.prepared.filter((p) => p.userDiff);
		if (drifted.length > 0) {
			const detail = drifted.map((p) => `${p.relative}:\n${p.userDiff}`).join('\n\n');
			const denied = await withForcedConfirm(ctx, () => confirmAlwaysOrSkip(
				ctx,
				vscode.l10n.t('agent.overwriteUserEditsBatchTitle', drifted.length),
				`${vscode.l10n.t('agent.overwriteUserEditsDetail')}\n\n${detail}`,
			));
			if (denied) {
				return {
					...denied,
					path: first.prepared.map((p) => p.relative).join(', '),
				};
			}
		}

		// 2) одна retry: перечитать файлы и применить снова (гонка / stale buffer)
		let second = await prepareDiff(files);
		if (!second.ok) {
			return failResult(second);
		}

		const ws = new vscode.WorkspaceEdit();
		for (const item of second.prepared) {
			throwIfAborted(ctx.signal);
			if (item.file.kind === 'delete') {
				ws.deleteFile(item.uri, { ignoreIfNotExists: true });
				continue;
			}

			if (item.file.kind === 'add' && !(await pathExists(item.uri))) {
				ws.createFile(item.uri, {
					ignoreIfExists: true,
					contents: new TextEncoder().encode(item.after),
				});
				continue;
			}

			const doc = await vscode.workspace.openTextDocument(item.uri);
			const last = Math.max(0, doc.lineCount - 1);
			ws.replace(doc.uri, new vscode.Range(0, 0, last, doc.lineAt(last).text.length), item.after);
		}

		const applied = await vscode.workspace.applyEdit(ws);
		if (!applied) {
			const paths = second.prepared.map((p) => p.relative);
			const withReads = await appendFreshFileReads(
				vscode.l10n.t('tool.workspaceEditFailed'),
				paths,
				MAX_FAIL_READ_CHARS,
			);
			return {
				ok: false,
				path: paths.join(', '),
				content: withReads,
				retryable: true,
				category: 'execution',
			};
		}

		if (ctx.revealFile && second.prepared[0]) {
			await ctx.revealFile(second.prepared[0]!.uri);
		}

		const fileDiffs = second.prepared.map((p) => ({
			relative: p.relative,
			mini: computeMiniDiff(p.before, p.after),
			before: p.before,
		}));
		const hunks = fileDiffs.flatMap((item, fileIndex) => toDiffHunkPayloads(item.mini.hunks, item.before, {
			path: item.relative,
			idPrefix: `d${fileIndex}`,
		}));

		for (const item of second.prepared) {
			if (item.file.kind === 'delete') {
				ctx.writes?.remember(item.uri, item.relative, '');
				ctx.trackMutation?.(item.uri);
				continue;
			}
			await ctx.checkpoint?.remember(item.uri, item.relative, item.before);
			ctx.writes?.remember(item.uri, item.relative, item.after);
			ctx.trackMutation?.(item.uri);
		}

		const note = drifted.length > 0 ? vscode.l10n.t('tool.userEditsNotedBatch') : '';
		const summary = second.prepared.map((p) => `${p.relative} (${p.file.kind})`).join('\n');
		const result: ToolResult = {
			ok: true,
			path: second.prepared.map((p) => p.relative).join(', '),
			diff: fileDiffs.map((item) => `--- ${item.relative}\n${item.mini.text}`).join('\n\n'),
			hunks,
			content: vscode.l10n.t('tool.diffApplied', second.prepared.length, summary, note),
		};

		const uris = second.prepared.filter((p) => p.file.kind !== 'delete').map((p) => p.uri);
		return uris.length > 0 ? enhanceSuccessfulWrite(result, uris, ctx) : result;
	},
};

// Для review preview без записи
export function previewUnifiedDiff(
	patchText: string,
	files: ReadonlyMap<string, string>,
): ReturnType<typeof applyUnifiedDiffToFiles> | undefined {
	try {
		return applyUnifiedDiffToFiles(files, patchText);
	} catch {
		return undefined;
	}
}
