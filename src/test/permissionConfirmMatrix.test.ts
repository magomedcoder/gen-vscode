import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULT_APPROVAL_POLICY } from '../core/config/approvalTypes.js';
import { evaluateApproval, suggestPattern, toolActionType } from '../features/agent/permissionPolicy.js';
import type { ApprovalPolicy } from '../features/agent/permissionPolicy.js';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { isAlwaysConfirmChoice, resolveConfirmChoiceOutcome, resolveToolConfirmGating, shouldContinueToolsFallback, shouldStopLoopOnToolDeny } from '../features/agent/tools/confirmDecision.js';
import { shouldSkipToolConfirm } from '../features/agent/tools/confirm.js';
import { getToolMeta } from '../features/agent/tools/registry.js';
import type { ConfirmChoice } from '../features/agent/types.js';
import { AgentWriteTracker } from '../features/agent/userEdits.js';

/**
 * Матрица confirm/policy без LLM:
 * ask|deny|allow(+Always)|skip|abort * edits/shell (+ web stubs) + toolsFallback Continue/Stop.
 */
suite('permission confirm matrix', () => {
	suiteSetup(() => {
		registerBuiltins();
	});

	const askPolicy = (action: 'edits' | 'shell' | 'web'): ApprovalPolicy => {
		const p = structuredClone(DEFAULT_APPROVAL_POLICY);
		p[action] = { mode: 'ask', allowlist: [], denylist: [] };
		return p;
	};

	const denyPolicy = (action: 'edits' | 'shell' | 'web'): ApprovalPolicy => {
		const p = structuredClone(DEFAULT_APPROVAL_POLICY);
		p[action] = { mode: 'deny', allowlist: [], denylist: [] };
		return p;
	};

	const allowPolicy = (action: 'edits' | 'shell' | 'web'): ApprovalPolicy => {
		const p = structuredClone(DEFAULT_APPROVAL_POLICY);
		p[action] = { mode: 'allow', allowlist: [], denylist: [] };
		return p;
	};

	suite('policy: ask / deny / allow / Always (session)', () => {
		test('edits: mode ask -> ask; deny -> deny; allow -> allow', () => {
			assert.strictEqual(evaluateApproval('edits', 'src/a.ts', askPolicy('edits')), 'ask');
			assert.strictEqual(evaluateApproval('edits', 'src/a.ts', denyPolicy('edits')), 'deny');
			assert.strictEqual(evaluateApproval('edits', 'src/a.ts', allowPolicy('edits')), 'allow');
		});

		test('shell: mode ask -> ask; deny -> deny; allow -> allow', () => {
			assert.strictEqual(evaluateApproval('shell', 'npm test', askPolicy('shell')), 'ask');
			assert.strictEqual(evaluateApproval('shell', 'npm test', denyPolicy('shell')), 'deny');
			assert.strictEqual(evaluateApproval('shell', 'npm test', allowPolicy('shell')), 'allow');
		});

		test('web stubs: ask / deny / allow', () => {
			assert.strictEqual(evaluateApproval('web', 'https://ex.com', askPolicy('web')), 'ask');
			assert.strictEqual(evaluateApproval('web', 'https://ex.com', denyPolicy('web')), 'deny');
			assert.strictEqual(evaluateApproval('web', 'https://ex.com', allowPolicy('web')), 'allow');
		});

		test('Always (sessionAllow): ask -> allow для edits/shell/web', () => {
			const editsPat = suggestPattern('edits', 'write_file', 'src/a/b.ts')!;
			assert.strictEqual(
				evaluateApproval('edits', 'src/a/b.ts', askPolicy('edits'), [editsPat]),
				'allow',
			);

			const shellPat = suggestPattern('shell', 'run_command', 'npm run test')!;
			assert.strictEqual(
				evaluateApproval('shell', 'npm run test', askPolicy('shell'), [shellPat]),
				'allow',
			);

			const webPat = suggestPattern('web', 'web_search', 'https://api.example.com/v1')!;
			assert.strictEqual(
				evaluateApproval('web', 'https://api.example.com/v1', askPolicy('web'), [webPat]),
				'allow',
			);
		});

		test('Always не перекрывает denylist', () => {
			const policy: ApprovalPolicy = {
				...askPolicy('shell'),
				shell: { mode: 'ask', allowlist: [], denylist: ['rm*'] },
			};
			assert.strictEqual(
				evaluateApproval('shell', 'rm -rf /', policy, ['rm*']),
				'deny',
			);
		});
	});

	suite('confirm choice: apply / always / allow_remaining / skip / abort', () => {
		const cases: Array<[ConfirmChoice, 'proceed' | 'denied' | 'abort']> = [
			['apply', 'proceed'],
			['always', 'proceed'],
			['allow_remaining', 'proceed'],
			['skip', 'denied'],
			['abort', 'abort'],
		];

		for (const [choice, expected] of cases) {
			test(`${choice} -> ${expected}`, () => {
				assert.strictEqual(resolveConfirmChoiceOutcome(choice), expected);
			});
		}

		test('always помечается для sessionAllow callback', () => {
			assert.strictEqual(isAlwaysConfirmChoice('always'), true);
			assert.strictEqual(isAlwaysConfirmChoice('apply'), false);
			assert.strictEqual(isAlwaysConfirmChoice('allow_remaining'), false);
			assert.strictEqual(isAlwaysConfirmChoice('skip'), false);
			assert.strictEqual(isAlwaysConfirmChoice('abort'), false);
		});
	});

	suite('gating: skipConfirm / forceConfirm * edits/shell', () => {
		test('ask без autoApprove -> карточка (edits и shell)', () => {
			for (const action of ['edits', 'shell'] as const) {
				const g = resolveToolConfirmGating({
					decision: 'ask',
					action,
					autoApprove: false,
					sensitiveWrite: false,
					planShellForceAsk: false,
					nestedStrictMutating: false,
				});
				assert.strictEqual(g.skipConfirm, false, action);
				assert.strictEqual(g.forceConfirm, false, action);
			}
		});

		test('ask + autoApprove -> skip (как Always/allow path без UI)', () => {
			for (const action of ['edits', 'shell', 'web'] as const) {
				const g = resolveToolConfirmGating({
					decision: 'ask',
					action,
					autoApprove: true,
					sensitiveWrite: false,
					planShellForceAsk: false,
					nestedStrictMutating: false,
				});
				assert.strictEqual(g.skipConfirm, true, action);
				assert.strictEqual(g.forceConfirm, false, action);
			}
		});

		test('allow -> skip; deny не доходит до gating (ранний return в execute)', () => {
			const g = resolveToolConfirmGating({
				decision: 'allow',
				action: 'edits',
				autoApprove: false,
				sensitiveWrite: false,
				planShellForceAsk: false,
				nestedStrictMutating: false,
			});
			assert.strictEqual(g.skipConfirm, true);
			assert.strictEqual(g.forceConfirm, false);
		});

		test('review edits -> forceConfirm (даже autoApprove)', () => {
			const g = resolveToolConfirmGating({
				decision: 'review',
				action: 'edits',
				autoApprove: true,
				sensitiveWrite: false,
				planShellForceAsk: false,
				nestedStrictMutating: false,
			});
			assert.strictEqual(g.skipConfirm, false);
			assert.strictEqual(g.forceConfirm, true);
		});

		test('Plan shell force ask -> forceConfirm', () => {
			const g = resolveToolConfirmGating({
				decision: 'ask',
				action: 'shell',
				autoApprove: true,
				sensitiveWrite: false,
				planShellForceAsk: true,
				nestedStrictMutating: false,
			});
			assert.strictEqual(g.skipConfirm, false);
			assert.strictEqual(g.forceConfirm, true);
		});

		test('sensitiveWrite / nestedStrictMutating блокируют skip', () => {
			const sensitive = resolveToolConfirmGating({
				decision: 'allow',
				action: 'edits',
				autoApprove: true,
				sensitiveWrite: true,
				planShellForceAsk: false,
				nestedStrictMutating: false,
			});
			assert.strictEqual(sensitive.skipConfirm, false);

			const nested = resolveToolConfirmGating({
				decision: 'ask',
				action: 'edits',
				autoApprove: true,
				sensitiveWrite: false,
				planShellForceAsk: false,
				nestedStrictMutating: true,
			});
			assert.strictEqual(nested.skipConfirm, false);
		});

		test('после central Apply (skipConfirm=true) tool-level confirm не дублирует Always/Apply', () => {
			// Имитация: executeAgentTool выставил skipConfirm после карточки
			assert.strictEqual(
				shouldSkipToolConfirm({
					skipConfirm: true,
					forceConfirm: false,
					autoApprove: false,
				}),
				true,
			);
			// overwrite user edits / Plan shell: forceConfirm всё ещё показывает карточку
			assert.strictEqual(
				shouldSkipToolConfirm({
					skipConfirm: true,
					forceConfirm: true,
					autoApprove: false,
				}),
				false,
			);
			assert.strictEqual(
				shouldSkipToolConfirm({
					skipConfirm: false,
					forceConfirm: false,
					autoApprove: true,
				}),
				true,
			);
		});

		test('allowRemainingEditsThisTurn -> skip для edits/delete (batch, совместимо с central)', () => {
			const g = resolveToolConfirmGating({
				decision: 'ask',
				action: 'edits',
				autoApprove: false,
				sensitiveWrite: false,
				planShellForceAsk: false,
				nestedStrictMutating: false,
				allowRemainingEditsThisTurn: true,
			});
			assert.strictEqual(g.skipConfirm, true);
			assert.strictEqual(g.forceConfirm, false);
			assert.strictEqual(
				shouldSkipToolConfirm({
					skipConfirm: g.skipConfirm,
					forceConfirm: g.forceConfirm,
					autoApprove: false,
				}),
				true,
			);
		});
	});

	suite('toolsFallback Continue / Stop + continueLoopOnDeny', () => {
		test('Continue: apply / always / allow_remaining', () => {
			assert.strictEqual(shouldContinueToolsFallback('apply'), true);
			assert.strictEqual(shouldContinueToolsFallback('always'), true);
			assert.strictEqual(shouldContinueToolsFallback('allow_remaining'), true);
		});

		test('Stop: skip / abort', () => {
			assert.strictEqual(shouldContinueToolsFallback('skip'), false);
			assert.strictEqual(shouldContinueToolsFallback('abort'), false);
		});

		test('stop loop on deny только если !cancelled && !continueLoopOnDeny', () => {
			assert.strictEqual(shouldStopLoopOnToolDeny(true, false, false), true);
			assert.strictEqual(shouldStopLoopOnToolDeny(true, false, true), false);
			assert.strictEqual(shouldStopLoopOnToolDeny(true, true, false), false);
			assert.strictEqual(shouldStopLoopOnToolDeny(false, false, false), false);
		});
	});

	suite('registry smoke: risk -> action edits/shell/web', () => {
		test('builtin meta risk согласован с toolActionType', () => {
			const cases: Array<[string, string, ReturnType<typeof toolActionType>]> = [
				['write_file', 'write', 'edits'],
				['edit_file', 'write', 'edits'],
				['apply_patch', 'write', 'edits'],
				['run_command', 'shell', 'shell'],
				['run_tests', 'shell', 'shell'],
				['web_search', 'web', 'web'],
				['fetch_page', 'web', 'web'],
			];
			for (const [name, risk, action] of cases) {
				assert.strictEqual(getToolMeta(name)?.risk, risk, name);
				assert.strictEqual(toolActionType(name), action, name);
			}
		});
	});

	test('multi-root overwrite snapshots stay isolated by URI', () => {
		const tracker = new AgentWriteTracker();
		const first = vscode.Uri.file('/workspace/root-a/src/shared.ts');
		const second = vscode.Uri.file('/workspace/root-b/src/shared.ts');
		tracker.remember(first, 'src/shared.ts', 'export const root = "a";\n');
		tracker.remember(second, 'src/shared.ts', 'export const root = "b";\n');

		assert.strictEqual(tracker.size, 2);
		assert.strictEqual(tracker.hasUserEdits(first, 'export const root = "a";\n'), false);
		assert.strictEqual(tracker.hasUserEdits(second, 'export const root = "b changed";\n'), true);
		assert.strictEqual(tracker.hasUserEdits(first, 'export const root = "a";\n'), false);
	});
});
