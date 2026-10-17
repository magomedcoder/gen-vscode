import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
	url: string;
	text: string;
	fetchedAt: number;
	sha256: string;
}

function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseSource(raw: string, explicitIntegrity?: string): { url: string; integrity?: string } {
	const url = new URL(raw);
	let integrity = explicitIntegrity?.trim().toLowerCase().replace(/^sha256[=:-]/, '');
	const fragment = url.hash.slice(1);
	if (!integrity && /^sha256=[a-fA-F0-9]{64}$/.test(fragment)) {
		integrity = fragment.slice('sha256='.length).toLowerCase();
		url.hash = '';
	}

	return { 
		url: url.toString(), 
		...(integrity ? { integrity } : {}) 
	};
}

function cachePath(url: string): string {
	const key = createHash('sha256').update(url).digest('hex');
	return path.join(os.homedir(), '.cache', 'gen-vscode', 'remote-text', `${key}.json`);
}

async function readCache(url: string): Promise<CacheEntry | undefined> {
	try {
		const parsed = JSON.parse(await fs.readFile(cachePath(url), 'utf8')) as CacheEntry;
		return parsed.url === url
			&& typeof parsed.text === 'string'
			&& parsed.sha256 === sha256(parsed.text)
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

async function writeCache(entry: CacheEntry): Promise<void> {
	const file = cachePath(entry.url);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(entry), 'utf8');
}

function cappedResult(entry: CacheEntry, maxChars: number, stale = false) {
	const capped = entry.text.length > maxChars
		? `${entry.text.slice(0, maxChars)}\n\n[truncated]`
		: entry.text;

	return { 
		ok: true as const, 
		text: capped, 
		url: entry.url, 
		stale, 
		sha256: entry.sha256 
	};
}

// Скачать текст по HTTPS (только https). Обрезка по maxChars
export async function fetchHttpsText(
	urlRaw: string,
	maxChars: number,
	opts?: { 
		signal?: AbortSignal; 
		timeoutMs?: number;
		integrity?: string;
		cacheTtlMs?: number;
	},
): Promise<{
	ok: true;
	text: string;
	url: string;
	stale: boolean;
	sha256: string;
} | {
	ok: false;
	reason: string
}> {
	const trimmed = urlRaw.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return {
			ok: false,
			reason: 'пустой URL'
		};
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return {
			ok: false,
			reason: 'невалидный URL'
		};
	}

	if (url.protocol !== 'https:') {
		return {
			ok: false,
			reason: 'разрешён только HTTPS'
		};
	}
	const source = parseSource(trimmed, opts?.integrity);
	const cached = await readCache(source.url);
	if (cached && (!source.integrity || cached.sha256 === source.integrity) && Date.now() - cached.fetchedAt <= (opts?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)) {
		return cappedResult(cached, maxChars);
	}

	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	opts?.signal?.addEventListener('abort', onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(source.url, {
			method: 'GET',
			signal: controller.signal,
			headers: {
				Accept: 'text/plain, text/markdown, text/*, */*',
			},
		});
		if (!res.ok) {
			if (cached && (!source.integrity || cached.sha256 === source.integrity)) {
				return cappedResult(cached, maxChars, true);
			}

			return {
				ok: false,
				reason: `HTTP ${res.status}`
			};
		}

		const text = await res.text();
		const digest = sha256(text);
		if (source.integrity && digest !== source.integrity) {
			return { ok: false, reason: 'SHA-256 integrity mismatch' };
		}

		const entry = { url: source.url, text, fetchedAt: Date.now(), sha256: digest };
		await writeCache(entry).catch(() => undefined);
		return cappedResult(entry, maxChars);
	} catch (err) {
		if (cached && (!source.integrity || cached.sha256 === source.integrity)) {
			return cappedResult(cached, maxChars, true);
		}
		
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			reason: msg
		};
	} finally {
		clearTimeout(timer);
		opts?.signal?.removeEventListener('abort', onAbort);
	}
}
