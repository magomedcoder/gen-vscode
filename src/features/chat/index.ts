import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { focusChatEditor, focusChatView, setChatEditorHost } from './focusChat';
import { CHAT_VIEW_ID } from './ids';
import { setConfirmHost } from '../../host/ui/confirmDialog';
import { ensureTerminalBufferListener } from './terminalBuffer';
import { listAgentWorktrees, removeAgentWorktree } from '../agent/worktree';
import { enableProject } from '../project/config';
import { dryRunHookEvent, type HookEvent } from '../project/hooks';
import { runDesignPickFromClipboard } from '../design/designPickCommand';

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	// Нижняя панель по умолчанию; editor tab - по команде (без иконки в activity bar)
	const provider = new ChatViewProvider(context);
	setChatEditorHost(provider);
	setConfirmHost((options) => provider.requestConfirm(options));

	const webviewOpts = { webviewOptions: { retainContextWhenHidden: true } };

	const disposable = vscode.Disposable.from(
		ensureTerminalBufferListener(),
		{
			dispose: () => {
				void provider.getSession().flushPersist();
				setConfirmHost(undefined);
				setChatEditorHost(undefined);
			},
		},
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, webviewOpts),
		// CodeLens Keep/Undo по hunk'ам отключён: разрешение только на вызов tool / review до write
		vscode.commands.registerCommand('gen.openChat', () => focusChatView()),
		vscode.commands.registerCommand('gen.openChatPanel', () => focusChatView()),
		vscode.commands.registerCommand('gen.openChatEditor', () => {
			focusChatEditor();
		}),
		vscode.commands.registerCommand('gen.initProject', async () => {
			const folder = await enableProject();
			if (!folder) {
				void vscode.window.showWarningMessage(vscode.l10n.t('project.initNoWorkspace'));
				return;
			}

			void vscode.window.showInformationMessage(
				vscode.l10n.t('project.initDone', folder.name),
			);
		}),
		vscode.commands.registerCommand('gen.addSelectionToChat', async () => {
			await provider.getSession().addSelectionToChat();
		}),
		vscode.commands.registerCommand('gen.addToChat', async () => {
			await provider.getSession().addSelectionToChat();
		}),
		vscode.commands.registerCommand('gen.explainSelection', async () => {
			await provider.getSession().explainSelection();
		}),
		vscode.commands.registerCommand('gen.improveSelection', async () => {
			await provider.getSession().improveSelection();
		}),
		vscode.commands.registerCommand('gen.addTerminalToChat', async () => {
			await provider.getSession().addTerminalSelectionToChat();
		}),
		vscode.commands.registerCommand('gen.notebook.addCell', async () => {
			await provider.getSession().addNotebookCellToChat('add');
		}),
		vscode.commands.registerCommand('gen.notebook.explainCell', async () => {
			await provider.getSession().addNotebookCellToChat('explain');
		}),
		vscode.commands.registerCommand('gen.notebook.improveCell', async () => {
			await provider.getSession().addNotebookCellToChat('improve');
		}),
		vscode.commands.registerCommand('gen.notebook.generateCell', async () => {
			await provider.getSession().addNotebookCellToChat('generate');
		}),
		vscode.commands.registerCommand('gen.manageWorktrees', async () => {
			const items = await listAgentWorktrees();
			if (!items.length) {
				void vscode.window.showInformationMessage(vscode.l10n.t('chat.worktrees.empty'));
				return;
			}
			const picked = await vscode.window.showQuickPick(
				items.map((w) => ({
					label: w.slug || w.path,
					description: w.branch || '',
					detail: w.path,
					path: w.path,
				})),
				{
					title: vscode.l10n.t('chat.worktrees.title')
				},
			);
			if (!picked) {
				return;
			}
			const action = await vscode.window.showQuickPick(
				[
					{
						label: vscode.l10n.t('chat.worktrees.open'),
						id: 'open' as const
					},
					{
						label: vscode.l10n.t('chat.worktrees.remove'),
						id: 'remove' as const
					},
				],
				{ title: picked.label },
			);
			if (!action) {
				return;
			}

			if (action.id === 'open') {
				const uri = vscode.Uri.file(picked.path);
				await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
				return;
			}
			
			const ok = await removeAgentWorktree(picked.path);
			void vscode.window.showInformationMessage(
				ok ? vscode.l10n.t('chat.worktrees.removed') : vscode.l10n.t('chat.worktrees.removeFailed'),
			);
		}),
		vscode.commands.registerCommand('gen.design.pickFromClipboard', async () => {
			await runDesignPickFromClipboard((message) => provider.postToWebview(message));
		}),
		vscode.commands.registerCommand('gen.dryRunHook', async () => {
			const event = await vscode.window.showQuickPick(
				['beforeSubmit', 'beforeShell', 'session.diff', 'session.compacting', 'shell.env', 'file.watcher'] satisfies HookEvent[],
				{ title: vscode.l10n.t('hooks.dryRun.pickEvent') },
			) as HookEvent | undefined;
			if (!event) {
				return;
			}

			const subject = event === 'beforeSubmit' || event === 'beforeShell'
				? await vscode.window.showInputBox({
					title: vscode.l10n.t('hooks.dryRun.input'),
					prompt: event === 'beforeSubmit' ? 'GEN_HOOK_TEXT' : 'GEN_HOOK_COMMAND',
				})
				: '';
			if (subject === undefined) {
				return;
			}

			const env: Record<string, string> = event === 'beforeSubmit'
				? { GEN_HOOK_TEXT: subject }
				: event === 'beforeShell'
					? { GEN_HOOK_COMMAND: subject }
					: {};
			const result = await dryRunHookEvent(event, env);
			const details = [
				`event=${event}`,
				`exit=${String(result.exitCode ?? 0)}`,
				result.stdout ? `stdout:\n${result.stdout}` : '',
				result.stderr ? `stderr:\n${result.stderr}` : '',
			].filter(Boolean).join('\n\n');
			const doc = await vscode.workspace.openTextDocument({
				language: 'text',
				content: details,
			});
			
			await vscode.window.showTextDocument(doc, { preview: true });
		}),
	);

	return disposable;
}
