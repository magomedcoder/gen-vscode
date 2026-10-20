import * as assert from 'assert';
import { DEFAULT_APPROVAL_POLICY } from '../core/config/approvalTypes.js';
import { evaluateApproval } from '../features/agent/permissionPolicy.js';
import { buildEditReviewEntriesFromArgs, editPathsFromToolArgs, formatEditReviewPreview, needsReviewDiffConfirm } from '../features/agent/tools/reviewEditPreview.js';

suite('reviewEditPreview', () => {
	test('needsReviewDiffConfirm только для decision=review + edits', () => {
		assert.strictEqual(needsReviewDiffConfirm('review', 'edits'), true);
		assert.strictEqual(needsReviewDiffConfirm('ask', 'edits'), false);
		assert.strictEqual(needsReviewDiffConfirm('allow', 'edits'), false);
		assert.strictEqual(needsReviewDiffConfirm('review', 'shell'), false);
		assert.strictEqual(needsReviewDiffConfirm('review', undefined), false);
	});

	test('evaluateApproval: review на edits -> review (не heuristic allow)', () => {
		const policy = structuredClone(DEFAULT_APPROVAL_POLICY);
		policy.edits = { mode: 'review', allowlist: [], denylist: [] };
		assert.strictEqual(evaluateApproval('edits', 'src/a.ts', policy), 'review');
		assert.strictEqual(evaluateApproval('edits', '.env', policy), 'review');
	});

	test('evaluateApproval: review на shell -> heuristic ask/allow', () => {
		const policy = structuredClone(DEFAULT_APPROVAL_POLICY);
		policy.shell = { mode: 'review', allowlist: [], denylist: [] };
		assert.strictEqual(evaluateApproval('shell', 'echo hi', policy), 'allow');
		assert.strictEqual(evaluateApproval('shell', 'rm -rf /', policy), 'ask');
	});

	test('editPathsFromToolArgs: write_file / apply_workspace_edit', () => {
		assert.deepStrictEqual(editPathsFromToolArgs('write_file', { path: 'a.ts', content: 'x' }), ['a.ts']);
		assert.deepStrictEqual(
			editPathsFromToolArgs('apply_workspace_edit', {
				edits: [
					{
						path: 'a.ts',
						old_string: 'a',
						new_string: 'b'
					},
					{
						path: 'b.ts',
						old_string: 'c',
						new_string: 'd'
					},
					{
						path: 'a.ts',
						old_string: 'e',
						new_string: 'f'
					},
				],
			}),
			['a.ts', 'b.ts'],
		);
	});

	test('buildEditReviewEntriesFromArgs: write_file overwrite', () => {
		const files = new Map([['src/a.ts', 'hello\n']]);
		const entries = buildEditReviewEntriesFromArgs('write_file', {
			path: 'src/a.ts',
			content: 'hello\nworld\n'
		}, files);
		assert.ok(entries);
		assert.strictEqual(entries!.length, 1);
		assert.strictEqual(entries![0]!.before, 'hello\n');
		assert.strictEqual(entries![0]!.after, 'hello\nworld\n');
	});

	test('buildEditReviewEntriesFromArgs: apply_patch', () => {
		const files = new Map([['f.ts', 'const x = 1;\n']]);
		const entries = buildEditReviewEntriesFromArgs('apply_patch', {
			path: 'f.ts',
			old_string: 'const x = 1;',
			new_string: 'const x = 2;'
		}, files);
		assert.ok(entries);
		assert.ok(entries![0]!.after.includes('const x = 2;'));
	});

	test('buildEditReviewEntriesFromArgs: apply_diff', () => {
		const files = new Map([['f.ts', 'const x = 1;\n']]);
		const patch = [
			'--- a/f.ts',
			'+++ b/f.ts',
			'@@ -1,1 +1,1 @@',
			'-const x = 1;',
			'+const x = 2;',
			'',
		].join('\n');
		assert.deepStrictEqual(editPathsFromToolArgs('apply_diff', { patch }), ['f.ts']);
		const entries = buildEditReviewEntriesFromArgs('apply_diff', { patch }, files);
		assert.ok(entries);
		assert.ok(entries![0]!.after.includes('const x = 2;'));
	});

	test('buildEditReviewEntriesFromArgs: edit_file content -> write', () => {
		const entries = buildEditReviewEntriesFromArgs('edit_file', {
			path: 'new.ts',
			content: 'export {}\n'
		},
		new Map());
		assert.ok(entries);
		assert.strictEqual(entries![0]!.before, '');
		assert.strictEqual(entries![0]!.after, 'export {}\n');
	});

	test('formatEditReviewPreview: unified summary + truncate', () => {
		const text = formatEditReviewPreview([
			{
				path: 'a.ts',
				before: 'a\n',
				after: 'b\n'
			},
		]);
		assert.ok(text.includes('a.ts'));
		assert.ok(text.includes('-a') || text.includes('+b') || text.includes('b'));

		const long = formatEditReviewPreview([{
			path: 'big.ts',
			before: 'x'.repeat(100),
			after: 'y'.repeat(100)
		}], 40);
		assert.ok(long.length <= 50);
		assert.ok(long.endsWith('...'));
	});
});
