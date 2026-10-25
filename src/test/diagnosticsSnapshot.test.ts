import * as assert from 'assert';
import { formatDiagnosticsVerifyBlock, type DiagnosticsSnapshot } from '../features/agent/tools/ide/diagnosticsSnapshot.js';

suite('diagnosticsSnapshot', () => {
	test('empty -> no errors marker', () => {
		const snap: DiagnosticsSnapshot = {
			truncated: false,
			count: 0,
			total: 0,
			errorCount: 0,
			diagnostics: [],
		};
		assert.strictEqual(formatDiagnosticsVerifyBlock(snap), '### Verify (diagnostics)\n(no errors)');
	});

	test('errors -> json fence with path/line', () => {
		const snap: DiagnosticsSnapshot = {
			truncated: false,
			count: 1,
			total: 1,
			errorCount: 1,
			diagnostics: [{
				path: 'src/a.ts',
				line: 3,
				character: 1,
				severity: 'error',
				source: 'ts',
				message: 'x',
			}],
		};
		const block = formatDiagnosticsVerifyBlock(snap);
		assert.ok(block.includes('### Verify (diagnostics)'));
		assert.ok(block.includes('"path": "src/a.ts"'));
		assert.ok(block.includes('"line": 3'));
	});
});
