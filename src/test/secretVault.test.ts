import * as assert from 'assert';
import { buildAuthHeaders } from '../core/config/apiKeyHeaders.js';
import { FILE_LAYER_KEYS } from '../core/config/layers.js';
import { secretEnvFallbackNames } from '../core/config/secretVault.js';

suite('secret vault boundaries', () => {
	test('webSearchApiKey не в FILE_LAYER_KEYS', () => {
		assert.ok(!(FILE_LAYER_KEYS as readonly string[]).includes('webSearchApiKey'));
	});

	test('embeddingsApiKey не в FILE_LAYER_KEYS', () => {
		assert.ok(!(FILE_LAYER_KEYS as readonly string[]).includes('embeddingsApiKey'));
	});

	test('env fallback names для local-first (без Secrets UI)', () => {
		assert.ok(secretEnvFallbackNames('apiKey').includes('GEN_API_KEY'));
		assert.ok(secretEnvFallbackNames('apiKey').includes('OPENAI_API_KEY'));
		assert.deepStrictEqual(secretEnvFallbackNames('embeddingsApiKey'), ['GEN_EMBEDDINGS_API_KEY']);
		assert.deepStrictEqual(secretEnvFallbackNames('webSearchApiKey'), ['GEN_WEB_SEARCH_API_KEY']);
	});

	test('buildAuthHeaders не кладёт пустой ключ', () => {
		assert.deepStrictEqual(buildAuthHeaders('', 'Authorization', 'Bearer'), {});
		assert.deepStrictEqual(
			buildAuthHeaders('sk-x', 'Authorization', 'Bearer'),
			{ Authorization: 'Bearer sk-x' },
		);
	});
});
