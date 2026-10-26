import type { LlmToolCall } from '../../core/llm/types';

const TOOL_CALL_BLOCK = /<tool_call>\s*<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
const PARAMETER_BLOCK = /<parameter=([a-zA-Z0-9_.-]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
const INCOMPLETE_TOOL_CALL_TAIL = /<tool_call>[\s\S]*$/i;

// Markdown / fenced tool call (локальные шаблоны)
const FENCED_TOOL_CALL = /```(?:tool_call|tool|json)?\s*\n([\s\S]*?)```/gi;

// XML invoke (часть локальных шаблонов: <tool name="...">)
const INVOKE_BLOCK = /<(?:tool|function)\s+name=["']([a-zA-Z0-9_.-]+)["']\s*>([\s\S]*?)<\/(?:tool|function)>/gi;
const ARG_BLOCK = /<(?:parameter|arg)\s+name=["']([a-zA-Z0-9_.-]+)["']\s*>([\s\S]*?)<\/(?:parameter|arg)>/gi;

const MARKERS = /<tool_call>|```(?:tool_call|tool)\b|<(?:tool|function)\s+name=|"name"\s*:\s*"[a-zA-Z0-9_.-]+"/i;

export function normalizeTextToolName(name: string): string {
	return name.trim();
}

function parametersToJson(body: string): string {
	const args: Record<string, string> = {};
	PARAMETER_BLOCK.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PARAMETER_BLOCK.exec(body)) !== null) {
		const key = match[1]?.trim();
		if (!key) {
			continue;
		}
		args[key] = (match[2] ?? '').trim();
	}
	return JSON.stringify(args);
}

function invokeArgsToJson(body: string): string {
	const args: Record<string, string> = {};
	ARG_BLOCK.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ARG_BLOCK.exec(body)) !== null) {
		const key = match[1]?.trim();
		if (!key) {
			continue;
		}

		args[key] = (match[2] ?? '').trim();
	}

	if (Object.keys(args).length > 0) {
		return JSON.stringify(args);
	}

	const trimmed = body.trim();
	if (!trimmed) {
		return '{}';
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return JSON.stringify(parsed);
		}
	} catch {}

	return JSON.stringify({ value: trimmed });
}

function pushCall(out: LlmToolCall[], name: string, argsJson: string): void {
	const n = normalizeTextToolName(name);
	if (!n) {
		return;
	}

	out.push({
		id: `text_call_${out.length + 1}`,
		type: 'function',
		function: {
			name: n,
			arguments: argsJson || '{}',
		},
	});
}

function parseHermesXml(raw: string): { content: string; toolCalls: LlmToolCall[] } {
	const toolCalls: LlmToolCall[] = [];
	TOOL_CALL_BLOCK.lastIndex = 0;
	const content = raw.replace(TOOL_CALL_BLOCK, (_full, rawName: string, body: string) => {
		pushCall(toolCalls, String(rawName ?? ''), parametersToJson(String(body ?? '')));
		return '';
	});

	return { content, toolCalls };
}

function parseInvokeXml(raw: string): { content: string; toolCalls: LlmToolCall[] } {
	const toolCalls: LlmToolCall[] = [];
	INVOKE_BLOCK.lastIndex = 0;
	const content = raw.replace(INVOKE_BLOCK, (_full, rawName: string, body: string) => {
		pushCall(toolCalls, String(rawName ?? ''), invokeArgsToJson(String(body ?? '')));
		return '';
	});

	return { content, toolCalls };
}

function tryParseToolJsonObject(obj: unknown): { name: string; args: string } | undefined {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
		return undefined;
	}

	const rec = obj as Record<string, unknown>;
	const nameRaw = rec.name ?? rec.tool ?? rec.function;
	let name = '';
	let args: unknown = rec.arguments ?? rec.parameters ?? rec.args ?? rec.input;
	if (typeof nameRaw === 'string') {
		name = nameRaw;
	} else if (nameRaw && typeof nameRaw === 'object' && !Array.isArray(nameRaw)) {
		const nested = nameRaw as Record<string, unknown>;
		name = typeof nested.name === 'string' ? nested.name : '';
		args = nested.arguments ?? nested.parameters ?? args;
	}

	if (!name.trim()) {
		return undefined;
	}

	if (typeof args === 'string') {
		return { name, args: args.trim() || '{}' };
	}

	if (args && typeof args === 'object') {
		return { name, args: JSON.stringify(args) };
	}

	return { name, args: '{}' };
}

// JSON-объект / массив / JSONL tool calls в свободном тексте или fenced-блоках
function parseJsonToolPayloads(raw: string): { content: string; toolCalls: LlmToolCall[] } {
	const toolCalls: LlmToolCall[] = [];
	let content = raw;

	const tryConsume = (slice: string, fullMatch: string): boolean => {
		const trimmed = slice.trim();
		if (!trimmed) {
			return false;
		}

		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const items = Array.isArray(parsed) ? parsed : [parsed];
			let any = false;
			for (const item of items) {
				const call = tryParseToolJsonObject(item);
				if (!call) {
					continue;
				}

				pushCall(toolCalls, call.name, call.args);
				any = true;
			}

			if (any) {
				content = content.replace(fullMatch, '');
			}

			return any;
		} catch {
			return false;
		}
	};

	FENCED_TOOL_CALL.lastIndex = 0;
	const fences = [...raw.matchAll(FENCED_TOOL_CALL)];
	for (const m of fences) {
		tryConsume(m[1] ?? '', m[0] ?? '');
	}

	// Отдельные JSON-объекты / JSONL в тексте
	const objectOrLine = /(?:^|\n)\s*(\{[\s\S]*?\})\s*(?=\n|$)/g;
	let m: RegExpExecArray | null;
	objectOrLine.lastIndex = 0;
	const candidates: string[] = [];
	while ((m = objectOrLine.exec(raw)) !== null) {
		const slice = m[1] ?? '';
		if (/"name"\s*:|"tool"\s*:|"function"\s*:/.test(slice)) {
			candidates.push(slice);
		}
	}
	
	for (const slice of candidates) {
		tryConsume(slice, slice);
	}

	return { content, toolCalls };
}

export interface ExtractTextToolCallsResult {
	content: string;
	toolCalls: LlmToolCall[];
}

/**
 * Достаёт текстовые tool_call из content модели (несколько диалектов) и убирает их из строки.
 */
export function extractTextToolCalls(raw: string): ExtractTextToolCallsResult {
	if (!raw || !MARKERS.test(raw)) {
		return { content: raw, toolCalls: [] };
	}

	let content = raw;
	const toolCalls: LlmToolCall[] = [];
	const seen = new Set<string>();

	const merge = (part: { content: string; toolCalls: LlmToolCall[] }) => {
		content = part.content;
		for (const call of part.toolCalls) {
			const key = `${call.function.name}\0${call.function.arguments}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			toolCalls.push({
				...call,
				id: `text_call_${toolCalls.length + 1}`,
			});
		}
	};

	merge(parseHermesXml(content));
	merge(parseInvokeXml(content));
	merge(parseJsonToolPayloads(content));

	return {
		content: content.replace(/\n{3,}/g, '\n\n').trim(),
		toolCalls,
	};
}

export function stripTextToolCallsForDisplay(raw: string): string {
	if (!raw || !MARKERS.test(raw)) {
		return raw;
	}
	const { content } = extractTextToolCalls(raw);
	return content
		.replace(INCOMPLETE_TOOL_CALL_TAIL, '')
		.replace(/<(?:tool|function)\s+name=["'][^"']*["'][^>]*>[\s\S]*$/i, '')
		.replace(/\n{3,}/g, '\n\n')
		.trimEnd();
}
