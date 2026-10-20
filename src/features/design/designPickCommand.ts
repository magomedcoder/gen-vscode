import * as vscode from 'vscode';
import type { ToWebviewMessage } from '../chat/protocol';
import { buildDesignSessionMessage } from './designSessionBridge';
import { handleDesignClick } from './designVisual';

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

// Вытащить первый http(s) URL из произвольного текста (буфер, адресная строка)
export function extractHttpUrlFromText(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	const direct = normalizePageUrl(trimmed);
	if (direct) {
		return direct;
	}

	const match = URL_IN_TEXT.exec(trimmed);
	return match ? normalizePageUrl(match[0]) : undefined;
}

function normalizePageUrl(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
		const url = new URL(withScheme);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}

		return url.toString();
	} catch {
		return undefined;
	}
}

/**
 * Host-команда: URL из буфера (или input) + селектор -> handleDesignClick.
 * Результат уходит в chat webview, если он открыт (без CDP Simple Browser).
 */
export async function runDesignPickFromClipboard(
	postToWebview?: (message: ToWebviewMessage) => void,
): Promise<void> {
	const clip = (await vscode.env.clipboard.readText()).trim();
	let url = extractHttpUrlFromText(clip);

	if (!url) {
		const input = await vscode.window.showInputBox({
			title: vscode.l10n.t('design.pick.urlPrompt'),
			prompt: vscode.l10n.t('design.pick.urlHint'),
			value: clip,
			ignoreFocusOut: true,
		});
		if (input === undefined) {
			return;
		}

		url = extractHttpUrlFromText(input) ?? normalizePageUrl(input);
		if (!url) {
			void vscode.window.showWarningMessage(vscode.l10n.t('tool.browserBadUrl'));
			return;
		}
	}

	const selectorInput = await vscode.window.showInputBox({
		title: vscode.l10n.t('design.pick.selectorPrompt'),
		prompt: vscode.l10n.t('design.pick.selectorHint'),
		placeHolder: '#root, .app-shell',
		ignoreFocusOut: true,
	});
	if (selectorInput === undefined) {
		return;
	}

	const selector = selectorInput.trim();
	if (!selector) {
		void vscode.window.showWarningMessage(vscode.l10n.t('design.click.requiresUrlSelector'));
		return;
	}

	const result = await handleDesignClick({ url, selector });
	postToWebview?.({
		type: 'designClickResult',
		result,
	});
	postToWebview?.(buildDesignSessionMessage());

	if (result.message && !result.ok) {
		void vscode.window.showInformationMessage(result.message);
	}
}
