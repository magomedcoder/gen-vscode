import * as vscode from 'vscode';
import { getSettings } from '../../../core/config/settings';
import type { VerifyAfterEdit } from '../../../core/config/types';
import { listIndexableFiles } from '../../index/scanner';
import { runAfterEditHook } from '../../project/hooks';
import type { ToolContext, ToolResult } from '../types';
import { collectDiagnosticsForUris, formatDiagnosticsVerifyBlock, waitForDiagnosticsSettle } from './ide/diagnosticsSnapshot';
import { suggestRelatedTests } from './meta/testImpactCore';
import { runTestsTool } from './shell/runTests';

const RELATED_TESTS_CAP = 10;

function normalizeUris(uris: vscode.Uri | readonly vscode.Uri[]): vscode.Uri[] {
	const list = Array.isArray(uris) ? [...uris] : [uris];
	const seen = new Set<string>();
	const out: vscode.Uri[] = [];
	for (const uri of list) {
		const key = uri.toString();
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		out.push(uri);
	}

	return out;
}

function modeNeedsDiagnostics(mode: VerifyAfterEdit): boolean {
	return mode === 'diagnostics' || mode === 'diagnostics_tests' || mode === 'full';
}

function modeNeedsTests(mode: VerifyAfterEdit): boolean {
	return mode === 'diagnostics_tests' || mode === 'full';
}

async function relativePathsForUris(uris: readonly vscode.Uri[]): Promise<string[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return uris.map((u) => u.fsPath);
	}

	const root = folder.uri.fsPath;
	return uris.map((u) => {
		const rel = vscode.workspace.asRelativePath(u, false);
		return rel && rel !== u.fsPath ? rel.replace(/\\/g, '/') : u.fsPath.replace(root, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
	});
}

async function relatedTestsFor(changedRel: string[]): Promise<{ block: string; paths: string[] }> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || changedRel.length === 0) {
		return { 
			block: '### Verify (related tests)\n(none found)', 
			paths: [] 
		};
	}

	try {
		const all = (await listIndexableFiles(folder)).map((f) => f.relative);
		const hits = suggestRelatedTests(changedRel, all).slice(0, RELATED_TESTS_CAP);
		if (hits.length === 0) {
			return { 
				block: '### Verify (related tests)\n(none found)', 
				paths: [] 
			};
		}

		return {
			block: `### Verify (related tests)\n${hits.map((p) => `- ${p}`).join('\n')}`,
			paths: hits,
		};
	} catch {
		return { 
			block: '### Verify (related tests)\n(unavailable)', 
			paths: [] 
		};
	}
}

function canAutoRunTests(): boolean {
	const settings = getSettings();
	if (!settings.enableTerminal) {
		return false;
	}

	return settings.autoApprove || settings.approvalPolicy.shell.mode === 'allow';
}

async function maybeAutoRunTests(
	ctx: ToolContext | undefined,
	testPaths: string[],
): Promise<string | undefined> {
	if (testPaths.length === 0 || !canAutoRunTests()) {
		return testPaths.length > 0
			? '### Verify (tests)\n(auto-run skipped - set approvalPolicy.shell=allow or autoApprove; call run_tests with paths above)'
			: undefined;
	}

	try {
		const runCtx = {
			...ctx,
			signal: ctx?.signal,
			confirm: ctx?.confirm,
			skipConfirm: true,
		} as ToolContext & { skipConfirm?: boolean };
		const result = await runTestsTool.execute({ paths: testPaths }, runCtx);
		const body = result.content.length > 4_000
			? `${result.content.slice(0, 4_000)}...`
			: result.content;
		return `### Verify (tests auto-run)\nok=${result.ok}\n${body}`;
	} catch (err) {
		return `### Verify (tests auto-run)\n(failed: ${err instanceof Error ? err.message : String(err)})`;
	}
}

// По желанию (opt-in): форматирование документа после успешной правки агента
export async function maybeFormatAfterEdit(uri: vscode.Uri): Promise<void> {
	if (!getSettings().formatAfterEdit) {
		return;
	}

	try {
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc, {
			preview: true,
			preserveFocus: true,
		});
		await vscode.commands.executeCommand('editor.action.formatDocument');
	} catch {
		// форматирование - по best-effort, не ломаем результат tool
	}
}

/**
 * После успешного write/patch: format -> diagnostics embed -> related tests -> hooks.
 * Append-only в content; ok write не откатывается.
 */
export async function enhanceSuccessfulWrite(
	result: ToolResult,
	uris: vscode.Uri | readonly vscode.Uri[],
	ctx?: ToolContext,
): Promise<ToolResult> {
	if (!result.ok) {
		return result;
	}

	const list = normalizeUris(uris);
	if (list.length === 0) {
		return result;
	}

	for (const uri of list) {
		await maybeFormatAfterEdit(uri);
	}

	const settings = getSettings();
	const mode = settings.verifyAfterEdit;
	const blocks: string[] = [];
	let hadErrors = false;
	const relPaths = await relativePathsForUris(list);

	if (modeNeedsDiagnostics(mode)) {
		await waitForDiagnosticsSettle(list);
		try {
			const snap = await collectDiagnosticsForUris(list, { max: 40 });
			hadErrors = snap.errorCount > 0;
			blocks.push(formatDiagnosticsVerifyBlock(snap));
		} catch {
			blocks.push('### Verify (diagnostics)\n(unavailable)');
		}
	}

	if (modeNeedsTests(mode)) {
		const related = await relatedTestsFor(relPaths);
		blocks.push(related.block);
		if (mode === 'full') {
			const auto = await maybeAutoRunTests(ctx, related.paths);
			if (auto) {
				blocks.push(auto);
			}
		}
	}

	ctx?.recordVerify?.({ hadErrors, paths: relPaths });

	try {
		await runAfterEditHook(relPaths, ctx?.signal);
	} catch {}

	if (blocks.length === 0) {
		return result;
	}

	return {
		...result,
		content: `${result.content}\n\n${blocks.join('\n\n')}`,
	};
}
