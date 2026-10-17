// Лимит JSON-ответа find_code (символы)
export const FIND_CODE_MAX_CHARS = 12_000;

// Сырой hit от одного бэкенда до слияния (merge)
export interface FindCodeRawHit {
	path: string;
	line?: number;
	snippet?: string;
	score: number;
	source: string;
	why: string;
}

export interface FindCodeMergedHit {
	path: string;
	line?: number;
	snippet?: string;
	score: number;
	sources: string[];
	why: string;
}

// Опциональные boosts ранжирования (git dirty / recent / path)
export interface FindCodeMergeBoosts {
	// Изменённые файлы (git dirty)
	dirtyPaths?: Iterable<string>;
	// Недавно открытые / тронутые пути
	recentPaths?: Iterable<string>;
	// Доп. boost если query встречается в path (0..1)
	pathQuery?: string;
	dirtyBoost?: number;
	recentBoost?: number;
	pathBoost?: number;
}

function hitKey(path: string, line?: number): string {
	return line !== undefined ? `${path}:${line}` : path;
}

function toPathSet(paths?: Iterable<string>): Set<string> {
	const set = new Set<string>();
	if (!paths) {
		return set;
	}

	for (const p of paths) {
		const norm = p.trim().replace(/\\/g, '/');
		if (norm) {
			set.add(norm);
		}
	}

	return set;
}

function pathMatchesBoost(hitPath: string, boostPaths: Set<string>): boolean {
	if (boostPaths.has(hitPath)) {
		return true;
	}

	for (const p of boostPaths) {
		if (hitPath === p || hitPath.startsWith(`${p}/`) || p.startsWith(`${hitPath}/`)) {
			return true;
		}
	}

	return false;
}

// Дедуп по path (+ line если есть), boost за несколько источников и опционально dirty/recent/path, сортировка по score.
export function mergeFindCodeHits(
	raw: FindCodeRawHit[],
	maxResults: number,
	boosts?: FindCodeMergeBoosts,
): FindCodeMergedHit[] {
	const byKey = new Map<string, FindCodeMergedHit>();
	const dirty = toPathSet(boosts?.dirtyPaths);
	const recent = toPathSet(boosts?.recentPaths);
	const dirtyBoost = boosts?.dirtyBoost ?? 0.08;
	const recentBoost = boosts?.recentBoost ?? 0.05;
	const pathBoost = boosts?.pathBoost ?? 0.06;
	const pathQuery = boosts?.pathQuery?.trim().toLowerCase() ?? '';

	for (const hit of raw) {
		const path = hit.path.trim();
		if (!path) {
			continue;
		}

		const key = hitKey(path, hit.line);
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, {
				path,
				line: hit.line,
				snippet: hit.snippet,
				score: hit.score,
				sources: [hit.source],
				why: hit.why,
			});
			continue;
		}

		if (!existing.sources.includes(hit.source)) {
			existing.sources.push(hit.source);
		}
		// Храним max сырой score; boost за multi-source - после цикла
		if (hit.score > existing.score) {
			existing.score = hit.score;
		}

		const nextSnippet = hit.snippet?.trim() ?? '';
		const prevSnippet = existing.snippet?.trim() ?? '';
		if (nextSnippet.length > prevSnippet.length) {
			existing.snippet = hit.snippet;
		}

		if (hit.why && !existing.why.includes(hit.why)) {
			existing.why = `${existing.why}; ${hit.why}`;
		}
	}

	const merged = [...byKey.values()].map((h) => {
		let score = h.score + 0.05 * Math.max(0, h.sources.length - 1);
		const whyParts = [h.why];

		if (dirty.size > 0 && pathMatchesBoost(h.path, dirty)) {
			score += dirtyBoost;
			whyParts.push('git dirty');
		}

		if (recent.size > 0 && pathMatchesBoost(h.path, recent)) {
			score += recentBoost;
			whyParts.push('recent');
		}

		if (pathQuery && h.path.toLowerCase().includes(pathQuery)) {
			score += pathBoost;
			whyParts.push('path match');
		}

		return {
			...h,
			score: Math.min(1, score),
			why: whyParts.filter(Boolean).join('; '),
		};
	});

	return merged
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.slice(0, Math.max(1, maxResults));
}

// Укоротить JSON до maxChars, сохранив валидный объект с truncated=true
export function truncateFindCodeJson(payload: Record<string, unknown>, maxChars: number): string {
	const full = JSON.stringify(payload, null, 2);
	if (full.length <= maxChars) {
		return full;
	}

	const hits = Array.isArray(payload.hits) ? [...(payload.hits as unknown[])] : [];
	let next = { 
		...payload, 
		hits, 
		truncated: true 
	};
	while (hits.length > 1 && JSON.stringify(next, null, 2).length > maxChars) {
		hits.pop();
		next = { 
			...payload, 
			hits, 
			truncated: true 
		};
	}

	const clipped = JSON.stringify(next, null, 2);
	if (clipped.length <= maxChars) {
		return clipped;
	}

	return JSON.stringify({
		query: payload.query,
		intent: payload.intent,
		hits: [],
		notes: [...(Array.isArray(payload.notes) ? payload.notes as string[] : []), 'ответ обрезан по лимиту символов'],
		truncated: true,
	}, null, 2);
}
