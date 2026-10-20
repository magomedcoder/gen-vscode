import type { ExtensionContext } from 'vscode';
import { buildAuthHeaders } from './apiKeyHeaders';
import { clearSecret, getSecret, hasSecret, initSecretVault, setSecret } from './secretVault';

export { buildAuthHeaders } from './apiKeyHeaders';

export function initApiKeyStore(context: ExtensionContext): void {
	initSecretVault(context);
}

export async function getApiKey(): Promise<string> {
	return getSecret('apiKey');
}

export async function hasApiKey(): Promise<boolean> {
	return hasSecret('apiKey');
}

export async function setApiKey(value: string): Promise<void> {
	await setSecret('apiKey', value);
}

export async function clearApiKey(): Promise<void> {
	await clearSecret('apiKey');
}

export async function getWebSearchApiKey(): Promise<string> {
	return getSecret('webSearchApiKey');
}

export async function hasWebSearchApiKey(): Promise<boolean> {
	return hasSecret('webSearchApiKey');
}

export async function setWebSearchApiKey(value: string): Promise<void> {
	await setSecret('webSearchApiKey', value);
}

export async function clearWebSearchApiKey(): Promise<void> {
	await clearSecret('webSearchApiKey');
}

export async function getEmbeddingsApiKey(): Promise<string> {
	return getSecret('embeddingsApiKey');
}

export async function hasEmbeddingsApiKey(): Promise<boolean> {
	return hasSecret('embeddingsApiKey');
}

export async function setEmbeddingsApiKey(value: string): Promise<void> {
	await setSecret('embeddingsApiKey', value);
}

export async function clearEmbeddingsApiKey(): Promise<void> {
	await clearSecret('embeddingsApiKey');
}
