import * as vscode from 'vscode';
import { getSettings, setSessionModel } from '../../core/config/settings';
import type { ChatMode } from '../../core/config/types';
import { expandCommandTemplate, validateCommandArgs } from '../project/customCommands';
import type { CustomCommand } from '../project/customCommands';
import type { ChatUiMessage } from './protocol';
import type { ParsedSlashMode } from './slashCommands';
import type { SessionSummary } from './sessionStore';
import { messageId } from './ids';

// Операции ChatSession, нужные обработчику slash-команд (без доступа к приватным полям)
export interface ChatSlashHost {
	append(message: ChatUiMessage): void;
	send(text: string): Promise<void>;
	setMode(mode: ChatMode): Promise<void>;
	exportSessionMarkdown(): Promise<void>;
	importSessionMarkdown(): Promise<void>;
	runInitRules(hint?: string): Promise<void>;
	canCreateTab(): boolean;
	notifyMaxTabs(): void;
	createSession(): void;
	runCompact(): Promise<void>;
	restoreExportArchive(): Promise<void>;
	runUndo(opts: { files: boolean; task: boolean }): Promise<void>;
	runRedo(): Promise<void>;
	runDeepPlanning(goal: string): Promise<void>;
	compareLastCheckpoint(): Promise<void>;
	listStartedSessions(): SessionSummary[];
	getCurrentSessionId(): string;
	getCustomCommands(): readonly CustomCommand[];
}

/**
 * Выполнить распознанную slash-команду.
 * Всегда "поглощает" ввод (команда не уходит в LLM как есть); для режимов / кастомных команд с телом повторно вызывает host.send с остатком текста.
 */
export async function handleSlashCommand(host: ChatSlashHost, slash: ParsedSlashMode): Promise<void> {
	switch (slash.command) {
		case 'export':
			await host.exportSessionMarkdown();
			return;
		case 'import':
			await host.importSessionMarkdown();
			return;
		case 'init':
			await host.runInitRules(slash.rest);
			return;
		case 'new':
			if (!host.canCreateTab()) {
				host.notifyMaxTabs();
				return;
			}
			host.createSession();
			host.append({
				id: messageId(),
				role: 'system',
				content: vscode.l10n.t('chat.slash.new.done'),
			});
			return;
		case 'compact':
			await host.runCompact();
			return;
		case 'restore-archive':
			await host.restoreExportArchive();
			return;
		case 'undo': {
			const scope = slash.rest.trim().toLowerCase();
			if (scope === 'files' || scope === 'file') {
				await host.runUndo({ 
					files: true, 
					task: false 
				});
			} else if (scope === 'task' || scope === 'messages') {
				await host.runUndo({ 
					files: false, 
					task: true 
				});
			} else {
				await host.runUndo({ 
					files: true, 
					task: true 
				});
			}
			return;
		}
		case 'deep-planning':
		case 'deep_planning':
			await host.runDeepPlanning(slash.rest);
			return;
		case 'compare':
		case 'restore-compare':
			await host.compareLastCheckpoint();
			return;
		case 'redo':
			await host.runRedo();
			return;
		case 'sessions': {
			const list = host.listStartedSessions();
			const currentId = host.getCurrentSessionId();
			const lines = list.map((s, i) => {
				const mark = s.id === currentId ? ' ' : ' ';
				return `${mark} ${i + 1}. ${s.title} (${s.messageCount})`;
			});
			host.append({
				id: messageId(),
				role: 'system',
				content: vscode.l10n.t('chat.slash.sessions.info', list.length, lines.join('\n') || '-'),
			});
			return;
		}
		case 'models': {
			const settings = getSettings();
			const model = settings.model.trim() || '-';
			const small = settings.smallModel.trim() || '-';
			const plan = settings.planModel.trim() || model;
			const act = settings.actModel.trim() || model;
			host.append({
				id: messageId(),
				role: 'system',
				content: vscode.l10n.t('chat.slash.models.info', model, small) + `\nplan: ${plan}\nact: ${act}`,
			});
			return;
		}
		default:
			break;
	}

	if (slash.custom) {
		await runCustomSlash(host, slash);
		return;
	}

	if (slash.mode && slash.mode !== getSettings().chatMode) {
		await host.setMode(slash.mode);
	}

	if (!slash.rest) {
		return;
	}

	await host.send(slash.rest);
}

async function runCustomSlash(host: ChatSlashHost, slash: ParsedSlashMode): Promise<void> {
	const custom = host.getCustomCommands().find((c) => c.name === slash.command);
	if (!custom) {
		return;
	}

	const argsCheck = validateCommandArgs(custom.body, slash.rest);
	if (!argsCheck.ok) {
		host.append({
			id: messageId(),
			role: 'assistant',
			content: `/${custom.name}: ${argsCheck.message}${custom.argumentsHint ? ` (${custom.argumentsHint})` : ''}`,
		});
		return;
	}

	if (custom.mode && custom.mode !== getSettings().chatMode) {
		await host.setMode(custom.mode);
	}

	if (custom.model?.trim()) {
		setSessionModel(custom.model.trim());
	}

	const expanded = expandCommandTemplate(custom.body, slash.rest);
	if (!expanded) {
		host.append({
			id: messageId(),
			role: 'assistant',
			content: vscode.l10n.t('chat.slash.custom.empty', custom.name),
		});
		return;
	}

	await host.send(expanded);
}
