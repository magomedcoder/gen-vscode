import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cosineSimilarity, featureHashEmbed, flushVectorsCache, getCachedRemoteVector, loadVectorsDocument, LOCAL_VECTOR_MODEL, putCachedRemoteVector, searchLocalVectors, syncLocalFeatureVectors, VECTOR_DIM, vectorsPathForFolder } from '../features/index/vectorStore.js';
import { setIndexStorageRootForTests } from '../features/index/indexStorage.js';
import { loadManifestCached, saveManifest } from '../features/index/store.js';
import { emptyManifest } from '../features/index/types.js';
import { contentChunkId } from '../features/index/chunk.js';
import { aggregateRetrievalMetrics, assertRetrievalGate, DEFAULT_RETRIEVAL_GATE } from './eval/retrievalMetrics.js';

suite('vectorStore feature-hash', () => {
	test('embed dim + cosine self≈1', () => {
		const a = featureHashEmbed('authenticateUser verifyToken session');
		assert.strictEqual(a.length, VECTOR_DIM);
		assert.ok(cosineSimilarity(a, a) > 0.99);
		const b = featureHashEmbed('renderButton label html');
		assert.ok(cosineSimilarity(a, b) < cosineSimilarity(a, featureHashEmbed('authenticateUser token')));
	});

	test('sync + search ranks auth over ui', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-vec-'));
		setIndexStorageRootForTests(root);
		const folder = path.join(root, 'ws');
		await fs.mkdir(folder, { recursive: true });

		const authText = 'export function authenticateUser(token: string) { return verifyToken(token); }';
		const uiText = 'export function renderButton(label: string) { return label; }';
		const authId = contentChunkId('src/auth/login.ts', authText);
		const uiId = contentChunkId('src/ui/button.ts', uiText);

		const manifest = emptyManifest();
		manifest.updatedAt = new Date().toISOString();
		manifest.chunks[authId] = {
			id: authId,
			path: 'src/auth/login.ts',
			startLine: 1,
			endLine: 1,
			text: authText,
		};
		manifest.chunks[uiId] = {
			id: uiId,
			path: 'src/ui/button.ts',
			startLine: 1,
			endLine: 1,
			text: uiText,
		};
		manifest.files['src/auth/login.ts'] = { hash: 'a', size: 1, chunkIds: [authId] };
		manifest.files['src/ui/button.ts'] = { hash: 'b', size: 1, chunkIds: [uiId] };
		await saveManifest(folder, manifest);

		const n = await syncLocalFeatureVectors(folder);
		assert.ok(n >= 2);

		const hits = await searchLocalVectors(folder, 'authenticateUser verifyToken', 5);
		assert.ok(hits.length >= 1);
		assert.strictEqual(hits[0]!.path, 'src/auth/login.ts');
		assert.ok(hits[0]!.score > 0);

		const only = await syncLocalFeatureVectors(folder, { onlyChunkIds: [authId] });
		assert.strictEqual(only, 0);

		setIndexStorageRootForTests(undefined);
		await fs.rm(root, { recursive: true, force: true });
	});

	test('offline local-vector retrieval gate', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-vec-gate-'));
		setIndexStorageRootForTests(root);
		const folder = path.join(root, 'ws');
		await fs.mkdir(folder, { recursive: true });

		const files: Array<{ path: string; text: string }> = [
			{
				path: 'src/auth/login.ts',
				text: 'export function authenticateUser(token: string) { return verifyToken(token); }',
			},
			{
				path: 'src/auth/session.ts',
				text: 'export class SessionManager { createSession(userId: string) { return { userId }; } }',
			},
			{
				path: 'src/db/query.ts',
				text: 'export function runSqlQuery(sql: string) { return executeSql(sql); }',
			},
			{
				path: 'src/ui/button.ts',
				text: 'export function renderButton(label: string) { return `<button>${label}</button>`; }',
			},
		];

		const manifest = emptyManifest();
		manifest.updatedAt = new Date().toISOString();
		for (const f of files) {
			const id = contentChunkId(f.path, f.text);
			manifest.chunks[id] = {
				id,
				path: f.path,
				startLine: 1,
				endLine: 1,
				text: f.text,
			};
			manifest.files[f.path] = { hash: id, size: f.text.length, chunkIds: [id] };
		}
		await saveManifest(folder, manifest);
		await syncLocalFeatureVectors(folder);

		const cases = [
			{
				query: 'authenticateUser token verify',
				relevant: ['src/auth/login.ts'],
			},
			{
				query: 'SessionManager createSession userId',
				relevant: ['src/auth/session.ts'],
			},
			{
				query: 'runSqlQuery executeSql',
				relevant: ['src/db/query.ts'],
			},
		];

		const k = DEFAULT_RETRIEVAL_GATE.k;
		const rankedCases = [];
		for (const c of cases) {
			const hits = await searchLocalVectors(folder, c.query, k);
			rankedCases.push({
				query: c.query,
				rankedPaths: hits.map((h) => h.path),
				relevant: c.relevant,
			});
		}
		const metrics = aggregateRetrievalMetrics(rankedCases, k);
		assertRetrievalGate(metrics, {
			...DEFAULT_RETRIEVAL_GATE,
			minMeanPrecisionAtK: 0.25,
			minSimpleScore: 0.55,
		});
		assert.strictEqual(LOCAL_VECTOR_MODEL.startsWith('local-'), true);

		setIndexStorageRootForTests(undefined);
		await fs.rm(root, { recursive: true, force: true });
	});

	test('remote vector cache: in-memory hit + batched flush', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-vec-remote-'));
		setIndexStorageRootForTests(root);
		const folder = path.join(root, 'ws');
		await fs.mkdir(folder, { recursive: true });

		const vec = [0.1, 0.2, 0.3];
		for (let i = 0; i < 5; i += 1) {
			await putCachedRemoteVector(folder, `h${i}`, 'remote-model', vec);
		}

		// hit из памяти, vectors.json ещё не записан (debounced batch)
		assert.deepStrictEqual(await getCachedRemoteVector(folder, 'h3', 'remote-model'), vec);
		const file = vectorsPathForFolder(folder)!;
		await assert.rejects(fs.stat(file));

		await flushVectorsCache(folder);
		const onDisk = await loadVectorsDocument(folder);
		assert.strictEqual(Object.keys(onDisk!.vectors).length, 5);

		setIndexStorageRootForTests(undefined);
		await fs.rm(root, { recursive: true, force: true });
	});

	test('loadManifestCached: reuse + invalidate on save', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-manifest-cache-'));
		setIndexStorageRootForTests(root);
		const folder = path.join(root, 'ws');
		await fs.mkdir(folder, { recursive: true });

		const manifest = emptyManifest();
		manifest.files['a.ts'] = { hash: 'a', size: 1, chunkIds: [] };
		await saveManifest(folder, manifest);
		const first = await loadManifestCached(folder);
		assert.strictEqual(await loadManifestCached(folder), first);

		manifest.files['b.ts'] = { hash: 'b', size: 1, chunkIds: [] };
		await saveManifest(folder, manifest);
		const second = await loadManifestCached(folder);
		assert.notStrictEqual(second, first);
		assert.ok(second.files['b.ts']);

		setIndexStorageRootForTests(undefined);
		await fs.rm(root, { recursive: true, force: true });
	});
});
