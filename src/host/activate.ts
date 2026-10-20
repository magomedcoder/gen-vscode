import * as vscode from 'vscode';
import { registerChat } from '../features/chat';
import { getSessionPeek } from '../features/chat/sessionStore';
import { initSettings } from '../core/config/settings';
import { initIndexManager } from '../features/index/IndexManager';
import { flushVectorsCache } from '../features/index/vectorStore';
import { initLogger } from '../core/log/logger';
import { initFileWatcherHooks } from '../features/project/fileWatcherHooks';
import { initGenRulesManager } from '../features/project/genrules';
import { flushUsageStore, initUsageStore } from '../core/stores/usageStore';
import { preloadWebviewL10n } from '../l10n/loadBundle';
import { registerHostCommands } from './commands';
import { registerHostProviders } from './providers';
import { initDesignSession } from '../features/design/designSession';

export function activate(context: vscode.ExtensionContext): void {
	initSettings(context);
	initLogger(context);
	initIndexManager(context);
	initGenRulesManager(context);
	initFileWatcherHooks(context);
	initUsageStore(context);
	initDesignSession(context.workspaceState);
	// Прогрев l10n webview async (без sync FS на первом открытии панели)
	void preloadWebviewL10n(context.extensionUri);

	const { diffProvider, disposables: providerDisposables } = registerHostProviders();

	context.subscriptions.push(
		...providerDisposables,
		...registerHostCommands(diffProvider),
		registerChat(context),
	);
}

export async function deactivate(): Promise<void> {
	// Debounced stores: не терять последние записи при закрытии окна
	await Promise.all([flushUsageStore(), getSessionPeek()?.flush(), flushVectorsCache().catch(() => {})]);
}
