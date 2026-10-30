import { estimateTextTokens } from '../../core/llm/estimateTokens';
import type { LlmToolDefinition } from '../../core/llm/types';
import type { GenSettings, PrimaryToolsPreset } from '../../core/config/types';

// Кураторские пресеты для малого n_ctx (имена builtin tools)
export const PRIMARY_TOOLS_PRESETS: Record<'coding' | 'explore' | 'debug', readonly string[]> = {
	coding: [
		'list_dir',
		'read_file',
		'write_file',
		'apply_diff',
		'apply_workspace_edit',
		'glob',
		'grep',
		// Retrieval под тесный n_ctx (вместо dump @codebase)
		'find_code',
		'project_map',
		'pack_context',
		'get_diagnostics',
		'run_command',
		'run_tests',
		'todo_write',
		'todo_read',
		'ask_question',
		'attempt_completion',
	],
	explore: [
		'list_dir',
		'read_file',
		'glob',
		'grep',
		'file_search',
		'find_code',
		'codebase_search',
		'semantic_search',
		'project_map',
		'pack_context',
		'get_diagnostics',
		'ask_question',
		'attempt_completion',
	],
	debug: [
		'get_diagnostics',
		'read_file',
		'grep',
		'glob',
		'find_logs',
		'read_log_tail',
		'run_tests',
		'run_command',
		'apply_diff',
		'get_active_editor',
		'ask_question',
		'attempt_completion',
	],
};

// Порог effective context tokens -> auto preset
export function autoPresetForBudget(effectiveBudget: number): 'coding' | 'explore' | 'all' {
	if (effectiveBudget > 0 && effectiveBudget < 12_000) {
		return 'coding';
	}
	if (effectiveBudget > 0 && effectiveBudget < 24_000) {
		return 'explore';
	}
	return 'all';
}

/**
 * Allowlist имён tools для primary-агента.
 * `undefined` = не резать (все после фильтров feature/mode).
 */
export function resolvePrimaryToolsAllowlist(
	settings: Pick<GenSettings, 'primaryToolsPreset' | 'primaryTools'>,
	effectiveBudget?: number,
): string[] | undefined {
	const preset: PrimaryToolsPreset = settings.primaryToolsPreset ?? 'auto';
	if (preset === 'all') {
		return undefined;
	}

	if (preset === 'custom') {
		const custom = settings.primaryTools.map((n) => n.trim()).filter(Boolean);
		return custom.length > 0 ? custom : undefined;
	}

	if (preset === 'coding' || preset === 'explore' || preset === 'debug') {
		return [...PRIMARY_TOOLS_PRESETS[preset]];
	}

	// auto
	const resolved = autoPresetForBudget(effectiveBudget ?? 0);
	if (resolved === 'all') {
		return undefined;
	}

	return [...PRIMARY_TOOLS_PRESETS[resolved]];
}

export function estimateToolsSchemaTokens(tools: readonly LlmToolDefinition[]): number {
	if (tools.length === 0) {
		return 0;
	}

	try {
		return estimateTextTokens(JSON.stringify(tools));
	} catch {
		return tools.length * 180;
	}
}

// Если схемы tools + история близки к budget - сузить до coding essentials (пересечение с уже отфильтрованным списком).
export function shrinkToolsForBudget(
	tools: LlmToolDefinition[],
	messageTokens: number,
	budget: number,
): LlmToolDefinition[] {
	if (tools.length === 0 || budget <= 0) {
		return tools;
	}

	const schemaTokens = estimateToolsSchemaTokens(tools);
	const headroom = budget - messageTokens;
	// Оставляем запас на ответ модели
	if (schemaTokens + 1_200 < headroom * 0.55) {
		return tools;
	}

	const allow = new Set(PRIMARY_TOOLS_PRESETS.coding);
	const shrunk = tools.filter((t) => allow.has(t.function.name));
	return shrunk.length > 0 ? shrunk : tools.slice(0, Math.min(12, tools.length));
}
