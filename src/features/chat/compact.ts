import * as vscode from 'vscode';
import { getSettings, resolveSmallModel } from '../../core/config/settings';
import type { LlmClient } from '../../core/llm/types';
import { beginGenOperationSpan } from '../../core/llm/otel';
import type { ChatUiMessage } from './protocol';

const DEFAULT_KEEP_TURNS = 4;
const MAX_SUMMARY_INPUT = 24_000;
const TOOL_SLICE_DEFAULT = 400;
const TOOL_SLICE_PRUNE = 80;

export interface CompactOptions {
	// Сколько последних ходов оставить (из compactTailTurns)
	keepTurns?: number;
	// Агрессивно ужимать tool-контент и args в старых ходах
	pruneToolResults?: boolean;
	// Резерв контекста после сжатия; это не целевой размер сводки.
	reservedTokens?: number;
	signal?: AbortSignal;
}

export interface CompactResult {
	messages: ChatUiMessage[];
	summary?: string;
	compacted: boolean;
	reason?: string;
}

function isTurnStart(msg: ChatUiMessage): boolean {
	return msg.role === 'user';
}

// Разбить историю на ходы (каждый начинается с пользователя)
export function splitIntoTurns(messages: readonly ChatUiMessage[]): ChatUiMessage[][] {
	const turns: ChatUiMessage[][] = [];
	let current: ChatUiMessage[] = [];
	for (const msg of messages) {
		if (isTurnStart(msg) && current.length > 0) {
			turns.push(current);
			current = [];
		}
		current.push(msg);
	}

	if (current.length > 0) {
		turns.push(current);
	}

	return turns;
}

function serializeTurns(
	turns: readonly ChatUiMessage[][],
	opts: {
		pruneToolResults: boolean
	},
): string {
	const toolSlice = opts.pruneToolResults ? TOOL_SLICE_PRUNE : TOOL_SLICE_DEFAULT;
	const lines: string[] = [];
	for (const turn of turns) {
		for (const msg of turn) {
			if (msg.role === 'user') {
				lines.push(`Пользователь: ${msg.content}`);
			} else if (msg.role === 'assistant') {
				lines.push(`Ассистент: ${msg.content}`);
				if (msg.toolCalls?.length) {
					for (const call of msg.toolCalls) {
						// При prune не тащим args в summary-prompt
						const argsPart = opts.pruneToolResults
							? ''
							: (call.arguments ? ` args=${call.arguments.slice(0, toolSlice)}` : '');
						lines.push(`  tool_call ${call.name}${argsPart}`);
					}
				}
			} else if (msg.role === 'error') {
				lines.push(`Ошибка: ${msg.content}`);
			} else if (msg.role === 'tool') {
				lines.push(`Tool ${msg.toolName ?? ''}: ${msg.content.slice(0, toolSlice)}`);
			}
		}
		lines.push('---');
	}

	const text = lines.join('\n');
	return text.length > MAX_SUMMARY_INPUT
		? `${text.slice(0, MAX_SUMMARY_INPUT)}\n\n[truncated]`
		: text;
}

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Сжать старые ходы в одно summary-сообщение, оставить последние N ходов
export async function compactChatMessages(
	messages: readonly ChatUiMessage[],
	client: LlmClient,
	opts?: CompactOptions,
): Promise<CompactResult> {
	const settings = getSettings();
	const span = beginGenOperationSpan(settings, 'chat.compact', { messages: messages.length });
	const keepTurns = Math.max(1, opts?.keepTurns ?? settings.compactTailTurns ?? DEFAULT_KEEP_TURNS);
	const pruneToolResults = opts?.pruneToolResults ?? settings.compactPruneToolResults;

	const turns = splitIntoTurns(messages);
	if (turns.length <= keepTurns) {
		span?.end('ok', { compacted: false });
		return {
			messages: [...messages],
			compacted: false,
			reason: vscode.l10n.t('chat.compact.nothingToDo', keepTurns),
		};
	}

	const older = turns.slice(0, -keepTurns);
	const recent = turns.slice(-keepTurns);
	const model = resolveSmallModel(settings);
	const prompt = [
		'Суммируй предыдущую переписку для coding-агента. Ответь СТРОГО структурой:',
		'## Goal',
		'## Decisions',
		'## Files / paths',
		'## Done',
		'## Next step',
		'## Open questions',
		'Сохраняй точные пути и идентификаторы. Кратко, на языке пользователя, без воды.',
		'',
		serializeTurns(older, { pruneToolResults }),
	].join('\n');

	let result;
	try {
		result = await client.complete({
		messages: [
			{
				role: 'system',
				content: 'Ты агент сжатия контекста. Не продолжай задачу пользователя. Выведи только structured summary в запрошенном формате.',
			},
			{
				role: 'user',
				content: prompt,
			},
		],
		model,
		signal: opts?.signal,
		toolChoice: 'none',
		});
	} catch (err) {
		span?.end('error');
		throw err;
	}

	const summary = result.content.trim();
	if (!summary) {
		span?.end('error', { 
			reason: 'empty_summary' 
		});
		return {
			messages: [...messages],
			compacted: false,
			reason: vscode.l10n.t('chat.compact.emptySummary'),
		};
	}

	const summaryMsg: ChatUiMessage = {
		id: messageId(),
		role: 'assistant',
		content: vscode.l10n.t('chat.compact.summaryPrefix', summary),
	};
	span?.end('ok', { 
		compacted: true, 
		kept_turns: keepTurns 
	});

	return {
		messages: [summaryMsg, ...recent.flat()],
		summary,
		compacted: true,
	};
}
