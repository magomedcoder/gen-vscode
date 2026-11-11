import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { HttpLlmClient } from '../../core/llm/client';
import { sanitizeGhostInsert } from './ghostText';

let lastAbort: AbortController | undefined;

// Ghost text (gen Tab) через InlineCompletionItemProvider - opt-in, локальный baseUrl
export function registerInlineCompletionProvider(): vscode.Disposable {
	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, _context, token) {
			const settings = getSettings();
			if (!settings.inlineCompletionEnabled) {
				return;
			}

			if (!settings.baseUrl?.trim()) {
				return;
			}

			const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
			if (!linePrefix.trim() || linePrefix.length < 4) {
				return;
			}

			lastAbort?.abort();
			const controller = new AbortController();
			lastAbort = controller;
			token.onCancellationRequested(() => controller.abort());

			const start = Math.max(0, position.line - 40);
			const prefix = document.getText(new vscode.Range(start, 0, position.line, position.character));
			const endLine = Math.min(document.lineCount - 1, position.line + 20);
			const suffix = document.getText(
				new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length),
			);

			try {
				const client = new HttpLlmClient();
				const model = settings.smallModel?.trim() || undefined;
				const prompt = prefix.slice(-6000);
				const fimSuffix = suffix.slice(0, 2000);

				let insert = '';
				const fim = await client.completeFim({
					model,
					prompt,
					suffix: fimSuffix,
					signal: controller.signal,
					maxTokens: 192,
				});
				if (!fim.unsupported) {
					insert = fim.content;
				} else {
					const result = await client.complete({
						model,
						messages: [
							{
								role: 'system',
								content: 'Ты движок автодополнения кода. Продолжи код в позиции курсора. Ответь только текстом вставки (без markdown-ограждений и пояснений). Можно несколько строк, но без лишней воды.',
							},
							{
								role: 'user',
								content: `Язык: ${document.languageId}\n\nПРЕФИКС:\n${prompt}\n\nСУФФИКС:\n${fimSuffix}\n\nДополни код сразу после ПРЕФИКСА (перед СУФФИКСОМ).`,
							},
						],
						signal: controller.signal,
					});
					insert = result.content;
				}

				insert = sanitizeGhostInsert(insert);
				if (!insert || controller.signal.aborted) {
					return;
				}

				return [new vscode.InlineCompletionItem(insert, new vscode.Range(position, position))];
			} catch {
				return;
			} finally {
				if (lastAbort === controller) {
					lastAbort = undefined;
				}
			}
		},
	};

	return vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider);
}
