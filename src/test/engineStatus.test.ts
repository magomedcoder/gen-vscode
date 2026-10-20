import * as assert from 'node:assert';
import * as path from 'node:path';
import { resolveIndexEngineMode } from '../features/index/engineStatus.js';
import { initTreeSitterFromPath, listEffectiveTreeSitterLanguages, listMissingWasmLanguages, listDefaultTreeSitterLanguages } from '../features/index/treeSitter.js';

const EXT_ROOT = path.resolve(__dirname, '../..');

const baseSettings = {
	embeddingsBaseUrl: '',
	localEmbeddingsMode: 'off' as const,
};

suite('index engine status', () => {
	test('без embeddingsBaseUrl - CPU trigram', () => {
		assert.strictEqual(resolveIndexEngineMode(baseSettings), 'cpu-trigram');
		assert.strictEqual(resolveIndexEngineMode({ 
			...baseSettings, 
			embeddingsBaseUrl: '  ' 
		}), 'cpu-trigram');
	});

	test('с embeddingsBaseUrl - remote', () => {
		assert.strictEqual(
			resolveIndexEngineMode({ 
				...baseSettings, 
				embeddingsBaseUrl: 'https://api.example/v1' 
			}),
			'remote',
		);
	});
});

suite('tree-sitter language lists', () => {
	test('listEffectiveTreeSitterLanguages: пусто = default langs', () => {
		assert.deepStrictEqual(listEffectiveTreeSitterLanguages(), listDefaultTreeSitterLanguages());
		assert.deepStrictEqual(listEffectiveTreeSitterLanguages([]), listDefaultTreeSitterLanguages());
	});

	test('listEffectiveTreeSitterLanguages: * = все id', () => {
		const all = listEffectiveTreeSitterLanguages(['*']);
		assert.ok(all.includes('typescript'));
		assert.ok(all.includes('dart'));
		assert.strictEqual(all.length, listEffectiveTreeSitterLanguages(['all']).length);
	});

	test('listEffectiveTreeSitterLanguages: пересечение и fallback', () => {
		assert.deepStrictEqual(listEffectiveTreeSitterLanguages(['python', 'go']), ['python', 'go']);
		assert.deepStrictEqual(listEffectiveTreeSitterLanguages(['nope']), listDefaultTreeSitterLanguages());
	});

	test('listMissingWasmLanguages: подмножество effective', () => {
		initTreeSitterFromPath(EXT_ROOT);
		const enabled = listEffectiveTreeSitterLanguages(['typescript', 'python']);
		const missing = listMissingWasmLanguages(enabled);
		for (const id of missing) {
			assert.ok(enabled.includes(id));
		}
	});
});
