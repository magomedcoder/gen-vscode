import * as assert from 'assert';
import { buildInvalidArgsRetryPrompt, findInvalidToolCalls, isBadToolCallJsonError, toolArgumentsInvalid } from '../features/agent/toolArgsRetry.js';
import { resolveToolsFallbackPolicy } from '../features/agent/tools/confirmDecision.js';

suite('toolArgsRetry', () => {
	test('toolArgumentsInvalid detects broken and sanitize marker', () => {
		assert.strictEqual(toolArgumentsInvalid('{"path":"a.ts"}'), false);
		assert.strictEqual(toolArgumentsInvalid('{"path":'), true);
		assert.strictEqual(
			toolArgumentsInvalid(JSON.stringify({ error: 'invalid_or_truncated_json', path: 'a.ts' })),
			true,
		);
	});

	test('findInvalidToolCalls + retry prompt', () => {
		const bad = findInvalidToolCalls([
			{
				id: '1',
				type: 'function',
				function: { name: 'write_file', arguments: '{"path":' },
			},
			{
				id: '2',
				type: 'function',
				function: { name: 'read_file', arguments: '{"path":"ok.ts"}' },
			},
		]);
		assert.strictEqual(bad.length, 1);
		assert.ok(buildInvalidArgsRetryPrompt(['write_file']).includes('write_file'));
	});

	test('isBadToolCallJsonError', () => {
		assert.strictEqual(isBadToolCallJsonError(new Error('parse tool call arguments as JSON')), true);
		assert.strictEqual(isBadToolCallJsonError(new Error('connection refused')), false);
	});

	test('resolveToolsFallbackPolicy', () => {
		assert.strictEqual(resolveToolsFallbackPolicy('always'), 'continue');
		assert.strictEqual(resolveToolsFallbackPolicy(undefined), 'continue');
		assert.strictEqual(resolveToolsFallbackPolicy('ask'), 'ask');
		assert.strictEqual(resolveToolsFallbackPolicy('stop'), 'stop');
	});
});
