import * as vscode from 'vscode';
import { computeMiniDiff, toDiffHunkPayloads } from '../../diff';
import { applySearchReplaceChain } from '../../patch';
import { AGENT_LIMITS } from '../../policy';
import { asBoolean, asObjectArray, asString } from '../../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, withForcedConfirm } from '../confirm';
import { appendFreshFileReads } from '../patchFailRead';
import { enhanceSuccessfulWrite } from '../postEdit';

export interface SearchReplaceEdit {
	path: string;
	old_string: string;
	new_string: string;
	replace_all: boolean;
}

export function parseWorkspaceEdits(args: Record<string, unknown>): SearchReplaceEdit[] {
	return asObjectArray(args, 'edits').map((item) => ({
		path: asString(item, 'path'),
		old_string: asString(item, 'old_string'),
		new_string: asString(item, 'new_string'),
		replace_all: asBoolean(item, 'replace_all'),
	}));
}

export const applyWorkspaceEditTool: ToolDefinition = {
	name: 'apply_workspace_edit',
	description: 'Несколько точечных правок (old_string -> new_string) атомарно через WorkspaceEdit. Несколько правок одного файла применяются по цепочке. Либо все применятся, либо ни одна.',
	parameters: {
		type: 'object',
		properties: {
			edits: {
				type: 'array',
				description: 'Список правок',
				items: {
					type: 'object',
					properties: {
						path: {
							type: 'string',
						},
						old_string: {
							type: 'string',
						},
						new_string: {
							type: 'string',
						},
						replace_all: {
							type: 'boolean',
						},
					},
					required: ['path', 'old_string', 'new_string'],
				},
			},
		},
		required: ['edits'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const parsed = parseWorkspaceEdits(args);
		if (parsed.length === 0) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.needEdits'),
			};
		}

		if (parsed.length > AGENT_LIMITS.maxWorkspaceEdits) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.tooManyEdits', parsed.length, AGENT_LIMITS.maxWorkspaceEdits),
			};
		}

		// Сохранить порядок правок внутри файла (цепочка)
		const groups = new Map<string, {
			uri: vscode.Uri;
			relative: string;
			edits: SearchReplaceEdit[];
		}>();

		for (const item of parsed) {
			throwIfAborted(ctx.signal);
			if (!item.path || !item.old_string) {
				return {
					ok: false,
					content: vscode.l10n.t('tool.editNeedsPathOld'),
				};
			}

			const resolved = await resolveWorkspacePath(item.path);
			const key = resolved.relative.replace(/\\/g, '/');
			let group = groups.get(key);
			if (!group) {
				group = {
					uri: resolved.uri,
					relative: resolved.relative,
					edits: [],
				};
				groups.set(key, group);
			}
			group.edits.push(item);
		}

		type Prepared = {
			uri: vscode.Uri;
			relative: string;
			edits: SearchReplaceEdit[];
			original: string;
			text: string;
			count: number;
			userDiff?: string;
		};

		const prepared: Prepared[] = [];

		for (const group of groups.values()) {
			throwIfAborted(ctx.signal);
			const doc = await vscode.workspace.openTextDocument(group.uri);
			const original = doc.getText();
			let chained: { text: string; totalCount: number };
			try {
				chained = applySearchReplaceChain(original, group.edits);
			} catch (err) {
				const msg = `${group.relative}: ${err instanceof Error ? err.message : String(err)}`;
				const paths = [...groups.values()].map((g) => g.relative);
				return {
					ok: false,
					path: group.relative,
					content: await appendFreshFileReads(msg, paths, 6_000),
					retryable: true,
					category: 'execution',
					code: 'patch_not_found',
				};
			}
			if (new TextEncoder().encode(chained.text).byteLength > AGENT_LIMITS.maxWriteBytes) {
				return {
					ok: false,
					content: vscode.l10n.t('tool.resultTooLarge', group.relative),
				};
			}

			prepared.push({
				uri: group.uri,
				relative: group.relative,
				edits: group.edits,
				original,
				text: chained.text,
				count: chained.totalCount,
				userDiff: ctx.writes?.userDiff(group.uri, original),
			});
		}

		const drifted = prepared.filter((p) => p.userDiff);
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
					path: prepared.map((p) => p.relative).join(', '),
				};
			}
		}

		const refreshed: Array<{
			uri: vscode.Uri;
			relative: string;
			range: vscode.Range;
			original: string;
			text: string;
			count: number;
		}> = [];

		for (const item of prepared) {
			throwIfAborted(ctx.signal);
			const doc = await vscode.workspace.openTextDocument(item.uri);
			const original = doc.getText();
			let chained: { text: string; totalCount: number };
			try {
				chained = applySearchReplaceChain(original, item.edits);
			} catch (err) {
				return {
					ok: false,
					path: item.relative,
					content: vscode.l10n.t('tool.editStale', item.relative, err instanceof Error ? err.message : String(err)),
				};
			}

			const last = Math.max(0, doc.lineCount - 1);
			refreshed.push({
				uri: doc.uri,
				relative: item.relative,
				range: new vscode.Range(0, 0, last, doc.lineAt(last).text.length),
				original,
				text: chained.text,
				count: chained.totalCount,
			});
		}

		const ws = new vscode.WorkspaceEdit();
		for (const item of refreshed) {
			ws.replace(item.uri, item.range, item.text);
		}

		const ok = await vscode.workspace.applyEdit(ws);
		if (!ok) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.workspaceEditFailed'),
			};
		}

		if (ctx.revealFile && refreshed[0]) {
			await ctx.revealFile(refreshed[0].uri);
		}

		for (const item of refreshed) {
			await ctx.checkpoint?.remember(item.uri, item.relative, item.original);
			ctx.writes?.remember(item.uri, item.relative, item.text);
			ctx.trackMutation?.(item.uri);
		}

		const note = drifted.length > 0 ? vscode.l10n.t('tool.userEditsNotedBatch') : '';
		const fileDiffs = refreshed.map((p) => ({
			relative: p.relative,
			mini: computeMiniDiff(p.original, p.text),
		}));
		const hunks = fileDiffs.flatMap((item, fileIndex) => toDiffHunkPayloads(item.mini.hunks, refreshed[fileIndex]!.original, {
			path: item.relative,
			idPrefix: `f${fileIndex}`,
		}));
		const result: ToolResult = {
			ok: true,
			path: refreshed.map((p) => p.relative).join(', '),
			diff: fileDiffs.map((item) => `--- ${item.relative}\n${item.mini.text}`).join('\n\n'),
			hunks,
			content: vscode.l10n.t('tool.editsApplied', refreshed.length, refreshed.map((p) => `${p.relative}: ${p.count}`).join('\n'), note),
		};
		return enhanceSuccessfulWrite(result, refreshed.map((p) => p.uri), ctx);
	},
};
