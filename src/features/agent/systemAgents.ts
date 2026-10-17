import { getSettings, resolveSmallModel } from '../../core/config/settings';
import type { LlmClient } from '../../core/llm/types';
import type { ChatUiMessage } from '../chat/protocol';

const MAX_TITLE_INPUT = 6_000;
const MAX_TITLE_CHARS = 72;

function serializeForTitle(messages: readonly ChatUiMessage[]): string {
	const lines: string[] = [];
	for (const msg of messages) {
		if (msg.role === 'user') {
			lines.push(`Пользователь: ${msg.content}`);
		} else if (msg.role === 'assistant' && msg.content.trim()) {
			lines.push(`Ассистент: ${msg.content.slice(0, 800)}`);
		}

		if (lines.join('\n').length > MAX_TITLE_INPUT) {
			break;
		}
	}
	const text = lines.join('\n');
	return text.length > MAX_TITLE_INPUT
		? `${text.slice(0, MAX_TITLE_INPUT)}\n\n[truncated]`
		: text;
}

// Скрытый system-agent на smallModel: короткое название сессии после первого хода
export async function generateSessionTitle(
	messages: readonly ChatUiMessage[],
	client: LlmClient,
	opts?: { 
		signal?: AbortSignal 
	},
): Promise<{ title?: string; error?: string }> {
	const settings = getSettings();
	const model = resolveSmallModel(settings);
	const body = serializeForTitle(messages);
	if (!body.trim()) {
		return { error: 'no user or assistant content available' };
	}

	let lastError = 'empty title';
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
		const result = await client.complete({
			messages: [
				{
					role: 'system',
					content: `Ты придумываешь короткое название чата для coding-агента. Ответь только названием: 3-8 слов, без кавычек, переносов и пунктуации в конце.${attempt ? ' Предыдущий ответ не прошёл валидацию.' : ''}`,
				},
				{
					role: 'user',
					content: `Сформулируй название сессии по переписке:\n\n${body}`,
				},
			],
			model,
			signal: opts?.signal,
			toolChoice: 'none',
		});
		const raw = result.content.trim().replace(/^["«]+|["»]+$/g, '').trim();
		if (!raw) {
			lastError = 'model returned an empty title';
			continue;
		}

		const oneLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
		const words = oneLine.split(/\s+/).filter(Boolean);
		if (raw.includes('\n') || oneLine.length > MAX_TITLE_CHARS || words.length < 3 || words.length > 8) {
			lastError = `invalid title shape (${words.length} words, ${oneLine.length} chars)`;
			continue;
		}
		
		return { title: oneLine };
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
	}
	return { error: lastError };
}
