import type { ChatContentPart, ChatMessage } from './types';

// Завышаем оценку (~15%), чтобы реже ловить 400 на границе
const ESTIMATE_FACTOR = 1.15;
// Грубая эвристика: ~4 символа на токен (латиница/код); RU чуть плотнее - factor компенсирует
const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 300;
const MSG_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): number {
	if (!text) {
		return 0;
	}
	
	return Math.ceil((text.length / CHARS_PER_TOKEN) * ESTIMATE_FACTOR);
}

function estimateContent(content: string | ChatContentPart[] | null | undefined): number {
	if (content === null || content === undefined) {
		return 0;
	}

	if (typeof content === 'string') {
		return estimateTextTokens(content);
	}

	let n = 0;
	for (const part of content) {
		if (part.type === 'text') {
			n += estimateTextTokens(part.text);
		} else {
			n += IMAGE_TOKEN_ESTIMATE;
		}
	}

	return n;
}

// Оценка токенов исходящего prompt (не usage от сервера)
export function estimateChatMessagesTokens(messages: readonly ChatMessage[]): number {
	let n = 0;
	for (const msg of messages) {
		n += MSG_OVERHEAD_TOKENS;
		n += estimateContent(msg.content);
		if (msg.role === 'assistant' && msg.tool_calls?.length) {
			for (const call of msg.tool_calls) {
				n += estimateTextTokens(call.function.name);
				n += estimateTextTokens(call.function.arguments ?? '');
			}
		}
	}

	return n;
}
