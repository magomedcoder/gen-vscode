import * as assert from 'assert';
import type { LlmToolDefinition } from '../core/llm/types.js';
import { autoPresetForBudget, PRIMARY_TOOLS_PRESETS, resolvePrimaryToolsAllowlist, shrinkToolsForBudget } from '../features/agent/primaryToolsPresets.js';

function fakeDef(name: string): LlmToolDefinition {
	return {
		type: 'function',
		function: {
			name,
			description: name,
			parameters: { type: 'object', properties: {} },
		},
	};
}

suite('primaryToolsPresets', () => {
	test('autoPresetForBudget thresholds', () => {
		assert.strictEqual(autoPresetForBudget(8_000), 'coding');
		assert.strictEqual(autoPresetForBudget(16_000), 'explore');
		assert.strictEqual(autoPresetForBudget(64_000), 'all');
	});

	test('resolvePrimaryToolsAllowlist coding / custom / all', () => {
		assert.deepStrictEqual(
			resolvePrimaryToolsAllowlist({ primaryToolsPreset: 'coding', primaryTools: [] }),
			[...PRIMARY_TOOLS_PRESETS.coding],
		);
		assert.strictEqual(
			resolvePrimaryToolsAllowlist({ primaryToolsPreset: 'all', primaryTools: [] }),
			undefined,
		);
		assert.deepStrictEqual(
			resolvePrimaryToolsAllowlist({
				primaryToolsPreset: 'custom',
				primaryTools: ['read_file', 'grep'],
			}),
			['read_file', 'grep'],
		);
	});

	test('shrinkToolsForBudget keeps coding essentials under pressure', () => {
		const tools = [
			...PRIMARY_TOOLS_PRESETS.coding.map(fakeDef),
			fakeDef('repo_health'),
			fakeDef('browser_action'),
		];
		const shrunk = shrinkToolsForBudget(tools, 10_000, 12_000);
		assert.ok(shrunk.length < tools.length);
		assert.ok(shrunk.every((t) => PRIMARY_TOOLS_PRESETS.coding.includes(t.function.name)
			|| shrunk.length <= 12));
	});
});
