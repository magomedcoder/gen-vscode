import * as vscode from 'vscode';
import { getSettings } from '../../../core/config/settings';
import type { ToolResult } from '../types';

// Краткая подсказка по диагностикам после успешной записи (не ошибка tool)
export function diagnosticsNudgeForUri(uri: vscode.Uri): string | undefined {
	const diags = vscode.languages.getDiagnostics(uri);
	if (diags.length === 0) {
		return undefined;
	}

	let errors = 0;
	let warnings = 0;
	for (const d of diags) {
		if (d.severity === vscode.DiagnosticSeverity.Error) {
			errors += 1;
		} else if (d.severity === vscode.DiagnosticSeverity.Warning) {
			warnings += 1;
		}
	}

	return `После правки есть диагностики: всего ${diags.length} (ошибок: ${errors}, предупреждений: ${warnings}). При необходимости вызови get_diagnostics.`;
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

// После успешного write/patch: опциональный format + nudge по диагностикам
export async function enhanceSuccessfulWrite(result: ToolResult, uri: vscode.Uri): Promise<ToolResult> {
	if (!result.ok) {
		return result;
	}

	await maybeFormatAfterEdit(uri);
	const nudge = diagnosticsNudgeForUri(uri);
	if (nudge) {
		return {
			...result,
			content: `${result.content}\n\n${nudge}`,
		};
	}

	return result;
}
