import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { getApiKey, buildAuthHeaders } from '../../core/config/apiKey';
import { getIndexManagerInstance } from './IndexManager';

export interface EmbeddingHit {
	path: string;
	score: number;
	snippet?: string;
	source?: 'remote' | 'trigram';
}

// Удалённый OpenAI-compatible POST /embeddings
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
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
	const res = await fetch(`${base}/embeddings`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model,
			input: texts,
		}),
		signal,
	});
	if (!res.ok) {
		throw new Error(`embeddings HTTP ${res.status}`);
	}

	const json = (await res.json()) as {
		data?: Array<{ embedding?: number[] }>;
		error?: { message?: string };
	};
	if (json.error?.message) {
		throw new Error(json.error.message);
	}

	const vectors = (json.data ?? []).map((d) => d.embedding ?? []);
	if (vectors.length !== texts.length) {
		throw new Error('embeddings: неожиданная длина ответа');
	}

	return vectors;
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

// Offline semantic-путь: поиск триграмм IndexManager
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
 * - off: только remote (ошибка, если нет base URL)
 * - trigram: remote при наличии; fallback на триграммы, если remote нет/упал
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

	// trigram (default): пробуем remote при URL, иначе / при сбое -> trigram
	if (!unavailable) {
		try {
			return await remoteSemanticSearchWorkspace(query, opts);
		} catch {
			// дальше
		}
	}

	const local = await trigramSemanticFallback(query, maxResults);
	if (local.length === 0 && unavailable) {
		throw new Error(
			'semantic_search: remote embeddings unavailable; trigram index empty or not ready',
		);
	}
	
	return local;
}

/**
 * Пересобрать local-hash векторы после индексации.
 * В этой сборке vector store не подключён - мягкий no-op (IndexManager ловит ошибки).
 */
export async function rebuildLocalVectorIndex(
	_folderFsPath: string,
	_opts?: { onlyChunkIds?: ReadonlyArray<string> },
): Promise<number> {
	return 0;
}
