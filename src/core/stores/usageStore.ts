import type { ExtensionContext, Memento } from 'vscode';

export interface ModelUsage {
	promptTokens: number;
	completionTokens: number;
	requests: number;
	lastUsed: number;
}

const STORAGE_KEY = 'gen.usage.byModel';

let store: Memento | undefined;
const memory = new Map<string, ModelUsage>();

export function initUsageStore(context: ExtensionContext): void {
	store = context.globalState;
	const raw = store.get<Record<string, ModelUsage>>(STORAGE_KEY, {});
	for (const [key, value] of Object.entries(raw ?? {})) {
		memory.set(key, value);
	}
}

// Debounce записи в globalState: recordUsage вызывается на каждый LLM-ответ
const PERSIST_DEBOUNCE_MS = 1500;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistDirty = false;

function schedulePersist(): void {
	persistDirty = true;
	if (persistTimer) {
		return;
	}

	persistTimer = setTimeout(() => {
		persistTimer = undefined;
		void flushUsageStore();
	}, PERSIST_DEBOUNCE_MS);
}

// Немедленный сброс pending-записи (deactivate / тесты)
export function flushUsageStore(): Thenable<void> {
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = undefined;
	}

	if (!persistDirty || !store) {
		return Promise.resolve();
	}

	persistDirty = false;
	return store.update(STORAGE_KEY, Object.fromEntries(memory.entries()));
}

export function recordUsage(model: string, promptTokens: number, completionTokens: number): void {
	const id = model.trim() || 'unknown';
	const prev = memory.get(id) ?? {
		promptTokens: 0,
		completionTokens: 0,
		requests: 0,
		lastUsed: 0
	};
	const next: ModelUsage = {
		promptTokens: prev.promptTokens + Math.max(0, promptTokens),
		completionTokens: prev.completionTokens + Math.max(0, completionTokens),
		requests: prev.requests + 1,
		lastUsed: Date.now(),
	};
	memory.set(id, next);
	schedulePersist();
}

export function getUsageMap(): Record<string, ModelUsage> {
	return Object.fromEntries(memory.entries());
}

// Алиас для UI Usage & Quota
export function readUsage(): Record<string, ModelUsage> {
	return getUsageMap();
}

export function resetUsage(): void {
	memory.clear();
	// Явный reset пишем сразу и отменяем pending debounce
	if (persistTimer) {
		clearTimeout(persistTimer);
		persistTimer = undefined;
	}

	persistDirty = false;
	void store?.update(STORAGE_KEY, {});
}
