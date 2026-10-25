import * as vscode from 'vscode';
import { computeMiniDiff, toDiffHunkPayloads } from '../../diff';
import { applySearchReplace } from '../../patch';
import { AGENT_LIMITS } from '../../policy';
import { asBoolean, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, withForcedConfirm } from '../confirm';
import { appendFreshFileReads } from '../patchFailRead';
import { enhanceSuccessfulWrite } from '../postEdit';

export const applyPatchTool: ToolDefinition = {
	name: 'apply_patch',
	description: 'Точечная правка файла: заменить old_string на new_string по актуальному содержимому (exact, затем нормализация переносов, затем unique whitespace-match). Для нового файла используйте write_file. Не откатывай правки пользователя без явной необходимости.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к существующему файлу',
			},
			old_string: {
				type: 'string',
				description: 'Уникальный фрагмент, который нужно заменить',
			},
			new_string: {
				type: 'string',
				description: 'Новый фрагмент',
			},
			replace_all: {
				type: 'boolean',
				description: 'Заменить все вхождения (по умолчанию false)',
			},
		},
		required: ['path', 'old_string', 'new_string'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		if (!(await pathExists(resolved.uri))) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
			};
		}

		const oldString = asString(args, 'old_string');
		const newString = asString(args, 'new_string');
		const replaceAll = asBoolean(args, 'replace_all');

		let doc = await vscode.workspace.openTextDocument(resolved.uri);
		if (new TextEncoder().encode(doc.getText()).byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileTooLargeForPatch', resolved.relative),
			};
		}

		let original = doc.getText();
		const userDiffBefore = ctx.writes?.userDiff(resolved.uri, original);

		let next: {
			text: string;
			count: number
		};
		try {
			next = applySearchReplace(original, oldString, newString, replaceAll);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				path: resolved.relative,
				content: await appendFreshFileReads(msg, [resolved.relative], 6_000),
				retryable: true,
				category: 'execution',
				code: 'patch_not_found',
			};
		}

		const encoded = new TextEncoder().encode(next.text);
		if (encoded.byteLength > AGENT_LIMITS.maxWriteBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.patchResultTooLarge'),
			};
		}

		// Обычный ask/review - только central confirm. Здесь лишь конфликт с правками пользователя.
		if (userDiffBefore) {
			const denied = await withForcedConfirm(ctx, () => confirmAlwaysOrSkip(
				ctx,
				vscode.l10n.t('agent.overwriteUserEditsTitle', resolved.relative),
				`${vscode.l10n.t('agent.overwriteUserEditsDetail')}\n\n${userDiffBefore}`,
			));
			if (denied) {
				return {
					...denied,
					path: resolved.relative,
				};
			}
		}

		doc = await vscode.workspace.openTextDocument(resolved.uri);
		original = doc.getText();
		try {
			next = applySearchReplace(original, oldString, newString, replaceAll);
		} catch (err) {
			const stale = vscode.l10n.t('tool.patchStale', err instanceof Error ? err.message : String(err));
			return {
				ok: false,
				path: resolved.relative,
				content: await appendFreshFileReads(stale, [resolved.relative], 6_000),
				retryable: true,
				category: 'execution',
				code: 'patch_stale',
			};
		}

		const last = Math.max(0, doc.lineCount - 1);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(0, 0, last, doc.lineAt(last).text.length), next.text);
		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.patchApplyFailed', resolved.relative),
			};
		}

		await ctx.checkpoint?.remember(doc.uri, resolved.relative, original);
		ctx.writes?.remember(doc.uri, resolved.relative, next.text);
		ctx.trackMutation?.(doc.uri);
		if (ctx.revealFile) {
			await ctx.revealFile(doc.uri);
		}

		const note = userDiffBefore ? vscode.l10n.t('tool.userEditsNotedPatch') : '';
		const mini = computeMiniDiff(original, next.text);

		return enhanceSuccessfulWrite({
			ok: true,
			path: resolved.relative,
			diff: mini.text,
			hunks: toDiffHunkPayloads(mini.hunks, original, {
				path: resolved.relative
			}),
			content: vscode.l10n.t('tool.patchApplied', resolved.relative, next.count, note),
		}, doc.uri, ctx);
	},
};
