import { estimateTextTokens } from '../../core/llm/estimateTokens';
import { fitHitsToTokenBudget } from '../agent/tools/search/fitHitsTokenBudget';

// Per-kind квоты токенов для pack `@Docs` / `@past` / `@terminals` (до общего fitMentionsToBudget на turn).
export const MENTION_KIND_TOKEN_QUOTAS = {
	docs: 3_000,
	past: 2_500,
	terminals: 2_500,
} as const;

export type MentionRetrievalKind = keyof typeof MENTION_KIND_TOKEN_QUOTAS;

// Максимум кандидатов до eviction по quota
export const MENTION_KIND_MAX_HITS = {
	docs: 8,
	past: 12,
	terminals: 8,
} as const;

export interface MentionRetrievalHit {
	// path / session id / имя терминала
	path: string;
	score: number;
	snippet: string;
	// Заголовок в блоке (иначе path)
	header?: string;
}

export interface PackMentionHitsResult {
	text: string;
	truncated: boolean;
	tokensUsed: number;
	kept: MentionRetrievalHit[];
	dropped: MentionRetrievalHit[];
	maxTokens: number;
}

// Токены query для overlap-скоринга (латиница / кириллица / код)
export function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9а-яё_+.-]+/iu)
		.map((t) => t.trim())
		.filter((t) => t.length >= 2);
}

/**
 * Релевантность текста запросу или аргументу (0..1).
 * Пустой или служебный запрос -> 0 (порядок сохраняем разрешением равенства по path).
 */
export function scoreQueryRelevance(text: string, query: string): number {
	const q = query.trim().toLowerCase();
	if (!q || q === 'docs') {
		return 0;
	}

	const hay = text.toLowerCase();
	let score = 0;
	if (hay.includes(q)) {
		score += 0.4;
	}

	const tokens = tokenizeQuery(q);
	if (!tokens.length) {
		return Math.min(1, score);
	}

	let hit = 0;
	for (const t of tokens) {
		if (hay.includes(t)) {
			hit += 1;
		}
	}

	score += (hit / tokens.length) * 0.6;
	return Math.min(1, score);
}

// Смешать semantic/base score с lexical overlap по path+snippet
export function combineRetrievalScore(
	baseScore: number,
	path: string,
	snippet: string,
	query: string,
): number {
	const lexical = scoreQueryRelevance(`${path}\n${snippet}`, query);
	const base = Math.max(0, Math.min(1, baseScore));
	return Math.min(1, base * 0.65 + lexical * 0.35);
}

export function rankMentionHits(hits: readonly MentionRetrievalHit[]): MentionRetrievalHit[] {
	return [...hits].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export function formatMentionHitBlock(hit: MentionRetrievalHit, kindTag: string): string {
	const title = (hit.header ?? hit.path).trim() || hit.path;
	return `[${kindTag} ${title}]\n${hit.snippet}`;
}

// Уложить ranked hits в per-kind token quota (как pack_context / fitHitsToTokenBudget): низкий score выкидываем первым; один oversized snippet режем.
export function packMentionHitsToQuota(
	hits: readonly MentionRetrievalHit[],
	kind: MentionRetrievalKind,
	opts?: {
		kindTag?: string;
		maxHits?: number;
		maxTokens?: number;
		emptyMessage?: string;
	},
): PackMentionHitsResult {
	const kindTag = opts?.kindTag ?? kind;
	const maxHits = opts?.maxHits ?? MENTION_KIND_MAX_HITS[kind];
	const maxTokens = opts?.maxTokens ?? MENTION_KIND_TOKEN_QUOTAS[kind];
	const ranked = rankMentionHits(hits).slice(0, Math.max(1, maxHits));

	if (!ranked.length) {
		return {
			text: opts?.emptyMessage ?? '',
			truncated: false,
			tokensUsed: 0,
			kept: [],
			dropped: [],
			maxTokens,
		};
	}

	const fitted = fitHitsToTokenBudget(ranked, maxTokens, (h) =>
		Math.max(1, estimateTextTokens(formatMentionHitBlock(h, kindTag))),
	);

	const text = fitted.kept.map((h) => formatMentionHitBlock(h, kindTag)).join('\n\n');
	return {
		text,
		truncated: fitted.truncated,
		tokensUsed: fitted.tokensUsed,
		kept: fitted.kept,
		dropped: fitted.dropped,
		maxTokens: fitted.maxTokens,
	};
}

// Сообщения чата -> hits с score по query; eviction по quota (хронология: свежие чуть выше при равном score).
export function packPastMessagesToQuota(
	messages: readonly { role: string; content: string }[],
	query: string,
	opts?: {
		maxMessages?: number;
		maxTokens?: number;
		sessionTitle?: string;
	},
): PackMentionHitsResult {
	const maxMessages = opts?.maxMessages ?? 12;
	const roles = new Set(['user', 'assistant']);
	const picked = messages.filter((m) => roles.has(m.role) && m.content.trim())
		.slice(-maxMessages);

	const hits: MentionRetrievalHit[] = picked.map((m, i) => {
		const role = m.role === 'user' ? 'user' : 'assistant';
		const body = m.content.trim();
		const recency = i / Math.max(1, picked.length - 1);
		const lexical = scoreQueryRelevance(body, query);
		return {
			path: `${role}-${i}`,
			header: role,
			snippet: body,
			// Свежие чуть выше; query поднимает релевантные реплики
			score: Math.min(1, lexical * 0.75 + recency * 0.25 + 0.05),
		};
	});

	const packed = packMentionHitsToQuota(hits, 'past', {
		kindTag: 'past-msg',
		maxHits: maxMessages,
		maxTokens: opts?.maxTokens ?? MENTION_KIND_TOKEN_QUOTAS.past,
		emptyMessage: '(нет сообщений)',
	});

	if (!packed.kept.length) {
		return packed;
	}

	// Для модели - хронологический порядок оставшихся (не по score)
	const order = new Map(hits.map((h, i) => [h.path, i]));
	const chronological = [...packed.kept].sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
	const body = chronological.map((h) => `${h.header ?? h.path}:\n${h.snippet}`).join('\n\n');
	const title = opts?.sessionTitle?.trim();
	const text = title ? `[past ${title}]\n${body}` : `[past]\n${body}`;
	const note = packed.truncated ? `\n\n[truncated past  quota ${packed.maxTokens} tok]` : '';

	return {
		...packed,
		text: `${text}${note}`,
		tokensUsed: estimateTextTokens(`${text}${note}`),
		kept: chronological,
	};
}
