import * as assert from 'assert';
import { GHOST_MAX_LINES, sanitizeGhostInsert } from '../features/tab/ghostText.js';

suite('ghostText', () => {
	test('strip fences и multi-line', () => {
		const raw = '```ts\nconst a = 1;\nconst b = 2;\n```';
		assert.strictEqual(sanitizeGhostInsert(raw), 'const a = 1;\nconst b = 2;');
	});

	test('cap lines', () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
		const out = sanitizeGhostInsert(lines.join('\n'));
		assert.strictEqual(out.split('\n').length, GHOST_MAX_LINES);
	});

	test('empty', () => {
		assert.strictEqual(sanitizeGhostInsert('   '), '');
	});
});
