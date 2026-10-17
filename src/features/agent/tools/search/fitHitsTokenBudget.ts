import { estimateTextTokens } from '../../../../core/llm/estimateTokens';

// Структурированный provenance для UI / агента (path, range, tool, reason, score)
export interface ProvenanceHit {
	path: string;
	startLine?: number | null;
	endLine?: number | null;
	score: number;
	snippet: string;
	// Какой tool / backend породил фрагмент
	tool: string;
	// Человекочитаемое why (overlap, find_code why, index, ...)
	reason: string;
	// Опциональная грубая метка источника (codebase / editor / ...)
	source?: string;
	estimatedTokens: number;
}

export interface FitHitsTokenBudgetResult<T> {
	kept: T[];
	dropped: T[];
	tokensUsed: number;
	truncated: boolean;
	maxTokens: number;
}

export function estimateHitTokens(hit: {
	path: string;
	snippet: string;
	tool?: string;
	reason?: string;
}): number {
	const meta = [hit.tool, hit.reason].filter(Boolean).join(' ');
	return Math.max(1, estimateTextTokens(`${hit.path}\n${meta}\n${hit.snippet}`));
}

/**
 * Ограничить ranked hits оценочным token budget.
 * Сначала выкидывает хиты с низким score; в `kept` сохраняет порядок по убыванию score.
 */
export function fitHitsToTokenBudget<T extends { score: number; path: string; snippet: string }>(
	hits: readonly T[],
	maxTokens: number,
	estimate: (hit: T) => number = (h) => estimateHitTokens(h),
): FitHitsTokenBudgetResult<T> {
	const budget = Math.max(64, Math.floor(maxTokens));
	const kept = [...hits].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
	const dropped: T[] = [];

	const tokensOf = (list: T[]) => list.reduce((sum, h) => sum + Math.max(1, estimate(h)), 0);

	let tokensUsed = tokensOf(kept);
	while (kept.length > 1 && tokensUsed > budget) {
		const removed = kept.pop()!;
		dropped.push(removed);
		tokensUsed = tokensOf(kept);
	}

	// Один слишком большой hit: обрезать snippet, пока влезет (оставить path + короткий маркер)
	if (kept.length === 1 && tokensUsed > budget) {
		const only = kept[0]!;
		const overhead = Math.max(1, estimate({
			...only,
			snippet: ''
		}));
		const room = Math.max(48, (budget - overhead) * 4);
		if (only.snippet.length > room) {
			const snippet = `${only.snippet.slice(0, Math.max(40, room - 24))}\n... [truncated]`;
			const next = { ...only, snippet } as T & { estimatedTokens?: number };
			if ('estimatedTokens' in only) {
				next.estimatedTokens = estimate({
					...only,
					snippet
				});
			}

			kept[0] = next;
			tokensUsed = tokensOf(kept);
		}
	}

	return {
		kept,
		dropped,
		tokensUsed,
		truncated: dropped.length > 0 || tokensUsed > budget,
		maxTokens: budget,
	};
}

export function toProvenanceHit(input: {
	path: string;
	startLine?: number | null;
	endLine?: number | null;
	score: number;
	snippet: string;
	tool: string;
	reason: string;
	source?: string;
}): ProvenanceHit {
	const estimatedTokens = estimateHitTokens(input);
	return {
		path: input.path,
		startLine: input.startLine ?? null,
		endLine: input.endLine ?? null,
		score: input.score,
		snippet: input.snippet,
		tool: input.tool,
		reason: input.reason,
		...(input.source ? { source: input.source } : {}),
		estimatedTokens,
	};
}

// Разобрать max_tokens из args tool с clamp
export function resolveMaxTokensArg(
	args: Record<string, unknown>,
	fallback: number,
	maxCap: number,
	asOptionalInt: (args: Record<string, unknown>, key: string) => number | undefined,
): number {
	const raw = asOptionalInt(args, 'max_tokens') ?? fallback;
	return Math.min(maxCap, Math.max(64, raw));
}
