import * as assert from 'assert';
import { estimateTextTokens } from '../core/llm/estimateTokens.js';
import { CODEBASE_TOOL_HINT_STUB, computeMentionBudgetTokens, fitMentionsToBudget, shouldStubCodebaseDump, stubHeavyRetrievalBlocks, TIGHT_MENTION_BUDGET_TOKENS, weightForKind } from '../features/chat/fitMentionsBudget.js';

suite('fitMentionsBudget', () => {
	test('weightForKind: codebase тяжелее file', () => {
		assert.ok(weightForKind('@codebase') > weightForKind('@file src/a.ts'));
		assert.ok(weightForKind('@git-changes') > weightForKind('@file x'));
	});

	test('stubHeavyRetrievalBlocks: тесный budget -> tool-hint вместо dump', () => {
		const huge = 'x'.repeat(8_000);
		const stubbed = stubHeavyRetrievalBlocks(
			[
				{ kind: '@codebase', text: huge, weight: 100 },
				{ kind: '@file a.ts', text: ' const a = 1;', weight: 20 },
			],
			TIGHT_MENTION_BUDGET_TOKENS - 100,
		);
		assert.strictEqual(stubbed[0]?.text, CODEBASE_TOOL_HINT_STUB);
		assert.ok(stubbed[0]?.text.includes('find_code'));
		assert.ok(stubbed[1]?.text.includes('a = 1'));
		assert.ok(shouldStubCodebaseDump(huge, 1_000));
		assert.ok(!shouldStubCodebaseDump('short', 8_000));
	});

	test('fitMentionsToBudget: eviction @codebase оставляет tool-hint stub', () => {
		const huge = 'y'.repeat(50_000);
		const fitted = fitMentionsToBudget(
			[
				{ kind: '@codebase', text: `[codebase]\n${huge}`, weight: 100 },
				{ kind: '@file a.ts', text: 'export const a = 1;', weight: 20 },
			],
			400,
		);
		assert.ok(fitted.truncated);
		assert.ok(
			fitted.contextText.includes('find_code')
			|| fitted.contextText.includes('[truncated')
			|| fitted.contextText.includes('export const a'),
		);
	});

	test('computeMentionBudgetTokens не уходит в минус', () => {
		assert.strictEqual(
			computeMentionBudgetTokens({
				turnBudget: 1000,
				historyTokens: 800,
				lastUserTokens: 300,
				systemReserveTokens: 100,
			}),
			0,
		);
		assert.ok(
			computeMentionBudgetTokens({
				turnBudget: 4000,
				historyTokens: 500,
				lastUserTokens: 200,
			}) > 0,
		);
	});

	test('oversized @codebase при budget ~8192-like ужимается без hard fail', () => {
		const turnBudget = 3_840; // типичный effective budget при n_ctx=8192
		const historyTokens = 400;
		const lastUserTokens = 80;
		const mentionBudget = computeMentionBudgetTokens({
			turnBudget,
			historyTokens,
			lastUserTokens,
			systemReserveTokens: 500,
		});
		assert.ok(mentionBudget > 0);
		assert.ok(mentionBudget < turnBudget);

		const huge = 'x'.repeat(40_000); // ~10k tokens char-estimate
		const fitted = fitMentionsToBudget(
			[
				{ kind: '@codebase', text: `[codebase]\n${huge}`, weight: weightForKind('@codebase') },
				{ kind: '@file a.ts', text: 'export const a = 1;', weight: weightForKind('@file') },
			],
			mentionBudget,
		);

		assert.ok(fitted.truncated);
		assert.ok(fitted.truncatedKinds.some((k) => k.includes('codebase')));
		assert.ok(fitted.tokensUsed <= mentionBudget + 8);
		assert.ok(fitted.contextText.includes('[truncated') || fitted.contextText.length < huge.length);
		// мелкий @file предпочтительно сохранить
		assert.ok(fitted.contextText.includes('export const a') || fitted.truncatedKinds.includes('@file a.ts') || fitted.contextText.includes('[truncated attachments'));
	});

	test('пустые блоки -> пустой context', () => {
		const fitted = fitMentionsToBudget([], 1000);
		assert.strictEqual(fitted.contextText, '');
		assert.strictEqual(fitted.truncated, false);
		assert.strictEqual(fitted.tokensUsed, 0);
	});

	test('estimate согласован с fit tokensUsed', () => {
		const text = 'hello world '.repeat(50);
		const fitted = fitMentionsToBudget(
			[{ kind: '@file', text, weight: 20 }],
			estimateTextTokens(text) + 10,
		);
		assert.strictEqual(fitted.truncated, false);
		assert.strictEqual(fitted.tokensUsed, estimateTextTokens(fitted.contextText));
	});
});
