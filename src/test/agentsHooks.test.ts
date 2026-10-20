import * as assert from 'assert';
import { inferGeneratedAgentSpec, isReservedAgentId } from '../features/project/customAgents.js';
import { hookCommandMatches, matchesHookPattern } from '../features/project/hooks.js';

suite('agents and hooks', () => {
	test('infers readonly documentation agent with useful tools and body', () => {
		const spec = inferGeneratedAgentSpec(
			'Research external API documentation and cite sources',
			{ name: 'api-docs' },
		);
		assert.strictEqual(spec.readonly, true);
		assert.strictEqual(spec.mode, 'ask');
		assert.ok(spec.tools.includes('web_search'));
		assert.match(spec.body, /cite source URLs/i);
	});

	test('honors explicit mutating agent settings', () => {
		const spec = inferGeneratedAgentSpec('Review and fix failing tests', {
			name: 'fixer',
			mode: 'agent',
			readonly: false,
		});
		assert.strictEqual(spec.readonly, false);
		assert.strictEqual(spec.mode, 'agent');
		assert.ok(spec.tools.includes('apply_patch'));
		assert.match(spec.body, /focused changes/i);
	});

	test('rejects only reserved normalized agent ids', () => {
		assert.strictEqual(isReservedAgentId('Explore'), true);
		assert.strictEqual(isReservedAgentId('general'), true);
		assert.strictEqual(isReservedAgentId('my-scout'), false);
	});

	test('matches hook string and object globs', () => {
		assert.strictEqual(matchesHookPattern('npm test -- unit', 'npm test*'), true);
		assert.strictEqual(matchesHookPattern('git status', 'npm*'), false);
		assert.strictEqual(hookCommandMatches(
			{ command: 'check.sh', matchers: [{ event: 'beforeShell', command: 'npm *' }] },
			'beforeShell',
			{ GEN_HOOK_COMMAND: 'npm test' },
			'/workspace',
		), true);
		assert.strictEqual(hookCommandMatches(
			{ command: 'check.sh', matchers: ['release *'] },
			'beforeSubmit',
			{ GEN_HOOK_TEXT: 'fix tests' },
		), false);
	});
});
