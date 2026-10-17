import * as assert from 'assert';
import { estimateTextTokens } from '../core/llm/estimateTokens.js';
import { estimateHitTokens, fitHitsToTokenBudget, resolveMaxTokensArg, toProvenanceHit } from '../features/agent/tools/search/fitHitsTokenBudget.js';
import { asOptionalInt } from '../features/agent/types.js';

suite('fitHitsTokenBudget', () => {
	test('evicts lowest-ranked hits until under token budget', () => {
		const hits = [
			toProvenanceHit({
				path: 'high.ts',
				startLine: 1,
				endLine: 10,
				score: 9,
				snippet: 'x'.repeat(400),
				tool: 'find_code',
				reason: 'hybrid',
				source: 'codebase',
			}),
			toProvenanceHit({
				path: 'mid.ts',
				startLine: 2,
				endLine: 5,
				score: 5,
				snippet: 'y'.repeat(400),
				tool: 'codebase_search',
				reason: 'trigram index',
			}),
			toProvenanceHit({
				path: 'low.ts',
				score: 1,
				snippet: 'z'.repeat(400),
				tool: 'find_code',
				reason: 'weak',
			}),
		];

		const total = hits.reduce((s, h) => s + h.estimatedTokens, 0);
		const budget = Math.max(64, total - hits[2]!.estimatedTokens - 10);
		const fitted = fitHitsToTokenBudget(hits, budget);

		assert.ok(fitted.truncated);
		assert.ok(fitted.dropped.length >= 1);
		assert.ok(fitted.kept.every((h) => h.path !== 'low.ts' || fitted.kept.length === 1));
		assert.strictEqual(fitted.kept[0]!.path, 'high.ts');
		assert.ok(fitted.tokensUsed <= fitted.maxTokens || fitted.kept.length === 1);
		assert.ok(fitted.kept.every((h) => h.tool && h.reason && typeof h.estimatedTokens === 'number'));
	});

	test('provenance shape includes path, range, tool, reason, score', () => {
		const hit = toProvenanceHit({
			path: 'src/a.ts',
			startLine: 10,
			endLine: 20,
			score: 0.8,
			snippet: 'function foo() {}',
			tool: 'similar_code',
			reason: 'trigram overlap',
			source: 'codebase',
		});

		assert.strictEqual(hit.path, 'src/a.ts');
		assert.strictEqual(hit.startLine, 10);
		assert.strictEqual(hit.endLine, 20);
		assert.strictEqual(hit.score, 0.8);
		assert.strictEqual(hit.tool, 'similar_code');
		assert.strictEqual(hit.reason, 'trigram overlap');
		assert.strictEqual(hit.source, 'codebase');
		assert.ok(hit.estimatedTokens >= 1);
		assert.strictEqual(hit.estimatedTokens, estimateHitTokens(hit));
		assert.ok(estimateHitTokens(hit) >= estimateTextTokens(hit.snippet));
	});

	test('resolveMaxTokensArg accepts max_tokens', () => {
		assert.strictEqual(
			resolveMaxTokensArg({ max_tokens: 500 }, 3000, 16_000, asOptionalInt),
			500,
		);
		assert.strictEqual(
			resolveMaxTokensArg({}, 3000, 16_000, asOptionalInt),
			3000,
		);
		assert.strictEqual(
			resolveMaxTokensArg({ max_tokens: 99_000 }, 3000, 16_000, asOptionalInt),
			16_000,
		);
	});

	test('clips single oversized hit snippet', () => {
		const huge = toProvenanceHit({
			path: 'big.ts',
			score: 1,
			snippet: 'a'.repeat(20_000),
			tool: 'pack_context',
			reason: 'test',
		});
		const fitted = fitHitsToTokenBudget([huge], 100);
		assert.strictEqual(fitted.kept.length, 1);
		assert.ok(fitted.kept[0]!.snippet.includes('[truncated]'));
		assert.ok(fitted.kept[0]!.snippet.length < huge.snippet.length);
	});
});
