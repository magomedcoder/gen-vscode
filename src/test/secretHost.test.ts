import * as assert from 'assert';
import * as vscode from 'vscode';
import { applySaveSettingsSecrets, confirmSecretClear } from '../features/chat/secretHost.js';

suite('secretHost', () => {
	test('confirmSecretClear: cancel (undefined) -> false', async () => {
		const original = vscode.window.showWarningMessage;
		(vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;
		try {
			assert.strictEqual(await confirmSecretClear('apiKey'), false);
		} finally {
			(vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = original;
		}
	});

	test('applySaveSettingsSecrets: cancelled clear returns false (no vault mutation)', async () => {
		const originalWarning = vscode.window.showWarningMessage;
		let warned = false;
		(vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = (async () => {
			warned = true;
			return undefined;
		}) as typeof vscode.window.showWarningMessage;

		try {
			// cancel на confirm -> ранний return до clearApiKey
			const ok = await applySaveSettingsSecrets({ clearApiKey: true });
			assert.strictEqual(warned, true);
			assert.strictEqual(ok, false);
		} finally {
			(vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
				originalWarning;
		}
	});
});
