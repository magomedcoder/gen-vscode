import type { GenSettings, WebSearchBackend } from '../../../core/config/types';
import { getResolvedSecret } from '../../../core/config/secretVault';

// Один результат веб-поиска
export interface WebSearchHit {
	title: string;
	url: string;
}

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const PARALLEL_SEARCH_URL = 'https://api.parallel.ai/v1/search';

// Собрать URL HTTP-бэкенда: подставить `{query}` или дописать `?q=` / `&q=`.
function buildWebSearchHttpUrl(template: string, query: string): string {
	const trimmed = template.trim();
	const encoded = encodeURIComponent(query);
	if (!trimmed) {
		return '';
	}

	if (trimmed.includes('{query}')) {
		return trimmed.replaceAll('{query}', encoded);
	}

	const sep = trimmed.includes('?') ? '&' : '?';
	return `${trimmed}${sep}q=${encoded}`;
}

// Title из API: пустая строка, null и пробелы -> fallback на url (Exa/Parallel)
export function normalizeWebSearchTitle(title: unknown, url: string): string {
	const fromString = typeof title === 'string' ? title.trim() : '';
	if (fromString) {
		return fromString;
	}

	return url;
}

/**
 * Извлечь title/url из произвольного объекта результата.
 * Если title пуст - подставляем url (Parallel может отдать title=null).
 */
function hitFromUnknown(item: unknown): WebSearchHit | undefined {
	if (!item || typeof item !== 'object') {
		return undefined;
	}

	const row = item as Record<string, unknown>;
	const urlRaw = typeof row.url === 'string' ? row.url
		: typeof row.link === 'string' ? row.link
			: typeof row.href === 'string' ? row.href
				: '';
	const url = urlRaw.trim();
	if (!/^https?:\/\//i.test(url)) {
		return undefined;
	}

	const titleCandidate = typeof row.title === 'string' || row.title === null || row.title === undefined
		? row.title
		: typeof row.name === 'string'
			? row.name
			: '';
	return {
		title: normalizeWebSearchTitle(titleCandidate, url),
		url,
	};
}

/**
 * Разобрать типичные JSON-формы: `{results:[...]}`, `{organic_results:[...]}`, голый массив.
 * Ожидаемые поля элемента: `title`/`name` + `url`/`link`/`href` (title опционален * fallback на url).
 */
function parseWebSearchJson(data: unknown, cap: number): WebSearchHit[] {
	let list: unknown[] = [];
	if (Array.isArray(data)) {
		list = data;
	} else if (data && typeof data === 'object') {
		const obj = data as Record<string, unknown>;
		if (Array.isArray(obj.results)) {
			list = obj.results;
		} else if (Array.isArray(obj.organic_results)) {
			list = obj.organic_results;
		} else if (Array.isArray(obj.items)) {
			list = obj.items;
		}
	}

	const out: WebSearchHit[] = [];
	const seen = new Set<string>();
	for (const item of list) {
		if (out.length >= cap) {
			break;
		}

		const hit = hitFromUnknown(item);
		if (hit && !seen.has(hit.url)) {
			out.push(hit);
			seen.add(hit.url);
		}
	}

	return out;
}

export function parseExaSearchJson(data: unknown, cap: number): WebSearchHit[] {
	if (!data || typeof data !== 'object') {
		return [];
	}

	const obj = data as Record<string, unknown>;
	
	return parseWebSearchJson(Array.isArray(obj.results) ? obj.results : obj.data, cap);
}

export function parseParallelSearchJson(data: unknown, cap: number): WebSearchHit[] {
	if (!data || typeof data !== 'object') {
		return [];
	}
	
	const obj = data as Record<string, unknown>;
	const results = obj.results;
	if (Array.isArray(results)) {
		return parseWebSearchJson(results, cap);
	}

	if (results && typeof results === 'object') {
		const nested = results as Record<string, unknown>;
		return parseWebSearchJson(nested.pages ?? nested.results ?? nested.items, cap);
	}

	return parseWebSearchJson(obj.data, cap);
}

async function resolveWebSearchApiKey(backendLabel: string): Promise<string> {
	// SecretStorage (+ optional `${env:}` / `{file:}` в значении секрета)
	const apiKey = await getResolvedSecret('webSearchApiKey');
	if (!apiKey) {
		throw new Error(`web_search: задай webSearchApiKey (Settings -> SecretStorage) для бэкенда ${backendLabel}`);
	}

	return apiKey;
}

async function postJsonSearch(
	url: string,
	body: unknown,
	headers: Record<string, string>,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	const res = await fetch(url, {
		method: 'POST',
		signal,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'User-Agent': 'GenAgentVSCode/0.2',
			...headers,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`web_search: HTTP ${res.status}`);
	}

	try {
		return await res.json();
	} catch {
		throw new Error('web_search: ответ не JSON');
	}
}

// DuckDuckGo HTML-выдача (без API-ключа)
async function searchDuckDuckGo(
	query: string,
	cap: number,
	signal?: AbortSignal,
): Promise<WebSearchHit[]> {
	const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	const res = await fetch(url, {
		signal,
		headers: {
			'User-Agent': 'GenAgentVSCode/0.2',
		},
	});
	if (!res.ok) {
		throw new Error(`web_search: HTTP ${res.status}`);
	}

	const html = await res.text();
	const results: WebSearchHit[] = [];
	const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) && results.length < cap) {
		const href = m[1]!;
		const title = m[2]!.replace(/<[^>]+>/g, '').trim();
		if (href && title) {
			results.push({ title, url: href });
		}
	}

	return results;
}

/**
 * Exa Search API (по best-effort): POST https://api.exa.ai/search
 * Auth: `x-api-key` из SecretStorage `webSearchApiKey`.
 * Тело: `{ query, numResults }` - без contents (только ссылки).
 * Ответ: `{ results: [{ title, url, ... }] }`.
 * Документация: https://exa.ai/docs/reference/search
 */
async function searchExa(
	query: string,
	cap: number,
	signal: AbortSignal | undefined,
): Promise<WebSearchHit[]> {
	const apiKey = await resolveWebSearchApiKey('exa');
	const data = await postJsonSearch(
		EXA_SEARCH_URL,
		{ 
			query, 
			numResults: cap, 
			type: 'auto' 
		},
		{ 
			'x-api-key': apiKey 
		},
		signal,
	);
	return parseExaSearchJson(data, cap);
}

/**
 * Parallel Web Search API (по best-effort): POST https://api.parallel.ai/v1/search
 * Auth: `x-api-key` из SecretStorage `webSearchApiKey`.
 * Тело: `{ objective, search_queries, mode: "fast", advanced_settings: { max_results } }`.
 * Ответ: `{ results: [{ url, title?, excerpts[] }] }` - title может быть null.
 * Документация: https://docs.parallel.ai/api-reference/search/search
 */
async function searchParallel(
	query: string,
	cap: number,
	signal: AbortSignal | undefined,
): Promise<WebSearchHit[]> {
	const apiKey = await resolveWebSearchApiKey('parallel');
	const data = await postJsonSearch(
		PARALLEL_SEARCH_URL,
		{
			objective: query,
			search_queries: [query],
			mode: 'fast',
			advanced_settings: { 
				max_results: cap 
			},
		},
		{ 
			'x-api-key': apiKey 
		},
		signal,
	);

	return parseParallelSearchJson(data, cap);
}

/**
 * HTTP JSON API: GET по URL из настроек, опциональный auth-заголовок.
 * Ключ - SecretStorage; в значении секрета можно `${env:}` / `{file:}`.
 */
async function searchHttpJson(
	query: string,
	cap: number,
	signal: AbortSignal | undefined,
	settings: Pick<GenSettings, 'webSearchHttpUrl' | 'webSearchHttpHeader'>,
): Promise<WebSearchHit[]> {
	const url = buildWebSearchHttpUrl(settings.webSearchHttpUrl, query);
	if (!url) {
		throw new Error('web_search: задай webSearchHttpUrl для HTTP-бэкенда');
	}

	const headers: Record<string, string> = {
		Accept: 'application/json',
		'User-Agent': 'GenAgentVSCode/0.2',
	};
	const apiKey = await getResolvedSecret('webSearchApiKey');
	const headerName = (settings.webSearchHttpHeader || 'Authorization').trim();
	if (apiKey && headerName) {
		headers[headerName] = apiKey;
	}

	const res = await fetch(url, { signal, headers });
	if (!res.ok) {
		throw new Error(`web_search: HTTP ${res.status}`);
	}

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw new Error('web_search: ответ не JSON');
	}

	return parseWebSearchJson(data, cap);
}

// Диспетчер web_search по выбранному бэкенду
export async function runWebSearch(
	backend: WebSearchBackend,
	query: string,
	cap: number,
	signal: AbortSignal | undefined,
	settings: Pick<GenSettings, 'webSearchHttpUrl' | 'webSearchHttpHeader'>,
): Promise<WebSearchHit[]> {
	switch (backend) {
		case 'exa':
			return searchExa(query, cap, signal);
		case 'parallel':
			return searchParallel(query, cap, signal);
		case 'http':
			return searchHttpJson(query, cap, signal, settings);
		case 'duckduckgo':
		default:
			return searchDuckDuckGo(query, cap, signal);
	}
}
