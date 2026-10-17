import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';

// Интервал опроса git status для автоматического Keep (мс)
const POLL_MS = 3000;

function runGit(cwd: string, args: string[], timeoutMs = 2500): Promise<{ ok: boolean; out: string }> {
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
			resolve({ 
				ok: false, 
				out: out.trim() 
			});
		}, timeoutMs);
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			out += chunk;
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ 
				ok: code === 0, 
				out: out.trim() 
			});
		});
		child.on('error', () => {
			clearTimeout(timer);
			resolve({ 
				ok: false,
				out: ''
			});
		});
	});
}

/**
 * Файл чист в git: `git status --porcelain -- path` пуст (совпадает с HEAD, нет неиндексированных изменений).
 * При ошибке git или вне репозитория - false (без автоматического Keep).
 */
export async function isPathCleanInGit(relativePath: string): Promise<boolean> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const path = relativePath.trim();
	if (!folder || !path) {
		return false;
	}

	const { ok, out } = await runGit(folder.uri.fsPath, ['status', '--porcelain', '--', path]);
	return ok && out === '';
}

// Минимальный контракт сессии для git-sync auto-Keep
export interface GitSyncAutoKeepSession {
	getPendingPaths: () => string[];
	acceptPath: (relativePath: string) => void | Promise<void>;
	// Не трогать, пока agent turn inflight
	isBusy: () => boolean;
}

/**
 * Опрос каждые 3 с: вызвать acceptPath для чистых ожидающих путей.
 * Пока настройка выключена, нет ожидающих изменений или система занята - тик ничего не делает.
 */
export function startGitSyncAutoKeep(session: GitSyncAutoKeepSession): { dispose(): void } {
	let disposed = false;
	let tickInflight = false;

	const tick = async (): Promise<void> => {
		if (disposed || tickInflight) {
			return;
		}

		if (!getSettings().gitSyncAutoKeep) {
			return;
		}

		if (session.isBusy()) {
			return;
		}

		const paths = session.getPendingPaths();
		if (paths.length === 0) {
			return;
		}

		tickInflight = true;
		try {
			for (const relativePath of paths) {
				if (disposed || session.isBusy()) {
					break;
				}
				
				if (!(await isPathCleanInGit(relativePath))) {
					continue;
				}
				await session.acceptPath(relativePath);
			}
		} finally {
			tickInflight = false;
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, POLL_MS);
	// Первый тик сразу - не ждать полный интервал
	void tick();

	return {
		dispose(): void {
			disposed = true;
			clearInterval(timer);
		},
	};
}
