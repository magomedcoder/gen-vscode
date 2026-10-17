import * as assert from 'assert';
import { selectPdfPages } from '../features/agent/tools/fs/readFile.js';

suite('read_file PDF page budget', () => {
	test('smart-picks first and last pages for long documents', () => {
		assert.deepStrictEqual(selectPdfPages(20, [], 4), [1, 2, 19, 20]);
	});

	test('honors explicit pages, deduplicates, and hard-caps at six', () => {
		assert.deepStrictEqual(selectPdfPages(10, [3, 3, 9, 12, 1, 2, 4, 5], 99), [3, 9, 1, 2, 4, 5]);
	});
});
