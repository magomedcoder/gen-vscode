import * as vscode from 'vscode';
import type { ExtensionContext, SecretStorage } from 'vscode';

// Идентификаторы секретов Gen (единый vault поверх VSCode SecretStorage)
export type GenSecretId = 'apiKey' | 'webSearchApiKey';

const SECRET_KEYS: Record<GenSecretId, string> = {
	apiKey: 'gen.apiKey',
	webSearchApiKey: 'gen.webSearchApiKey',
};

let secrets: SecretStorage | undefined;

export function initSecretVault(context: ExtensionContext): void {
	secrets = context.secrets;
}

function requireSecrets(): SecretStorage {
	if (!secrets) {
		throw new Error(vscode.l10n.t('config.apiKeyNotInit'));
	}
	
	return secrets;
}

export async function getSecret(id: GenSecretId): Promise<string> {
	return (await secrets?.get(SECRET_KEYS[id]))?.trim() ?? '';
}

export async function hasSecret(id: GenSecretId): Promise<boolean> {
	return Boolean(await getSecret(id));
}

// Пустая строка - удалить секрет
export async function setSecret(id: GenSecretId, value: string): Promise<void> {
	const store = requireSecrets();
	const trimmed = value.trim();
	if (!trimmed) {
		await store.delete(SECRET_KEYS[id]);
		return;
	}

	await store.store(SECRET_KEYS[id], trimmed);
}

export async function clearSecret(id: GenSecretId): Promise<void> {
	await setSecret(id, '');
}
