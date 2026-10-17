import * as assert from 'assert';
import { chunkFileContent } from '../features/index/chunk.js';
import { canSkipDirRewalk, recomputeDirDigests } from '../features/index/dirDigests.js';
import { contentHash } from '../features/index/hash.js';
import { createIndexAbortError, IndexAbortFlag, isIndexAbortError, needsManifestRepair, parseManifestJson, repairManifestInMemory, summarizePartialErrors } from '../features/index/manifestParse.js';
import { buildTrigramIndex, searchTrigrams, tokenize } from '../features/index/trigram.js';
import type { IndexManifest } from '../features/index/types.js';
import { parseSymbolIndexJson, applySymbolPathUpdate, applySymbolPathRemove } from '../features/index/symbolIndexParse.js';

suite('contentHash', () => {
	test('стабильный sha256', () => {
		const a = contentHash('hello');
		const b = contentHash('hello');
		assert.notStrictEqual(a, 'hello');
		assert.strictEqual(a, b);
	});
});

suite('dirDigests', () => {
	test('пересчитывает Merkle digests по file hashes', () => {
		const digests = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1'
			 },
			'src/b.ts': { 
				hash: 'h2'
			 },
			'README.md': { 
				hash: 'h3'
			 },
		});
		assert.ok(digests['']);
		assert.ok(digests['src']);
		assert.notStrictEqual(digests[''], digests['src']);

		const again = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1' 
			},
			'src/b.ts': { 
				hash: 'h2' 
			},
			'README.md': { 
				hash: 'h3' 
			},
		});
		assert.strictEqual(digests['src'], again['src']);

		const changed = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1-changed' 
			},
			'src/b.ts': { 
				hash: 'h2' 
			},
			'README.md': { 
				hash: 'h3' 
			},
		});
		assert.notStrictEqual(digests['src'], changed['src']);
	});

	test('canSkipDirRewalk при content-hash (или size+mtime)', () => {
		const files = {
			'src/a.ts': {
				hash: 'h1',
				size: 10,
				mtimeMs: 1000,
				chunkIds: [] as string[],
			},
			'src/b.ts': {
				hash: 'h2',
				size: 20,
				mtimeMs: 2000,
				chunkIds: [] as string[],
			},
		};
		const digests = recomputeDirDigests(files);
		const manifest: IndexManifest = {
			version: 2,
			updatedAt: '',
			files,
			chunks: {},
			trigrams: {},
			dirDigests: digests,
		};

		// Явный content-hash
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 10,
					contentHash: 'h1'
				},
				{
					relative: 'src/b.ts',
					size: 20,
					contentHash: 'h2'
				},
			]),
			true,
		);

		// size+mtime gate (доверенный stored hash)
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 10,
					mtimeMs: 1000
				},
				{
					relative: 'src/b.ts',
					size: 20,
					mtimeMs: 2000
				},
			]),
			true,
		);

		// Только size - недостаточно
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 10
				},
				{
					relative: 'src/b.ts',
					size: 20
				},
			]),
			false,
		);

		// Неверный hash
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 10,
					contentHash: 'h1-changed'
				},
				{
					relative: 'src/b.ts',
					size: 20,
					contentHash: 'h2'
				},
			]),
			false,
		);

		// size изменился
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 11,
					contentHash: 'h1'
				},
				{
					relative: 'src/b.ts',
					size: 20,
					contentHash: 'h2'
				},
			]),
			false,
		);

		// mtime изменился без contentHash
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{
					relative: 'src/a.ts',
					size: 10,
					mtimeMs: 1001
				},
				{
					relative: 'src/b.ts',
					size: 20,
					mtimeMs: 2000
				},
			]),
			false,
		);
	});
});

suite('symbolIndex parse', () => {
	test('parseSymbolIndexJson читает валидный кэш', () => {
		const raw = JSON.stringify({
			updatedAt: '2026-01-01T00:00:00.000Z',
			fileCount: 1,
			symbols: [
				{ 
					name: 'Foo', 
					kind: 'class', 
					path: 'src/foo.ts', 
					startLine: 1, 
					endLine: 10 
				},
				{ 
					name: 1, 
					kind: 'bad', 
					path: 'x' 
				},
			],
		});
		const doc = parseSymbolIndexJson(raw);
		assert.ok(doc);
		assert.strictEqual(doc!.symbols.length, 1);
		assert.strictEqual(doc!.symbols[0]!.name, 'Foo');
	});

	test('parseSymbolIndexJson на мусоре -> undefined', () => {
		assert.strictEqual(parseSymbolIndexJson('{'), undefined);
		assert.strictEqual(parseSymbolIndexJson('{"symbols":null}'), undefined);
	});

	test('applySymbolPathUpdate / remove - per-file', () => {
		const doc = {
			updatedAt: '',
			fileCount: 2,
			symbols: [
				{
					name: 'Foo',
					kind: 'class',
					path: 'a.ts',
					startLine: 1,
					endLine: 2
				},
				{
					name: 'Bar',
					kind: 'function',
					path: 'b.ts',
					startLine: 1,
					endLine: 2
				},
			],
		};
		const updated = applySymbolPathUpdate(doc, 'a.ts', [
			{
				name: 'Foo2',
				kind: 'class',
				path: 'a.ts',
				startLine: 1,
				endLine: 9
			}
		], 8_000);
		assert.strictEqual(updated.symbols.find((s) => s.path === 'a.ts')?.name, 'Foo2');
		assert.ok(updated.symbols.some((s) => s.path === 'b.ts'));
		const removed = applySymbolPathRemove(updated, 'a.ts');
		assert.ok(!removed.symbols.some((s) => s.path === 'a.ts'));
		assert.strictEqual(removed.fileCount, 1);
	});
});

suite('chunkFileContent', () => {
	test('режет по function', () => {
		const src = [
			'function a() {',
			'  const x = 1;',
			'  const y = 2;',
			'  const z = 3;',
			'  return x + y + z;',
			'}',
			'',
			'function b() {',
			'  return 2;',
			'}',
		].join('\n');
		const chunks = chunkFileContent('src/a.ts', src);
		assert.ok(chunks.length >= 2);
		assert.strictEqual(chunks[0].path, 'src/a.ts');
		assert.ok(chunks.some((c) => c.text.includes('function a')));
		assert.ok(chunks.some((c) => c.text.includes('function b')));
	});

	test('пустой файл - без chunks', () => {
		assert.deepStrictEqual(chunkFileContent('empty.ts', '   \n  '), []);
	});
});

suite('trigram search', () => {
	test('находит chunk по токенам', () => {
		const chunks = chunkFileContent('lib/math.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
		const trigrams = buildTrigramIndex(chunks);
		const manifest: IndexManifest = {
			version: 2,
			updatedAt: '',
			files: {},
			chunks: Object.fromEntries(chunks.map((c) => [c.id, c])),
			trigrams,
			dirDigests: {},
		};

		const hits = searchTrigrams(manifest, 'add number', 5);
		assert.ok(hits.length >= 1);
		assert.ok(hits[0].score > 0);
	});

	test('tokenize отбрасывает короткие слова', () => {
		assert.ok(tokenize('a bb ccc').includes('ccc'));
		assert.ok(!tokenize('a bb').includes('bb'));
	});
});

suite('manifestParse / abort', () => {
	test('parseManifestJson: битый JSON -> invalid_json', () => {
		const r = parseManifestJson('{not json');
		assert.strictEqual(r.ok, false);
		if (!r.ok) {
			assert.strictEqual(r.reason, 'invalid_json');
		}
	});

	test('parseManifestJson: bad version -> bad_version', () => {
		const r = parseManifestJson(JSON.stringify({ version: 99, files: {}, chunks: {}, trigrams: {} }));
		assert.strictEqual(r.ok, false);
		if (!r.ok) {
			assert.strictEqual(r.reason, 'bad_version');
		}
	});

	test('parseManifestJson: manifest v1 -> bad_version', () => {
		const r = parseManifestJson(
			JSON.stringify({
				version: 1,
				updatedAt: '',
				files: {},
				chunks: {},
				trigrams: {},
				dirDigests: {},
			}),
		);
		assert.strictEqual(r.ok, false);
		if (!r.ok) {
			assert.strictEqual(r.reason, 'bad_version');
		}
	});

	test('parseManifestJson: missing dirDigests при непустых files', () => {
		const r = parseManifestJson(
			JSON.stringify({
				version: 2,
				updatedAt: '2020-01-01T00:00:00.000Z',
				files: {
					'a.ts': {
						hash: 'h',
						size: 1,
						chunkIds: []
					}
				},
				chunks: {},
				trigrams: {},
			}),
		);
		assert.strictEqual(r.ok, true);
		if (r.ok) {
			assert.strictEqual(r.missingDirDigests, true);
			assert.ok(needsManifestRepair(r));
		}
	});

	test('repairManifestInMemory: corrupt -> empty; missing digests -> recompute', () => {
		const corrupt = repairManifestInMemory({
			ok: false,
			reason: 'invalid_json'
		});
		assert.strictEqual(corrupt.reason, 'invalid_json');
		assert.deepStrictEqual(Object.keys(corrupt.manifest.files), []);

		const parsed = parseManifestJson(
			JSON.stringify({
				version: 2,
				updatedAt: '2020-01-01T00:00:00.000Z',
				files: {
					'src/a.ts': {
						hash: 'h1',
						size: 1,
						chunkIds: []
					},
					'src/b.ts': {
						hash: 'h2',
						size: 1,
						chunkIds: []
					},
				},
				chunks: {},
				trigrams: {},
			}),
		);
		assert.ok(parsed.ok);
		const fixed = repairManifestInMemory(parsed);
		assert.strictEqual(fixed.reason, 'missing_dir_digests');
		assert.ok(fixed.manifest.dirDigests['']);
		assert.ok(fixed.manifest.dirDigests['src']);
	});

	test('IndexAbortFlag: abort + throwIfAborted', () => {
		const flag = new IndexAbortFlag();
		assert.strictEqual(flag.aborted, false);
		flag.throwIfAborted();
		flag.abort();
		assert.strictEqual(flag.aborted, true);
		assert.throws(() => flag.throwIfAborted(), (err: unknown) => isIndexAbortError(err));
		assert.ok(isIndexAbortError(createIndexAbortError()));
	});

	test('summarizePartialErrors', () => {
		assert.strictEqual(summarizePartialErrors([]), '');
		const one = summarizePartialErrors(['a.ts: fail']);
		assert.ok(one.includes('1'));
		assert.ok(one.includes('a.ts'));
		const many = summarizePartialErrors(['1', '2', '3', '4'], 3);
		assert.ok(many.includes('+1'));
	});
});
