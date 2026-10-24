import * as vscode from 'vscode';
import { stripComments } from './styles';

export type { CommentStyleConfig, CommentStyleId } from './styles';
export { stripComments, resolveCommentStyleId, getCommentStyleConfig } from './styles';

export interface ValidationResult {
	ok: boolean;
	message?: string;
}

// Убирает комментарии и сравнивает нормализованный код - ловит изменение логики LLM
export function validateUnchangedCode(original: string, commented: string, languageId: string): ValidationResult {
	const a = normalizeCode(stripComments(original, languageId));
	const b = normalizeCode(stripComments(commented, languageId));

	if (a === b) {
		return { ok: true };
	}

	return {
		ok: false,
		message: vscode.l10n.t('comment.validationChangedCode'),
	};
}

// Сжимает пробелы так, чтобы строки, где был только комментарий, не ломали сравнение
function normalizeCode(code: string): string {
	return code.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/g, ''))
		.filter((line) => line.length > 0)
		.join('\n')
		.trim();
}
