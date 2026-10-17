import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { CHAT_VIEW_ID, CHAT_VIEW_SIDEBAR_ID } from './ids';

export type ChatFocusTarget = 'panel' | 'sidebar';

// Сфокусировать чат: panel / sidebar, либо по chatViewLocation (both -> panel с fallback)
export async function focusChatView(preferred?: ChatFocusTarget): Promise<void> {
	const loc = getSettings().chatViewLocation;
	const target: ChatFocusTarget = preferred ?? (loc === 'sidebar' ? 'sidebar' : 'panel');

	const primary = target === 'sidebar' ? CHAT_VIEW_SIDEBAR_ID : CHAT_VIEW_ID;
	const fallback = target === 'sidebar' ? CHAT_VIEW_ID : CHAT_VIEW_SIDEBAR_ID;

	try {
		await vscode.commands.executeCommand(`${primary}.focus`);
	} catch {
		await vscode.commands.executeCommand(`${fallback}.focus`).then(undefined, () => undefined);
	}
}
