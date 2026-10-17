import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cosineSimilarity, featureHashEmbed, LOCAL_VECTOR_MODEL, searchLocalVectors, syncLocalFeatureVectors, VECTOR_DIM } from '../features/index/vectorStore.js';
import { setIndexStorageRootForTests } from '../features/index/indexStorage.js';
import { saveManifest } from '../features/index/store.js';
import { emptyManifest } from '../features/index/types.js';
import { contentChunkId } from '../features/index/chunk.js';
import { aggregateRetrievalMetrics, assertRetrievalGate, DEFAULT_RETRIEVAL_GATE } from '../features/index/retrievalMetrics.js';

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
});
