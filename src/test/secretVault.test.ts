import * as assert from 'assert';
import { buildAuthHeaders } from '../core/config/apiKeyHeaders.js';
import { FILE_LAYER_KEYS } from '../core/config/layers.js';

suite('secret vault boundaries', () => {
	test('webSearchApiKey не в FILE_LAYER_KEYS', () => {
		assert.ok(!(FILE_LAYER_KEYS as readonly string[]).includes('webSearchApiKey'));
	});

	test('embeddingsApiKey не в FILE_LAYER_KEYS', () => {
		assert.ok(!(FILE_LAYER_KEYS as readonly string[]).includes('embeddingsApiKey'));
	});

	test('buildAuthHeaders не кладёт пустой ключ', () => {
		assert.deepStrictEqual(buildAuthHeaders('', 'Authorization', 'Bearer'), {});
		assert.deepStrictEqual(
			buildAuthHeaders('sk-x', 'Authorization', 'Bearer'),
			{ Authorization: 'Bearer sk-x' },
		);
	});
});
