/**
 * Локальные плотные feature-hash векторы и постоянный vectors.json (локальный/удалённый кэш).
 * localEmbeddingsMode=vector: rebuildLocalVectorIndex синхронизирует эмбеддинги чанков при fullIndex/reindex.
 */

import * as fs from 'node:fs/promises';
import { contentHash } from './hash';
import { indexDirForFolder, indexFilePath, isIndexStorageAvailable } from './indexStorage';
import { loadManifest } from './store';
import type { IndexChunk, IndexManifest } from './types';

export const INDEX_VECTORS_FILE = 'vectors.json';
export const LOCAL_VECTOR_MODEL = 'local-feature-hash-v1';
export const VECTOR_DIM = 256;

export type VectorEntry = {
	hash: string;
	model: string;
	vec: number[];
};

export type VectorsDocument = {
	version: 1;
	updatedAt: string;
	model: string;
	vectors: Record<string, VectorEntry>;
};

export function emptyVectorsDocument(model = LOCAL_VECTOR_MODEL): VectorsDocument {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		model,
		vectors: {},
	};
}

export function vectorsPathForFolder(folderFsPath: string): string | undefined {
	return indexFilePath(folderFsPath, INDEX_VECTORS_FILE);
}

export async function loadVectorsDocument(folderFsPath: string): Promise<VectorsDocument | undefined> {
	const file = vectorsPathForFolder(folderFsPath);
	if (!file) {
		return undefined;
	}

	try {
		const raw = await fs.readFile(file, 'utf8');
		return parseVectorsJson(raw);
	} catch {
		return undefined;
	}
}

export function parseVectorsJson(raw: string): VectorsDocument | undefined {
	try {
		const parsed = JSON.parse(raw) as VectorsDocument;
		if (!parsed || typeof parsed !== 'object' || !parsed.vectors || typeof parsed.vectors !== 'object') {
			return undefined;
		}

		return {
			version: 1,
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
			model: typeof parsed.model === 'string' ? parsed.model : LOCAL_VECTOR_MODEL,
			vectors: parsed.vectors,
		};
	} catch {
		return undefined;
	}
}

export async function saveVectorsDocument(folderFsPath: string, doc: VectorsDocument): Promise<void> {
	const dir = indexDirForFolder(folderFsPath);
	const file = vectorsPathForFolder(folderFsPath);
	if (!dir || !file) {
		throw new Error('vectorStore: index storage unavailable');
	}

	await fs.mkdir(dir, { recursive: true });
	doc.updatedAt = new Date().toISOString();
	await fs.writeFile(file, JSON.stringify(doc), 'utf8');
}

// Хеш FNV-1a, 32-bit
function fnv1a(str: string): number {
	let h = 2166136261;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}

	return h >>> 0;
}

function tokenize(text: string): string[] {
	const out: string[] = [];
	const re = /[A-Za-z_][A-Za-z0-9_]+|[А-Яа-яЁё]{2,}|\d+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const t = m[0].toLowerCase();
		if (t.length >= 2) {
			out.push(t);
		}
	}

	return out;
}

// Эмбеддинг feature-hash: фиксированная размерность, знаковое ±1 на токен, L2-нормализация
export function featureHashEmbed(text: string, dim = VECTOR_DIM): number[] {
	const vec = new Float64Array(dim);
	const tokens = tokenize(text);
	if (tokens.length === 0) {
		return Array.from(vec);
	}

	for (const tok of tokens) {
		const h = fnv1a(tok);
		const idx = h % dim;
		const sign = (h & 1) === 0 ? 1 : -1;
		vec[idx]! += sign;
		// биграммы (локальный контекст)
		const h2 = fnv1a(`#${tok}`);
		vec[h2 % dim]! += sign * 0.5;
	}

	let norm = 0;
	for (let i = 0; i < dim; i += 1) {
		norm += vec[i]! * vec[i]!;
	}

	norm = Math.sqrt(norm) || 1;
	const out = new Array<number>(dim);
	for (let i = 0; i < dim; i += 1) {
		out[i] = vec[i]! / norm;
	}

	return out;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	const n = Math.min(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
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

function chunkBodyHash(chunk: IndexChunk): string {
	return contentHash(chunk.text);
}

// Добавить или обновить локальные feature-hash векторы чанков; удалить отсутствующие в манифесте
export async function syncLocalFeatureVectors(
	folderFsPath: string,
	opts?: { onlyChunkIds?: ReadonlyArray<string>; manifest?: IndexManifest },
): Promise<number> {
	if (!isIndexStorageAvailable()) {
		return 0;
	}

	const manifest = opts?.manifest ?? (await loadManifest(folderFsPath));
	const only = opts?.onlyChunkIds ? new Set(opts.onlyChunkIds) : undefined;
	let doc = (await loadVectorsDocument(folderFsPath)) ?? emptyVectorsDocument(LOCAL_VECTOR_MODEL);

	// Несовпадение модели -> полная пересборка локального хранилища
	if (doc.model !== LOCAL_VECTOR_MODEL) {
		doc = emptyVectorsDocument(LOCAL_VECTOR_MODEL);
	}

	const liveIds = new Set(Object.keys(manifest.chunks));
	for (const id of Object.keys(doc.vectors)) {
		const entry = doc.vectors[id];
		if (!entry || entry.model !== LOCAL_VECTOR_MODEL || !liveIds.has(id)) {
			delete doc.vectors[id];
		}
	}

	let updated = 0;
	const targets = only
		? [...only].filter((id) => manifest.chunks[id])
		: Object.keys(manifest.chunks);

	for (const id of targets) {
		const chunk = manifest.chunks[id];
		if (!chunk) {
			continue;
		}

		const hash = chunkBodyHash(chunk);
		const prev = doc.vectors[id];
		if (prev && prev.hash === hash && prev.model === LOCAL_VECTOR_MODEL && prev.vec?.length === VECTOR_DIM) {
			continue;
		}

		doc.vectors[id] = {
			hash,
			model: LOCAL_VECTOR_MODEL,
			vec: featureHashEmbed(chunk.text),
		};
		updated += 1;
	}

	await saveVectorsDocument(folderFsPath, doc);
	return updated;
}

export type LocalVectorHit = {
	chunkId: string;
	path: string;
	score: number;
	snippet: string;
	startLine: number;
	endLine: number;
};

export async function searchLocalVectors(
	folderFsPath: string,
	query: string,
	maxResults: number,
): Promise<LocalVectorHit[]> {
	const manifest = await loadManifest(folderFsPath);
	let doc = await loadVectorsDocument(folderFsPath);
	if (!doc || doc.model !== LOCAL_VECTOR_MODEL || Object.keys(doc.vectors).length === 0) {
		await syncLocalFeatureVectors(folderFsPath, { manifest });
		doc = await loadVectorsDocument(folderFsPath);
	}

	if (!doc) {
		return [];
	}

	const q = featureHashEmbed(query);
	const scored: LocalVectorHit[] = [];
	for (const [chunkId, entry] of Object.entries(doc.vectors)) {
		if (entry.model !== LOCAL_VECTOR_MODEL) {
			continue;
		}

		const chunk = manifest.chunks[chunkId];
		if (!chunk) {
			continue;
		}

		const score = cosineSimilarity(q, entry.vec);
		if (score <= 0) {
			continue;
		}

		scored.push({
			chunkId,
			path: chunk.path,
			score,
			snippet: chunk.text.slice(0, 240),
			startLine: chunk.startLine,
			endLine: chunk.endLine,
		});
	}

	scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
	return scored.slice(0, Math.max(1, maxResults));
}

// Кэшировать удалённый эмбеддинг для текстового ключа (хэш содержимого и модель)
export async function getCachedRemoteVector(
	folderFsPath: string,
	textHash: string,
	model: string,
): Promise<number[] | undefined> {
	const doc = await loadVectorsDocument(folderFsPath);
	if (!doc) {
		return undefined;
	}

	const key = `remote:${model}:${textHash}`;
	const entry = doc.vectors[key];
	if (entry && entry.model === model && entry.hash === textHash && entry.vec?.length) {
		return entry.vec;
	}

	return undefined;
}

export async function putCachedRemoteVector(
	folderFsPath: string,
	textHash: string,
	model: string,
	vec: number[],
): Promise<void> {
	if (!isIndexStorageAvailable()) {
		return;
	}

	let doc = (await loadVectorsDocument(folderFsPath)) ?? emptyVectorsDocument(model);
	const key = `remote:${model}:${textHash}`;
	doc.vectors[key] = { 
		hash: textHash, 
		model, 
		vec 
	};

	// Сохранить тег локальной модели для смешанных документов: выбрать LOCAL при наличии локального
	const hasLocal = Object.values(doc.vectors).some((v) => v.model === LOCAL_VECTOR_MODEL);
	if (!hasLocal) {
		doc.model = model;
	} else if (doc.model !== LOCAL_VECTOR_MODEL) {
		doc.model = LOCAL_VECTOR_MODEL;
	}

	await saveVectorsDocument(folderFsPath, doc);
}

export function localVectorCount(doc: VectorsDocument | undefined): number {
	if (!doc) {
		return 0;
	}
	
	return Object.values(doc.vectors).filter((v) => v.model === LOCAL_VECTOR_MODEL).length;
}
