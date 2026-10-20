import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffHunkPayload } from '../agent/diff';
import type { ChatSession } from './ChatSession';
import type { ChatUiMessage } from './protocol';

// Ссылка на pending-хунк для CodeLens-команд
export interface HunkCodeLensTarget {
	toolCallId: string;
	hunkId: string;
}

interface PendingHunkLens {
	toolCallId: string;
	hunk: DiffHunkPayload;
}

// Нормализация пути для сравнения с document.uri
function normalizePathKey(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Совпадает ли документ с relative/absolute путём хунка
export function documentMatchesHunkPath(document: vscode.TextDocument, targetPath: string): boolean {
	const target = normalizePathKey(targetPath.trim());
	if (!target || document.uri.scheme === 'untitled') {
		return false;
	}

	if (document.uri.scheme === 'file') {
		const fsKey = normalizePathKey(document.uri.fsPath);
		if (fsKey === target || fsKey === normalizePathKey(path.resolve(target))) {
			return true;
		}
	}

	const relative = normalizePathKey(vscode.workspace.asRelativePath(document.uri, false));
	return relative === target;
}

// Диапазон CodeLens по newStart/newLines (файл уже в состоянии «после»)
export function hunkCodeLensRange(document: vscode.TextDocument, hunk: DiffHunkPayload): vscode.Range {
	const lineCount = Math.max(1, document.lineCount);
	const startLine = Math.min(Math.max(0, hunk.newStart - 1), lineCount - 1);
	const span = Math.max(1, hunk.newLines.length);
	const endLine = Math.min(startLine + span - 1, lineCount - 1);
	const endChar = document.lineAt(endLine).text.length;
	return new vscode.Range(startLine, 0, endLine, endChar);
}

// Pending-хунки текущей сессии для открытого документа
export function collectPendingHunksForDocument(
	messages: readonly ChatUiMessage[],
	document: vscode.TextDocument,
): PendingHunkLens[] {
	const out: PendingHunkLens[] = [];
	for (const msg of messages) {
		for (const call of msg.toolCalls ?? []) {
			for (const hunk of call.hunks ?? []) {
				if (hunk.status !== 'pending') {
					continue;
				}

				const pathHint = (hunk.path ?? call.path)?.trim();
				if (!pathHint || !documentMatchesHunkPath(document, pathHint)) {
					continue;
				}

				out.push({ 
					toolCallId: call.id,
					hunk
				});
			}
		}
	}
	return out;
}

/**
 * CodeLens Accept/Reject (Keep/Undo) по pending-хункам Gen agent.
 * Делегирует в ChatSession.reviewHunk - тот же путь, что и кнопки в чате.
 */
export function registerHunkCodeLens(session: ChatSession): vscode.Disposable {
	const changeEmitter = new vscode.EventEmitter<void>();

	const provider: vscode.CodeLensProvider = {
		onDidChangeCodeLenses: changeEmitter.event,
		provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
			const state = session.getState();
			// Не мешаем CodeLens, пока агент busy
			if (state.busy) {
				return [];
			}

			const pending = collectPendingHunksForDocument(state.messages, document);
			const lenses: vscode.CodeLens[] = [];
			for (const item of pending) {
				const range = hunkCodeLensRange(document, item.hunk);
				const target: HunkCodeLensTarget = {
					toolCallId: item.toolCallId,
					hunkId: item.hunk.id,
				};

				// Keep = accept, Undo = reject (тот же reviewHunk, что и Accept/Reject в чате)
				lenses.push(new vscode.CodeLens(range, {
					title: vscode.l10n.t('chat.hunk.keep'),
					tooltip: vscode.l10n.t('chat.hunk.accept'),
					command: 'gen.hunk.accept',
					arguments: [target],
				}));
				lenses.push(new vscode.CodeLens(range, {
					title: vscode.l10n.t('chat.hunk.undo'),
					tooltip: vscode.l10n.t('chat.hunk.reject'),
					command: 'gen.hunk.reject',
					arguments: [target],
				}));
			}

			return lenses;
		},
	};

	let lastHunkFingerprint = '';
	const sessionSub = session.subscribe((state) => {
		// Не дёргать CodeLens на каждый stream tick - только при смене pending hunks / busy
		const parts: string[] = [state.busy ? '1' : '0'];
		for (const msg of state.messages) {
			for (const call of msg.toolCalls ?? []) {
				for (const hunk of call.hunks ?? []) {
					if (hunk.status === 'pending') {
						parts.push(`${call.id}:${hunk.id}:${hunk.path ?? ''}`);
					}
				}
			}
		}
		
		const fp = parts.join('|');
		if (fp === lastHunkFingerprint) {
			return;
		}

		lastHunkFingerprint = fp;
		changeEmitter.fire();
	});

	return vscode.Disposable.from(
		changeEmitter,
		sessionSub,
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),
		vscode.commands.registerCommand('gen.hunk.accept', async (target?: HunkCodeLensTarget) => {
			if (!target?.toolCallId || !target?.hunkId) {
				return;
			}

			await session.reviewHunk(target.toolCallId, target.hunkId, 'accept');
		}),
		vscode.commands.registerCommand('gen.hunk.reject', async (target?: HunkCodeLensTarget) => {
			if (!target?.toolCallId || !target?.hunkId) {
				return;
			}
			
			await session.reviewHunk(target.toolCallId, target.hunkId, 'reject');
		}),
	);
}
