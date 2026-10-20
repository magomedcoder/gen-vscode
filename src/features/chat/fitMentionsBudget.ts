import { estimateTextTokens } from '../../core/llm/estimateTokens';

export interface ContextBlock {
	// Ключ для eviction / truncated label, напр. `@codebase`
	kind: string;
	text: string;
	// Чем выше - тем раньше выкидываем / режем при нехватке budget
	weight: number;
}

export interface FitMentionsResult {
	contextText: string;
	truncated: boolean;
	truncatedKinds: string[];
	tokensUsed: number;
}

// Веса eviction: тяжёлые упоминания режем первыми
export function weightForKind(kind: string): number {
	const k = kind.toLowerCase();
	if (k.includes('codebase') || k === 'codebase') {
		return 100;
	}

	if (k.includes('folder') || k === 'folder') {
		return 90;
	}

	if (k.includes('git-changes')) {
		return 85;
	}

	if (k.includes('branch_diff')) {
		return 80;
	}

	if (k.includes('link') || k.includes('url') || k === 'docs' || k.includes('docs')) {
		return 75;
	}

	if (k.includes('map') || k.includes('symbols')) {
		return 70;
	}

	if (k.includes('past') || k.includes('terminals')) {
		return 65;
	}

	if (k.includes('problems')) {
		return 60;
	}

	if (k.includes('git') && !k.includes('changes')) {
		return 55;
	}

	if (k.includes('agent') || k.includes('rules') || k.includes('alias') || k.includes('ref')) {
		return 50;
	}

	if (k.includes('bang') || k.includes('editor') || k.includes('always')) {
		return 45;
	}

	if (k.includes('file') || k === 'code') {
		return 20;
	}

	return 40;
}

function clipBlock(text: string, kind: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}

	if (maxChars < 40) {
		return { text: `[truncated ${kind}]`, truncated: true };
	}

	return {
		text: `${text.slice(0, maxChars - 24)}\n\n[truncated ${kind}]`,
		truncated: true,
	};
}

/**
 * Ужать блоки контекста (@ / bang / editor) под mentionBudget (токены).
 * Последний текст пользователя сюда не передаётся.
 */
export function fitMentionsToBudget(
	blocks: ContextBlock[],
	mentionBudgetTokens: number,
): FitMentionsResult {
	const budget = Math.max(64, Math.floor(mentionBudgetTokens));
	const nonEmpty = blocks
		.map((b) => ({
			...b,
			text: b.text.trim(),
			weight: b.weight || weightForKind(b.kind),
		}))
		.filter((b) => b.text);

	if (!nonEmpty.length) {
		return {
			contextText: '',
			truncated: false,
			truncatedKinds: [],
			tokensUsed: 0
		};
	}

	// Сортируем: лёгкие (низкий weight) сохраняем дольше - работаем от тяжёлых
	const ordered = [...nonEmpty].sort((a, b) => b.weight - a.weight || b.text.length - a.text.length);
	const kept = new Map<string, { kind: string; text: string; weight: number; order: number }>();
	nonEmpty.forEach((b, i) => {
		kept.set(`${i}:${b.kind}`, { ...b, order: i });
	});

	const truncatedKinds: string[] = [];
	let tokensUsed = () =>
		estimateTextTokens([...kept.values()].map((b) => b.text).join('\n\n'));

	// Фаза 1: выкидываем целые тяжёлые блоки, пока не влезем
	for (const heavy of ordered) {
		if (tokensUsed() <= budget) {
			break;
		}

		const key = [...kept.keys()].find((k) => kept.get(k)?.text === heavy.text && kept.get(k)?.kind === heavy.kind);
		if (!key) {
			continue;
		}

		// Не выкидываем последний лёгкий блок полностью, если можно обрезать
		if (kept.size <= 1) {
			break;
		}

		if (heavy.weight >= 45) {
			kept.delete(key);
			if (!truncatedKinds.includes(heavy.kind)) {
				truncatedKinds.push(heavy.kind);
			}
		}
	}

	// Фаза 2: пропорционально режем оставшиеся (сначала тяжёлые)
	let guard = 0;
	while (tokensUsed() > budget && guard < 40) {
		guard += 1;
		const list = [...kept.entries()].sort((a, b) => b[1].weight - a[1].weight || b[1].text.length - a[1].text.length);
		const [key, block] = list[0]!;
		const over = tokensUsed() - budget;
		const charsToCut = Math.max(80, over * 4);
		const nextLen = Math.max(48, block.text.length - charsToCut);
		const clipped = clipBlock(block.text, block.kind, nextLen);
		kept.set(key, { ...block, text: clipped.text });
		if (clipped.truncated && !truncatedKinds.includes(block.kind)) {
			truncatedKinds.push(block.kind);
		}

		if (block.text.length <= 48 && list.length > 1 && block.weight >= 45) {
			kept.delete(key);
		}
	}

	// Фаза 3: если всё ещё over - оставить один короткий digest
	if (tokensUsed() > budget) {
		const survivors = [...kept.values()].sort((a, b) => a.weight - b.weight);
		kept.clear();
		const labels = survivors.map((s) => s.kind).join(', ');
		const digest = `[truncated attachments: ${labels}]`.slice(0, Math.max(64, budget * 3));
		kept.set('digest', { kind: 'attachments', text: digest, weight: 0, order: 0 });
		for (const s of survivors) {
			if (!truncatedKinds.includes(s.kind)) {
				truncatedKinds.push(s.kind);
			}
		}
	}

	const finalBlocks = [...kept.values()].sort((a, b) => a.order - b.order);
	const contextText = finalBlocks.map((b) => b.text).join('\n\n');
	return {
		contextText,
		truncated: truncatedKinds.length > 0 || contextText.includes('[truncated'),
		truncatedKinds,
		tokensUsed: estimateTextTokens(contextText),
	};
}

// Оценка budget для mentions: turnBudget − history − lastUser − systemReserve
export function computeMentionBudgetTokens(input: {
	turnBudget: number;
	historyTokens: number;
	lastUserTokens: number;
	systemReserveTokens?: number;
}): number {
	const system = Math.max(0, input.systemReserveTokens ?? 400);
	const left = input.turnBudget - input.historyTokens - input.lastUserTokens - system;
	// Минимум оставляем немного места под вложения; если отрицательно - 0 (trim всё)
	return Math.max(0, left);
}
