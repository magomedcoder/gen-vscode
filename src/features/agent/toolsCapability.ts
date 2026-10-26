import type { ConnectionCapabilities } from '../../core/llm/types';

// Подсказка: сервер умеет native tools / нет / ещё не пробовали
export type ToolsCapabilityHint = 'native' | 'unsupported' | 'unknown';

const cache = new Map<string, ToolsCapabilityHint>();

function key(baseUrl: string, model: string): string {
	return `${baseUrl.trim().replace(/\/+$/, '')}|${model.trim()}`;
}

// Запомнить результат toolsFallback / успешного native turn
export function rememberToolsCapability(
	baseUrl: string,
	model: string,
	hint: Exclude<ToolsCapabilityHint, 'unknown'>,
): void {
	if (!baseUrl.trim()) {
		return;
	}
	cache.set(key(baseUrl, model), hint);
}

export function getCachedToolsCapability(baseUrl: string, model: string): ToolsCapabilityHint {
	if (!baseUrl.trim()) {
		return 'unknown';
	}
	return cache.get(key(baseUrl, model)) ?? 'unknown';
}

export function toolsHintFromCache(baseUrl: string, model: string): string | undefined {
	const hint = getCachedToolsCapability(baseUrl, model);
	if (hint === 'unknown') {
		return undefined;
	}
	return hint;
}

// Подмешать кэш tools в capabilities health-probe
export function mergeToolsHintIntoCapabilities(
	capabilities: ConnectionCapabilities | undefined,
	baseUrl: string,
	model: string,
): ConnectionCapabilities | undefined {
	const toolsHint = toolsHintFromCache(baseUrl, model);
	if (!toolsHint && !capabilities) {
		return undefined;
	}
	return {
		...capabilities,
		...(toolsHint ? { toolsHint } : {}),
	};
}
