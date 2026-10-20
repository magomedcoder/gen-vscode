import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { HttpLlmClient } from '../../core/llm/client';

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
			const suffix = document.getText(
				new vscode.Range(position.line, position.character, Math.min(document.lineCount - 1, position.line + 8), 0),
			);

			try {
				const client = new HttpLlmClient();
				const model = settings.smallModel?.trim() || undefined;
				const result = await client.complete({
					model,
					messages: [
						{
							role: 'system',
							content: 'Ты движок автодополнения кода. Продолжи код в позиции курсора. Ответь только текстом вставки (без markdown-ограждений и пояснений). Предпочти короткое дополнение в одну или несколько строк.',
						},
						{
							role: 'user',
							content: `Язык: ${document.languageId}\n\nПРЕФИКС:\n${prefix.slice(-6000)}\n\nСУФФИКС:\n${suffix.slice(0, 1500)}\n\nДополни код сразу после ПРЕФИКСА.`,
						},
					],
					signal: controller.signal,
				});
				let insert = result.content.trim();
				if (insert.startsWith('```')) {
					insert = insert.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim();
				}

				if (!insert || controller.signal.aborted) {
					return;
				}

				// Для latency/UX берём только первую строку
				const first = insert.split(/\r?\n/)[0] ?? insert;
				return [new vscode.InlineCompletionItem(first, new vscode.Range(position, position))];
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
