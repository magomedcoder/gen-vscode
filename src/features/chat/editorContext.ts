import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';

const LIVE_SELECTION_MAX = 400;

/**
 * Контекст активного редактора или выделения для prompt чата.
 * shareMode: disabled/manual - без автоматической вставки; auto - при enableWorkspaceContext.
 * Постоянный контекст workspace (git/недавние файлы) - отдельно, см. workspaceContext.ts.
 */
export function getEditorChatContext(): string | undefined {
	const settings = getSettings();
	// Без enableWorkspaceContext или без shareMode=auto - не подмешиваем редактор
	if (!settings.enableWorkspaceContext || settings.shareMode !== 'auto') {
		return undefined;
	}

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	const maxChars = settings.maxInputChars;
	const fileName = path.basename(editor.document.fileName);
	const languageId = editor.document.languageId;
	const selected = editor.selection.isEmpty ? '' : editor.document.getText(editor.selection).trim();

	const lines = [`Файл: ${fileName} (${languageId})`];
	if (selected) {
		const clipped = selected.length > maxChars
			? `${selected.slice(0, maxChars)}\n...`
			: selected;
		lines.push('Выделение:', clipped);
	}

	return lines.join('\n');
}

/**
 * Короткий appendix активного редактора для mid-turn обновления system prompt.
 * Те же условия shareMode, что и getEditorChatContext; selection сильно ужат.
 */
export function getLiveEditorAppendix(): string | undefined {
	const settings = getSettings();
	if (!settings.enableWorkspaceContext || settings.shareMode !== 'auto') {
		return undefined;
	}

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
	const selected = editor.selection.isEmpty
		? ''
		: editor.document.getText(editor.selection).trim();
	const lines = [
		'Live editor (mid-turn):',
		`file: ${rel || path.basename(editor.document.fileName)} (${editor.document.languageId})`,
	];
	if (selected) {
		const clipped = selected.length > LIVE_SELECTION_MAX
			? `${selected.slice(0, LIVE_SELECTION_MAX)}...`
			: selected;
		lines.push(`selection: ${clipped}`);
	} else {
		const line = editor.selection.active.line + 1;
		lines.push(`cursor: L${line}`);
	}

	return lines.join('\n');
}
