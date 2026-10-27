import * as assert from 'assert';
import { parseUnifiedDiff } from '../features/agent/patch.js';
import { buildPatchFailAutoRetryPrompt, diagnoseFailedHunk, diagnoseSearchReplaceFail, formatStructuredPatchFail, isPatchFailRetryCode, PATCH_FAIL_RETRY_TOOLS } from '../features/agent/tools/patchFailPayload.js';

suite('patchFailPayload', () => {
	test('diagnoseFailedHunk: первый несовпавший hunk + file_slice', () => {
		const fileContent = [
			'line1',
			'keep',
			'actual',
			'keep2',
			'line5',
		].join('\n');
		const patch = [
			'--- a/f.ts',
			'+++ b/f.ts',
			'@@ -2,3 +2,3 @@',
			' keep',
			'-missing',
			'+fixed',
			' keep2',
			'',
		].join('\n');
		const file = parseUnifiedDiff(patch)[0]!;
		const d = diagnoseFailedHunk(fileContent, file);
		assert.ok(d);
		assert.strictEqual(d!.hunkIndex, 0);
		assert.ok(d!.hunkText.includes('-missing'));
		assert.ok(d!.hunkText.includes('+fixed'));
		assert.ok(d!.sliceText.includes('actual'));
		assert.ok(d!.sliceText.includes('|keep'));
	});

	test('formatStructuredPatchFail содержит constraint и hunk', () => {
		const file = parseUnifiedDiff([
			'--- a/a.ts',
			'+++ b/a.ts',
			'@@ -1,1 +1,1 @@',
			'-old',
			'+new',
			'',
		].join('\n'))[0]!;
		const d = diagnoseFailedHunk('other\n', file);
		const text = formatStructuredPatchFail({
			errorMessage: 'a.ts: apply failed',
			path: 'a.ts',
			diagnosis: d,
		});
		assert.ok(text.includes('apply_diff | edit_file | apply_patch'));
		assert.ok(text.includes('failed_hunk'));
		assert.ok(text.includes('file_slice'));
		assert.ok(text.includes('-old'));
	});

	test('diagnoseSearchReplaceFail + auto-retry helpers', () => {
		const d = diagnoseSearchReplaceFail('aaa\nbbb\nccc\n', 'bbb');
		assert.ok(d.sliceText.includes('bbb'));
		assert.ok(d.hunkText.includes('bbb'));
		assert.ok(isPatchFailRetryCode('diff_apply_failed'));
		assert.ok(isPatchFailRetryCode('patch_not_found'));
		assert.ok(!isPatchFailRetryCode('other'));
		assert.ok(PATCH_FAIL_RETRY_TOOLS.includes('apply_diff'));
		assert.ok(buildPatchFailAutoRetryPrompt(['src/a.ts']).includes('src/a.ts'));
	});
});
