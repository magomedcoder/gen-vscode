import * as assert from 'node:assert/strict';
import { normalizeBaseUrl } from '../core/llm/normalizeBaseUrl.js';

suite('normalizeBaseUrl', () => {
	test('trim + trailing slash', () => {
		assert.equal(normalizeBaseUrl('  http://127.0.0.1:8080/  '), 'http://127.0.0.1:8080');
	});

	test('схлопывает /v1/v1', () => {
		assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1/v1'), 'http://127.0.0.1:11434/v1');
	});

	test('сохраняет одиночный /v1', () => {
		assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1');
	});

	test('пустой ввод', () => {
		assert.equal(normalizeBaseUrl(''), '');
		assert.equal(normalizeBaseUrl('   '), '');
	});

	test('host без схемы -> http', () => {
		assert.equal(normalizeBaseUrl('127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
	});
});
