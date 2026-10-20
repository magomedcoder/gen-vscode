import * as vscode from 'vscode';
import type { ExtensionContext, SecretStorage } from 'vscode';
import { interpolateConfigStringAsync } from './interpolate';

// Идентификаторы секретов Gen (единый vault поверх VSCode SecretStorage)
export type GenSecretId = 'apiKey' | 'webSearchApiKey' | 'embeddingsApiKey';

const SECRET_KEYS: Record<GenSecretId, string> = {
	apiKey: 'gen.apiKey',
	webSearchApiKey: 'gen.webSearchApiKey',
	embeddingsApiKey: 'gen.embeddingsApiKey',
};

/**
 * Fallback, когда vault пуст (Settings UI секретов нет).
 * Local-first: по умолчанию ключ не нужен; для gateway - env.
 */
const ENV_FALLBACKS: Record<GenSecretId, readonly string[]> = {
	apiKey: ['GEN_API_KEY', 'OPENAI_API_KEY'],
	webSearchApiKey: ['GEN_WEB_SEARCH_API_KEY'],
	embeddingsApiKey: ['GEN_EMBEDDINGS_API_KEY'],
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

function readEnvFallback(id: GenSecretId): string {
	for (const name of ENV_FALLBACKS[id]) {
		const value = process.env[name]?.trim();
		if (value) {
			return value;
		}
	}

	return '';
}

export async function getSecret(id: GenSecretId): Promise<string> {
	return (await secrets?.get(SECRET_KEYS[id]))?.trim() ?? '';
}

// Сырой секрет из vault (+ `${env:}` / `{file:}`); если пусто - env fallback; иначе ''
export async function getResolvedSecret(id: GenSecretId): Promise<string> {
	const raw = await getSecret(id);
	if (raw) {
		return (await interpolateConfigStringAsync(raw)).trim();
	}

	return readEnvFallback(id);
}

export async function hasSecret(id: GenSecretId): Promise<boolean> {
	return Boolean(await getResolvedSecret(id));
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

// Имена env для docs / подсказок (без UI)
export function secretEnvFallbackNames(id: GenSecretId): readonly string[] {
	return ENV_FALLBACKS[id];
}
