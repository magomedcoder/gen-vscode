import * as vscode from 'vscode';
import { registerChat } from '../features/chat';
import { initSettings } from '../core/config/settings';
import { initIndexManager } from '../features/index/IndexManager';
import { initLogger } from '../core/log/logger';
import { initFileWatcherHooks } from '../features/project/fileWatcherHooks';
import { initGenRulesManager } from '../features/project/genrules';
import { initActivityStore } from '../core/stores/activityStore';
import { initUsageStore } from '../core/stores/usageStore';
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
	initActivityStore(context);
	initDesignSession(context.workspaceState);

	const { diffProvider, disposables: providerDisposables } = registerHostProviders();

	context.subscriptions.push(
		...providerDisposables,
		...registerHostCommands(diffProvider),
		registerChat(context),
	);
}

export function deactivate(): void {}
