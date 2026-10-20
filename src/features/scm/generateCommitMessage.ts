import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { HttpLlmClient } from '../../core/llm/client';

const execFileAsync = promisify(execFile);

let inflight: AbortController | undefined;

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd,
		maxBuffer: 2 * 1024 * 1024,
		encoding: 'utf8',
	});
	return stdout.trim();
}

async function collectDiffContext(cwd: string): Promise<string> {
	const status = await git(cwd, ['status', '--porcelain']).catch(() => '');
	const staged = await git(cwd, ['diff', '--cached', '--stat']).catch(() => '');
	const stagedPatch = await git(cwd, ['diff', '--cached', '-U1', '--', '.']).catch(() => '');
	const unstaged = !stagedPatch
		? await git(cwd, ['diff', '-U1', '--', '.']).catch(() => '')
		: '';
	const parts = [
		status ? `СТАТУС:\n${status}` : '',
		staged ? `ИНДЕКС (stat):\n${staged}` : '',
		stagedPatch ? `ИНДЕКС (diff):\n${stagedPatch.slice(0, 12_000)}` : '',
		unstaged ? `НЕ В ИНДЕКСЕ (diff):\n${unstaged.slice(0, 12_000)}` : '',
	].filter(Boolean);
	return parts.join('\n\n') || 'Нет изменений в git.';
}

function extractMessage(raw: string): string {
	const trimmed = raw.trim();
	const fence = trimmed.match(/```(?:\w+)?\s*([\s\S]*?)```/);
	const body = (fence?.[1] ?? trimmed).trim();
	const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
	return firstLine.slice(0, 72) || body.slice(0, 72);
}

async function applyToScmInput(message: string): Promise<void> {
	const gitExt = vscode.extensions.getExtension('vscode.git');
	if (!gitExt) {
		await vscode.env.clipboard.writeText(message);
		void vscode.window.showInformationMessage(
			vscode.l10n.t('scm.commitMessage.copiedClipboard'),
		);
		return;
	}

	if (!gitExt.isActive) {
		await gitExt.activate();
	}

	const api = gitExt.exports?.getAPI?.(1);
	const repo = api?.repositories?.[0];
	if (repo?.inputBox) {
		repo.inputBox.value = message;
		void vscode.window.showInformationMessage(vscode.l10n.t('scm.commitMessage.applied'));
		return;
	}

	await vscode.env.clipboard.writeText(message);
	void vscode.window.showInformationMessage(vscode.l10n.t('scm.commitMessage.copiedClipboard'));
}

export function registerGenerateCommitMessage(): vscode.Disposable {
	const generate = vscode.commands.registerCommand('gen.generateCommitMessage', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			void vscode.window.showErrorMessage(vscode.l10n.t('policy.noWorkspace'));
			return;
		}

		const settings = getSettings();
		if (!settings.baseUrl?.trim()) {
			void vscode.window.showErrorMessage(vscode.l10n.t('scm.commitMessage.noBaseUrl'));
			return;
		}

		inflight?.abort();
		const controller = new AbortController();
		inflight = controller;

		try {
			const context = await collectDiffContext(folder.uri.fsPath);
			const message = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t('scm.commitMessage.progress'),
					cancellable: true,
				},
				async (_progress, token) => {
					token.onCancellationRequested(() => controller.abort());
					const client = new HttpLlmClient();
					const result = await client.complete({
						messages: [
							{
								role: 'system',
								content: 'Ты пишешь краткий subject git-коммита (повелительное наклонение, ≤72 символа). Ответь только одной строкой subject - без кавычек и markdown.',
							},
							{
								role: 'user',
								content: `Напиши сообщение коммита по этим изменениям:\n\n${context}`,
							},
						],
						signal: controller.signal,
					});
					return extractMessage(result.content);
				},
			);
			if (!message) {
				void vscode.window.showErrorMessage(vscode.l10n.t('scm.commitMessage.empty'));
				return;
			}

			await applyToScmInput(message);
		} catch (err) {
			if (controller.signal.aborted) {
				void vscode.window.showInformationMessage(vscode.l10n.t('scm.commitMessage.cancelled'));
				return;
			}

			void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
		} finally {
			if (inflight === controller) {
				inflight = undefined;
			}
		}
	});

	const abort = vscode.commands.registerCommand('gen.abortCommitMessage', () => {
		inflight?.abort();
	});

	return vscode.Disposable.from(generate, abort);
}

// Чистый helper для тестов (разбор subject из ответа модели)
export function extractCommitSubjectForTests(raw: string): string {
	return extractMessage(raw);
}
