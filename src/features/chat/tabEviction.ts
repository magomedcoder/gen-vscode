/**
 * Выбор idle-вкладок для закрытия при лимите maxTabCount.
 * Не трогаем: текущую вкладку, busy (идёт run).
 */

import type { TabEvictionPolicy } from '../../core/config/types';

export type { TabEvictionPolicy };

export interface TabEvictionCandidate {
	id: string;
	updatedAt: number;
}

export interface PickTabsToEvictOptions {
	sessions: TabEvictionCandidate[];
	// sessionId с активным agent/ask run
	busyIds: ReadonlySet<string>;
	currentId: string;
	maxTabs: number;
	// Сколько свободных слотов нужно (обычно 1)
	needSlots?: number;
	policy: TabEvictionPolicy;
}

// Вернуть id вкладок для удаления (от старых к новым) либо [], если policy=block или удалять нечего
export function pickTabsToEvict(opts: PickTabsToEvictOptions): string[] {
	if (opts.policy === 'block') {
		return [];
	}

	const need = Math.max(1, Math.floor(opts.needSlots ?? 1));
	const max = Math.max(1, Math.floor(opts.maxTabs));
	const over = opts.sessions.length + need - max;
	if (over <= 0) {
		return [];
	}

	const eligible = opts.sessions
		.filter((s) => s.id !== opts.currentId && !opts.busyIds.has(s.id))
		.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));

	return eligible.slice(0, over).map((s) => s.id);
}
