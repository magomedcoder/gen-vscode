import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as vscode from 'vscode';

export interface WebviewL10nPack {
	locale: string;
	strings: Record<string, string>;
}

function parseJson(raw: string): Record<string, string> | undefined {
	try {
		const parsed = JSON.parse(raw) as Record<string, string>;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readJson(uri: vscode.Uri): Record<string, string> | undefined {
	try {
		return parseJson(fs.readFileSync(uri.fsPath, 'utf8'));
	} catch {
		return undefined;
	}
}

async function readJsonAsync(uri: vscode.Uri): Promise<Record<string, string> | undefined> {
	try {
		return parseJson(await fsp.readFile(uri.fsPath, 'utf8'));
	} catch {
		return undefined;
	}
}

// Кэш пака по extensionUri+locale: bundle не меняется за сессию, повторные webview не читают диск
const packCache = new Map<string, WebviewL10nPack>();

function cacheKey(extensionUri: vscode.Uri, locale: string): string {
	return `${extensionUri.toString()}|${locale}`;
}

function mergePack(
	locale: string,
	en: Record<string, string>,
	localized: Record<string, string>,
): WebviewL10nPack {
	const lang = locale.split('-')[0] || 'en';
	if (lang === 'en') {
		return { locale: 'en', strings: en };
	}

	return {
		locale: lang,
		strings: {
			...en,
			...localized
		},
	};
}

// Async прогрев кэша (вызывать на activate): первый открытый webview не блокирует EH sync-чтением
export async function preloadWebviewL10n(extensionUri: vscode.Uri): Promise<WebviewL10nPack> {
	const locale = vscode.env.language || 'en';
	const key = cacheKey(extensionUri, locale);
	const cached = packCache.get(key);
	if (cached) {
		return cached;
	}

	const lang = locale.split('-')[0] || 'en';
	const l10nRoot = vscode.Uri.joinPath(extensionUri, 'l10n');
	const en = (await readJsonAsync(vscode.Uri.joinPath(l10nRoot, 'bundle.l10n.json'))) ?? {};
	let localized: Record<string, string> = {};
	if (lang !== 'en') {
		localized = (await readJsonAsync(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${locale}.json`)))
			?? (await readJsonAsync(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${lang}.json`)))
			?? {};
	}

	const pack = mergePack(locale, en, localized);
	packCache.set(key, pack);
	return pack;
}

// Английский fallback + перевод по vscode.env.language для webview (cache hit после preload / первого вызова)
export function loadWebviewL10n(extensionUri: vscode.Uri): WebviewL10nPack {
	const locale = vscode.env.language || 'en';
	const key = cacheKey(extensionUri, locale);
	const cached = packCache.get(key);
	if (cached) {
		return cached;
	}

	const lang = locale.split('-')[0] || 'en';
	const l10nRoot = vscode.Uri.joinPath(extensionUri, 'l10n');
	const en = readJson(vscode.Uri.joinPath(l10nRoot, 'bundle.l10n.json')) ?? {};
	let localized: Record<string, string> = {};
	if (lang !== 'en') {
		localized = readJson(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${locale}.json`))
			?? readJson(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${lang}.json`))
			?? {};
	}

	const pack = mergePack(locale, en, localized);
	packCache.set(key, pack);
	return pack;
}
