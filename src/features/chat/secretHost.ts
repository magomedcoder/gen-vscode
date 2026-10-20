import * as path from 'node:path';
import * as vscode from 'vscode';
import { clearApiKey, clearEmbeddingsApiKey, clearWebSearchApiKey, setApiKey, setEmbeddingsApiKey, setWebSearchApiKey } from '../../core/config/settings';
import type { GenSecretId } from '../../core/config/secretVault';

const CLEAR_LABEL_KEYS: Record<GenSecretId, string> = {
	apiKey: 'settings.apiKey.label',
	webSearchApiKey: 'settings.webSearchApiKey.label',
	embeddingsApiKey: 'settings.embeddingsApiKey.label',
};

// Подтверждение удаления секрета перед clear* на save (host-side)
export async function confirmSecretClear(id: GenSecretId): Promise<boolean> {
	const label = vscode.l10n.t(CLEAR_LABEL_KEYS[id]);
	const yes = vscode.l10n.t('settings.secret.clearConfirmYes');
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t('settings.secret.clearConfirm', label),
		{ modal: true },
		yes,
	);
	return choice === yes;
}

// Диалог выбора файла; возвращает `{file:relative/path}` для SecretStorage
export async function pickSecretFileRef(): Promise<string | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const picks = await vscode.window.showOpenDialog({
		canSelectMany: false,
		canSelectFiles: true,
		canSelectFolders: false,
		openLabel: vscode.l10n.t('settings.secret.browseFileOpen'),
		defaultUri: folder?.uri,
	});
	const picked = picks?.[0];
	if (!picked) {
		return undefined;
	}

	let refPath = picked.fsPath;
	if (folder) {
		const rel = path.relative(folder.uri.fsPath, picked.fsPath);
		if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
			refPath = rel.split(path.sep).join('/');
		}
	}

	return `{file:${refPath}}`;
}

export interface SaveSettingsSecretsPayload {
	apiKey?: string;
	clearApiKey?: boolean;
	webSearchApiKey?: string;
	clearWebSearchApiKey?: boolean;
	embeddingsApiKey?: string;
	clearEmbeddingsApiKey?: boolean;
}

// Применить секреты из saveSettings; false = пользователь отменил clear
export async function applySaveSettingsSecrets(msg: SaveSettingsSecretsPayload): Promise<boolean> {
	if (msg.clearApiKey) {
		if (!(await confirmSecretClear('apiKey'))) {
			return false;
		}
		await clearApiKey();
	} else if (typeof msg.apiKey === 'string' && msg.apiKey.trim()) {
		await setApiKey(msg.apiKey);
	}

	if (msg.clearWebSearchApiKey) {
		if (!(await confirmSecretClear('webSearchApiKey'))) {
			return false;
		}
		await clearWebSearchApiKey();
	} else if (typeof msg.webSearchApiKey === 'string' && msg.webSearchApiKey.trim()) {
		await setWebSearchApiKey(msg.webSearchApiKey);
	}

	if (msg.clearEmbeddingsApiKey) {
		if (!(await confirmSecretClear('embeddingsApiKey'))) {
			return false;
		}
		
		await clearEmbeddingsApiKey();
	} else if (typeof msg.embeddingsApiKey === 'string' && msg.embeddingsApiKey.trim()) {
		await setEmbeddingsApiKey(msg.embeddingsApiKey);
	}

	return true;
}
