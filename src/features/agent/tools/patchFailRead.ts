import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../policy';
import { resolveWorkspacePath } from '../workspacePath';

// При fail patch/diff: подмешать актуальный read_file в ответ tool (чтобы модель могла сразу retry без отдельного хода).
export async function appendFreshFileReads(
	errorMessage: string,
	relativePaths: readonly string[],
	maxTotalChars: number,
): Promise<string> {
	const unique = [...new Set(relativePaths.map((p) => p.trim()).filter(Boolean))];
	if (unique.length === 0) {
		return `${errorMessage}\n\n${vscode.l10n.t('patch.retryHint')}`;
	}

	const chunks: string[] = [
		errorMessage,
		'',
		vscode.l10n.t('patch.retryHint'),
		'',
		'--- current files (auto read_file) ---',
	];
	let used = chunks.join('\n').length;

	for (const relative of unique) {
		if (used >= maxTotalChars) {
			chunks.push('...');
			break;
		}

		try {
			const resolved = await resolveWorkspacePath(relative);
			const raw = await vscode.workspace.fs.readFile(resolved.uri);
			if (raw.byteLength > AGENT_LIMITS.maxReadBytes) {
				chunks.push(`### ${relative}\n[file too large]`);
				continue;
			}

			const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
			const lines = text.split(/\r?\n/);
			const numbered = lines.map((line, i) => `${String(i + 1).padStart(6, ' ')}|${line}`);
			let body = numbered.join('\n');
			const header = `### ${relative}\n`;
			const budget = maxTotalChars - used - header.length - 20;
			if (budget <= 0) {
				chunks.push('...');
				break;
			}

			if (body.length > budget) {
				body = `${body.slice(0, budget)}\n...`;
			}
			
			chunks.push(header + body);
			used += header.length + body.length + 2;
		} catch {
			chunks.push(`### ${relative}\n[unreadable]`);
		}
	}

	return chunks.join('\n');
}
