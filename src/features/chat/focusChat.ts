import * as vscode from 'vscode';
import type { ChatViewProvider } from './ChatViewProvider';
import { CHAT_VIEW_ID } from './ids';

let editorHost: ChatViewProvider | undefined;

export function setChatEditorHost(provider: ChatViewProvider | undefined): void {
	editorHost = provider;
}

// Нижняя панель (WebviewView)
export async function focusChatView(): Promise<void> {
	await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`).then(undefined, () => undefined);
}

// Вкладка редактора (полноценный экран)
export function focusChatEditor(): void {
	editorHost?.showEditorChat();
}
