import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { getApiKey, buildAuthHeaders } from '../../core/config/apiKey';
import { getIndexManagerInstance } from './IndexManager';
import { contentHash } from './hash';
import { isIndexStorageAvailable } from './indexStorage';
import { getCachedRemoteVector, putCachedRemoteVector, searchLocalVectors, syncLocalFeatureVectors } from './vectorStore';

export interface EmbeddingHit {
	path: string;
	score: number;
	snippet?: string;
	source?: 'remote' | 'trigram' | 'local-vector';
}

const EMBED_LIMITS = {
	batchSize: 32,
	maxRetries: 3,
	timeoutMs: 30_000,
	baseBackoffMs: 400,
} as const;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error('aborted'));
			return;
		}

		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(t);
				reject(signal.reason ?? new Error('aborted'));
			},
			{ once: true },
		);
	});
}

async function fetchEmbeddingsBatch(
	texts: string[],
	signal?: AbortSignal,
): Promise<number[][]> {
	const settings = getSettings();
	const base = (settings.embeddingsBaseUrl || settings.baseUrl).replace(/\/$/, '');
	const model = settings.embeddingsModel || 'text-embedding-3-small';
	if (!base) {
		throw new Error('embeddings: не задан baseUrl / embeddingsBaseUrl');
	}

	const apiKey = await getApiKey();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...buildAuthHeaders(apiKey, settings.authHeader, settings.authScheme),
	};

	let lastErr: unknown;
	for (let attempt = 0; attempt < EMBED_LIMITS.maxRetries; attempt += 1) {
		signal?.throwIfAborted();
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		signal?.addEventListener('abort', onAbort, { once: true });
		const timer = setTimeout(() => controller.abort(), EMBED_LIMITS.timeoutMs);
		try {
			const res = await fetch(`${base}/embeddings`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					model, 
					input: texts 
				}),
				signal: controller.signal,
			});

			if (res.status === 429 || res.status >= 500) {
				const retryAfter = Number(res.headers.get('Retry-After') || 0);
				const wait = retryAfter > 0
					? retryAfter * 1000
					: EMBED_LIMITS.baseBackoffMs * 2 ** attempt;
				lastErr = new Error(`embeddings HTTP ${res.status}`);
				await sleep(wait, signal);
				continue;
			}

			if (!res.ok) {
				throw new Error(`embeddings HTTP ${res.status}`);
			}

			const json = (await res.json()) as {
				data?: Array<{ embedding?: number[]; index?: number }>;
				error?: { message?: string };
			};

			if (json.error?.message) {
				throw new Error(json.error.message);
			}

			const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
			const vectors = data.map((d) => d.embedding ?? []);
			
			if (vectors.length !== texts.length) {
				throw new Error('embeddings: неожиданная длина ответа');
			}

			return vectors;
		} catch (err) {
			lastErr = err;
			if (attempt + 1 >= EMBED_LIMITS.maxRetries) {
				break;
			}

			await sleep(EMBED_LIMITS.baseBackoffMs * 2 ** attempt, signal);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}
	}

	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Удалённый OpenAI-совместимый POST /embeddings с пакетами, повторами и необязательным кэшем vectors.json
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
	if (texts.length === 0) {
		return [];
	}

	const settings = getSettings();
	const model = settings.embeddingsModel || 'text-embedding-3-small';
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const useCache = Boolean(folder && isIndexStorageAvailable());

	const out: (number[] | undefined)[] = new Array(texts.length);
	const missing: Array<{ i: number; text: string; hash: string }> = [];

	for (let i = 0; i < texts.length; i += 1) {
		const text = texts[i]!;
		const hash = contentHash(text);
		if (useCache && folder) {
			const cached = await getCachedRemoteVector(folder, hash, model);
			if (cached) {
				out[i] = cached;
				continue;
			}
		}

		missing.push({ i, text, hash });
	}

	for (let start = 0; start < missing.length; start += EMBED_LIMITS.batchSize) {
		const batch = missing.slice(start, start + EMBED_LIMITS.batchSize);
		const vectors = await fetchEmbeddingsBatch(
			batch.map((b) => b.text),
			signal,
		);

		for (let j = 0; j < batch.length; j += 1) {
			const item = batch[j]!;
			const vec = vectors[j] ?? [];
			out[item.i] = vec;
			if (useCache && folder && vec.length > 0) {
				try {
					await putCachedRemoteVector(folder, item.hash, model, vec);
				} catch {}
			}
		}
	}

	return out.map((v) => v ?? []);
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i += 1) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}

	if (na === 0 || nb === 0) {
		return 0;
	}

	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function remoteEmbeddingsUnavailable(): boolean {
	const settings = getSettings();
	const base = (settings.embeddingsBaseUrl || settings.baseUrl).replace(/\/$/, '');
	return !base;
}

export async function trigramSemanticFallback(
	query: string,
	maxResults: number,
): Promise<EmbeddingHit[]> {
	const manager = getIndexManagerInstance();
	if (!manager) {
		return [];
	}

	const hits = await manager.search(query, maxResults);
	const maxScore = Math.max(1, ...hits.map((h) => h.score), 1);
	return hits.map((h) => ({
		path: h.path,
		score: Math.min(1, h.score / maxScore),
		snippet: h.snippet.slice(0, 240),
		source: 'trigram' as const,
	}));
}

export async function localVectorSemanticSearch(
	query: string,
	maxResults: number,
): Promise<EmbeddingHit[]> {
	const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!folder || !isIndexStorageAvailable()) {
		return [];
	}

	const hits = await searchLocalVectors(folder, query, maxResults);
	return hits.map((h) => ({
		path: h.path,
		score: h.score,
		snippet: h.snippet,
		source: 'local-vector' as const,
	}));
}

async function remoteSemanticSearchWorkspace(
	query: string,
	opts?: { maxFiles?: number; maxResults?: number; signal?: AbortSignal },
): Promise<EmbeddingHit[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const maxFiles = opts?.maxFiles ?? 40;
	const maxResults = opts?.maxResults ?? 8;
	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,py,go,rs,md}'),
		'**/{node_modules,.git,.gen,dist,out}/**',
		maxFiles,
	);

	const snippets: Array<{ path: string; text: string }> = [];
	for (const uri of uris) {
		opts?.signal?.throwIfAborted();
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(bytes).slice(0, 1200);
			if (text.trim()) {
				snippets.push({
					path: vscode.workspace.asRelativePath(uri),
					text,
				});
			}
		} catch {
			continue;
		}
	}

	if (snippets.length === 0) {
		return [];
	}

	const [qVec, ...docVecs] = await embedTexts(
		[query, ...snippets.map((s) => s.text)],
		opts?.signal,
	);
	const scored = snippets.map((s, i) => ({
		path: s.path,
		score: cosine(qVec!, docVecs[i] ?? []),
		snippet: s.text.slice(0, 240),
		source: 'remote' as const,
	}));
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxResults);
}

/**
 * Семантический поиск с localEmbeddingsMode:
 * - off: только удалённый
 * - trigram: удалённый -> резервный trigram
 * - vector: удалённый -> локальный feature-hash -> trigram
 */
export async function semanticSearchWorkspace(
	query: string,
	opts?: { maxFiles?: number; maxResults?: number; signal?: AbortSignal },
): Promise<EmbeddingHit[]> {
	const settings = getSettings();
	const mode = settings.localEmbeddingsMode;
	const maxResults = opts?.maxResults ?? 8;
	const unavailable = remoteEmbeddingsUnavailable();

	if (mode === 'off') {
		if (unavailable) {
			throw new Error(
				'semantic_search: remote embeddings unavailable (localEmbeddingsMode=off)',
			);
		}
		return remoteSemanticSearchWorkspace(query, opts);
	}

	if (!unavailable) {
		try {
			return await remoteSemanticSearchWorkspace(query, opts);
		} catch {}
	}

	if (mode === 'vector') {
		const local = await localVectorSemanticSearch(query, maxResults);
		if (local.length > 0) {
			return local;
		}
	}

	const trigram = await trigramSemanticFallback(query, maxResults);
	if (trigram.length === 0 && unavailable) {
		throw new Error(
			'semantic_search: remote embeddings unavailable; local index empty or not ready',
		);
	}
	return trigram;
}

// Пересобрать локальные feature-hash векторы после индексации (только изменённые при onlyChunkIds).
export async function rebuildLocalVectorIndex(
	folderFsPath: string,
	opts?: { onlyChunkIds?: ReadonlyArray<string> },
): Promise<number> {
	const settings = getSettings();
	if (settings.localEmbeddingsMode !== 'vector') {
		return 0;
	}

	if (!isIndexStorageAvailable()) {
		return 0;
	}

	return syncLocalFeatureVectors(folderFsPath, { 
		onlyChunkIds: opts?.onlyChunkIds 
	});
}
