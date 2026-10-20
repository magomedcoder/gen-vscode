import * as assert from 'assert';
import { includeApplyPatchForModel, isGptFamilyModel } from '../features/agent/modelRoutedPatch.js';
import { buildAgentSystemPrompt } from '../features/agent/prompts.js';

suite('modelRoutedPatch', () => {
	test('isGptFamilyModel: gpt / chatgpt / o-серия', () => {
		assert.ok(isGptFamilyModel('gpt-4o'));
		assert.ok(isGptFamilyModel('openai/gpt-4.1'));
		assert.ok(isGptFamilyModel('ChatGPT-4o'));
		assert.ok(isGptFamilyModel('o1'));
		assert.ok(isGptFamilyModel('o1-mini'));
		assert.ok(isGptFamilyModel('openai/o3-pro'));
		assert.ok(isGptFamilyModel('o4-mini'));
		assert.ok(!isGptFamilyModel(''));
		assert.ok(!isGptFamilyModel('claude-sonnet-4'));
		assert.ok(!isGptFamilyModel('deepseek-chat'));
		assert.ok(!isGptFamilyModel('gemini-2.0-flash'));
		assert.ok(!isGptFamilyModel('llama-3.1'));
	});

	test('includeApplyPatchForModel: routing on/off', () => {
		assert.strictEqual(includeApplyPatchForModel('gpt-4o', true), true);
		assert.strictEqual(includeApplyPatchForModel('claude-sonnet-4', true), false);
		assert.strictEqual(includeApplyPatchForModel('claude-sonnet-4', false), true);
		assert.strictEqual(includeApplyPatchForModel('', true), false);
		assert.strictEqual(includeApplyPatchForModel('', false), true);
	});

	test('system prompt без apply_patch для non-GPT; apply_diff всегда', () => {
		const withPatch = buildAgentSystemPrompt({ toolsAvailable: true, includeApplyPatch: true });
		const without = buildAgentSystemPrompt({ toolsAvailable: true, includeApplyPatch: false });
		assert.ok(withPatch.includes('apply_patch'));
		assert.ok(withPatch.includes('apply_diff'));
		assert.ok(!without.includes('apply_patch'));
		assert.ok(without.includes('apply_diff'));
		assert.ok(without.includes('apply_workspace_edit'));
	});
});
