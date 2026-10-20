import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';

function runGit(cwd: string, args: string[], timeoutMs = 2500): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		let out = '';
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {}
			resolve(out.trim());
		}, timeoutMs);
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			out += chunk;
		});
		child.on('close', () => {
			clearTimeout(timer);
			resolve(out.trim());
		});
		child.on('error', () => {
			clearTimeout(timer);
			resolve('');
		});
	});
}

/**
 * Короткий постоянно включённый блок workspace (ветка git и недавние файлы).
 * Возвращает undefined, если контекст workspace выключен либо workspace отсутствует.
 */
export async function getAlwaysOnWorkspaceContext(): Promise<string | undefined> {
	const settings = getSettings();
	// Мастер-флаг: без enableWorkspaceContext - никакого автоконтекста
	if (!settings.enableWorkspaceContext) {
		return undefined;
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}

	const lines: string[] = ['[Always-on workspace]'];
	if (!settings.alwaysOnWorkspaceContext) {
		return undefined;
	}

	const branch = await runGit(folder.uri.fsPath, ['status', '-sb']);
	if (branch) {
		lines.push(`git status -sb:\n${branch.split('\n').slice(0, 8).join('\n')}`);
	}

	const recent = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((tab) => {
			const input = tab.input as { uri?: vscode.Uri } | undefined;
			return input?.uri;
		})
		.filter((uri): uri is vscode.Uri => Boolean(uri && (uri.scheme === 'file' || uri.scheme === 'vscode-notebook-cell')))
		.slice(0, 8)
		.map((uri) => vscode.workspace.asRelativePath(uri));

	const unique = [...new Set(recent)].slice(0, 6);
	if (unique.length > 0) {
		lines.push(`Недавние файлы:\n${unique.map((p) => `- ${p}`).join('\n')}`);
	}

	if (lines.length <= 1) {
		return undefined;
	}

	return lines.join('\n');
}
