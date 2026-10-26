import type { LlmToolCall } from '../../core/llm/types';

// Args обрезаны / не парсятся (в т.ч. маркер sanitize)
export function toolArgumentsInvalid(raw: string): boolean {
	const trimmed = (raw ?? '').trim() || '{}';
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const rec = parsed as Record<string, unknown>;
			if (rec.error === 'invalid_or_truncated_json') {
				return true;
			}
			return false;
		}
		return false;
	} catch {
		return true;
	}
}

export function findInvalidToolCalls(calls: readonly LlmToolCall[]): LlmToolCall[] {
	return calls.filter((c) => toolArgumentsInvalid(c.function.arguments));
}

export function isBadToolCallJsonError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	if (!msg) {
		return false;
	}
	return (
		/parse tool call arguments as json|unterminated string|missing closing quote|invalid_or_truncated_json/.test(msg)
		|| /invalid json in a tool-call|битый json в tool-call|bad tool.?call/.test(msg)
	);
}

// Подсказка модели для одного structured retry с узкой схемой tool
export function buildInvalidArgsRetryPrompt(toolNames: readonly string[]): string {
	const names = toolNames.length > 0 ? toolNames.join(', ') : 'инструмент';
	return [
		`Предыдущий вызов tool имел обрезанные или невалидные JSON-аргументы: ${names}.`,
		'Повтори один раз: вызови тот же tool с полными валидными JSON-аргументами.',
		'Не придумывай новые tools; аргументы держи минимальными и корректными.',
	].join(' ');
}
