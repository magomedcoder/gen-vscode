import * as assert from 'assert';
import { DEFAULT_APPROVAL_POLICY } from '../../core/config/approvalTypes.js';
import { mergeAlwaysAllow } from '../../core/stores/alwaysAllowStore.js';
import { evaluateApproval, isRiskySubject, suggestPattern, toolActionType } from '../../features/agent/permissionPolicy.js';
import type { ApprovalPolicy } from '../../features/agent/permissionPolicy.js';

/**
 * Лёгкий smoke permissions/confirm рядом с retrieval eval.
 * Полная матрица ask/deny/always/skip/abort * edits/shell + toolsFallback - `permissionConfirmMatrix.test.ts` (pure helpers, без UI confirm host).
 */
suite('eval/permissions-confirm', () => {
	test('smoke: default policy - edits/shell ask, skill allow, read без action', () => {
		assert.strictEqual(toolActionType('write_file'), 'edits');
		assert.strictEqual(toolActionType('apply_patch'), 'edits');
		assert.strictEqual(toolActionType('apply_diff'), 'edits');
		assert.strictEqual(toolActionType('run_command'), 'shell');
		assert.strictEqual(toolActionType('web_search'), 'web');
		assert.strictEqual(toolActionType('delete_file'), 'delete');
		assert.strictEqual(toolActionType('read_file'), undefined);
		assert.strictEqual(toolActionType('grep'), undefined);

		assert.strictEqual(
			evaluateApproval('edits', 'src/a.ts', DEFAULT_APPROVAL_POLICY),
			'ask',
		);
		assert.strictEqual(
			evaluateApproval('shell', 'npm test', DEFAULT_APPROVAL_POLICY),
			'ask',
		);
		assert.strictEqual(
			evaluateApproval('skill', 'builtin:scout', DEFAULT_APPROVAL_POLICY),
			'allow',
		);
	});

	test('smoke: allowlist / denylist / session Always перекрывают mode', () => {
		const policy: ApprovalPolicy = {
			...DEFAULT_APPROVAL_POLICY,
			edits: {
				mode: 'ask',
				allowlist: ['src/safe/**'],
				// matchPattern: substring / suffix - не full glob `**/.env*`
				denylist: ['.env'],
			},
			shell: {
				mode: 'ask',
				allowlist: [],
				denylist: ['rm*'],
			},
		};

		assert.strictEqual(evaluateApproval('edits', 'src/safe/a.ts', policy), 'allow');
		assert.strictEqual(evaluateApproval('edits', 'app/.env', policy), 'deny');
		assert.strictEqual(evaluateApproval('shell', 'rm -rf /', policy), 'deny');

		// Кнопка Always -> session allowlist (паттерн как suggestPattern)
		assert.strictEqual(
			evaluateApproval('shell', 'npm test', policy, ['npm*']),
			'allow',
		);
		assert.strictEqual(
			evaluateApproval('edits', 'src/other.ts', policy, ['edits:src/**']),
			'allow',
		);
	});

	test('smoke: mode allow/deny/review + risky subject', () => {
		const allowAll: ApprovalPolicy = {
			...DEFAULT_APPROVAL_POLICY,
			edits: {
				mode: 'allow',
				allowlist: [],
				denylist: []
			},
			shell: {
				mode: 'deny',
				allowlist: [],
				denylist: []
			},
			web: {
				mode: 'review',
				allowlist: [],
				denylist: []
			},
		};

		assert.strictEqual(evaluateApproval('edits', 'src/x.ts', allowAll), 'allow');
		assert.strictEqual(evaluateApproval('shell', 'echo hi', allowAll), 'deny');
		// review: неrisky -> allow; risky shell остаётся ask при shell+review
		assert.strictEqual(evaluateApproval('web', 'https://example.com', allowAll), 'allow');

		assert.ok(isRiskySubject('edits', '.env'));
		assert.ok(isRiskySubject('shell', 'rm -rf /tmp/x'));
		assert.ok(!isRiskySubject('edits', 'src/index.ts'));

		const reviewEdits: ApprovalPolicy = {
			...DEFAULT_APPROVAL_POLICY,
			edits: {
				mode: 'review',
				allowlist: [],
				denylist: []
			},
		};
		// edits+review: явный decision `review` (diff preview), не heuristic allow/ask
		assert.strictEqual(evaluateApproval('edits', 'src/index.ts', reviewEdits), 'review');
		assert.strictEqual(evaluateApproval('edits', '.env.local', reviewEdits), 'review');

		const reviewShell: ApprovalPolicy = {
			...DEFAULT_APPROVAL_POLICY,
			shell: {
				mode: 'review',
				allowlist: [],
				denylist: []
			},
		};
		assert.strictEqual(evaluateApproval('shell', 'echo hi', reviewShell), 'allow');
		assert.strictEqual(evaluateApproval('shell', 'rm -rf /', reviewShell), 'ask');
	});

	test('smoke: suggestPattern для Always + mergeAlwaysAllow', () => {
		assert.strictEqual(suggestPattern('shell', 'run_command', 'npm run test'), 'npm*');
		assert.strictEqual(suggestPattern('edits', 'write_file', 'src/a/b.ts'), 'src/a/**');
		assert.strictEqual(
			suggestPattern('web', 'web_search', 'https://api.example.com/v1'),
			'https://api.example.com/*',
		);

		const merged = mergeAlwaysAllow(['npm*', 'git*'], ['git*', 'curl*']);
		assert.deepStrictEqual(merged, ['npm*', 'git*', 'curl*']);
	});
});
