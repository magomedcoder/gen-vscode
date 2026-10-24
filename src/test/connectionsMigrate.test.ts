import * as assert from 'assert';
import { applyOpenAfterEdit, applyWorkspaceContextScale, readOpenAfterEdit, readWorkspaceContextScale } from '../core/config/connections.js';
import { DEFAULT_SETTINGS } from '../core/config/types.js';

suite('workspace context / open-after-edit helpers', () => {
	test('workspace context scale round-trip', () => {
		const full = applyWorkspaceContextScale(DEFAULT_SETTINGS, 'full');
		assert.equal(readWorkspaceContextScale({ ...DEFAULT_SETTINGS, ...full }), 'full');
		const off = applyWorkspaceContextScale(DEFAULT_SETTINGS, 'off');
		assert.equal(readWorkspaceContextScale({ ...DEFAULT_SETTINGS, ...off }), 'off');
	});

	test('open-after-edit mapping', () => {
		assert.equal(readOpenAfterEdit({ backgroundEditMode: true, revealOnEdit: 'focus' }), 'never');
		assert.deepEqual(applyOpenAfterEdit('preview'), { backgroundEditMode: false, revealOnEdit: 'preview' });
		assert.deepEqual(applyOpenAfterEdit('never'), { backgroundEditMode: true, revealOnEdit: 'never' });
	});
});
