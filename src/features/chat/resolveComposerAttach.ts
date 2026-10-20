import * as vscode from 'vscode';
import { normalizePastedPath } from './composerAttachPaths';

export interface ResolvedComposerAttach {
	path: string;
	kind: 'file' | 'folder';
}

function toUri(raw: string): vscode.Uri | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		if (/^(file|vscode-file|vscode-resource):/i.test(trimmed)) {
			const parsed = vscode.Uri.parse(trimmed);
			if (parsed.scheme === 'file') {
				return parsed;
			}

			// vscode-file / vscode-resource -> fs path
			if (parsed.fsPath) {
				return vscode.Uri.file(parsed.fsPath);
			}
		}
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && !/^file:/i.test(trimmed)) {
			return undefined;
		}
	} catch {}

	const normalized = normalizePastedPath(trimmed);
	try {
		if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
			return vscode.Uri.file(normalized);
		}
		
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}
		return vscode.Uri.joinPath(folder.uri, ...normalized.split('/').filter(Boolean));
	} catch {
		return undefined;
	}
}

/**
 * Преобразовать URI/пути (paste/drop) в относительные workspace пути + file/folder.
 * Вне workspace - пропускаем.
 */
export async function resolveComposerAttachPaths(rawPaths: readonly string[]): Promise<ResolvedComposerAttach[]> {
	const out: ResolvedComposerAttach[] = [];
	const seen = new Set<string>();

	for (const raw of rawPaths) {
		const uri = toUri(raw);
		if (!uri) {
			continue;
		}

		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder) {
			continue;
		}

		const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		if (!relative || relative.startsWith('../')) {
			continue;
		}

		if (seen.has(relative)) {
			continue;
		}
		seen.add(relative);

		let kind: 'file' | 'folder' = 'file';
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.type & vscode.FileType.Directory) {
				kind = 'folder';
			}
		} catch {
			if (relative.endsWith('/')) {
				kind = 'folder';
			}
		}

		out.push({
			path: relative.replace(/\/$/, ''),
			kind,
		});
	}

	return out;
}
