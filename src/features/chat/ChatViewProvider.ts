import * as vscode from 'vscode';
import { createNonce, renderChatHtml } from './chatHtml';
import { suggestMentions } from './mentionSuggest';
import type { ChatProjectStatus, FromWebviewMessage, ToWebviewMessage } from './protocol';
import { ChatSession } from './ChatSession';
import { HttpLlmClient } from '../../core/llm/client';
import { getSettings, getAdminPolicySnapshot, isAdminPolicyActive, onSettingsChanged } from '../../core/config/settings';
import { getPersistedAlwaysAllow } from '../../core/stores/alwaysAllowStore';
import { loadWebviewL10n } from '../../l10n/loadBundle';
import { SettingsPanel } from './SettingsPanel';
import type { ConfirmDialogOptions } from '../../host/ui/confirmDialog';
import { isProjectEnabled } from '../project/config';
import { getIndexManager } from '../index/IndexManager';
import { buildDesignSessionMessage } from '../design/designSessionBridge';
import { handleDesignClick, type DesignClickResult } from '../design/designVisual';
import { CHAT_EDITOR_VIEW_TYPE } from './ids';
import { LlmHostRequests } from './llmHostHelpers';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	// Нижняя панель (WebviewView)
	private readonly views = new Set<vscode.WebviewView>();
	// Вкладки редактора (WebviewPanel) - полноэкранный чат
	private readonly editorPanels = new Set<vscode.WebviewPanel>();
	private readonly client = new HttpLlmClient();
	// loadModels / checkConnection (общий хелпер с SettingsPanel)
	private readonly llmHost = new LlmHostRequests(this.client, (message) => this.post(message));
	private readonly session: ChatSession;
	// Кэш isProjectEnabled (fs.access) - не на каждый emit
	private projectEnabledCached?: { folder: string; enabled: boolean };

	constructor(
		private readonly context: vscode.ExtensionContext,
		sharedSession?: ChatSession,
	) {
		this.session = sharedSession ?? new ChatSession(context, this.client);
		this.session.setWebviewPoster((message) => this.post(message));
		this.session.subscribe(() => {
			void this.postState();
		});
		onSettingsChanged(() => {
			this.invalidateProjectEnabledCache();
			void this.postState();
			void (async () => {
				const snap = getAdminPolicySnapshot();
				this.post({
					type: 'settings',
					settings: getSettings(),
					persistedAlwaysAllow: getPersistedAlwaysAllow(),
					adminPolicy: {
						active: isAdminPolicyActive(),
						path: snap.path,
						lockedKeys: [...snap.lockedKeys],
					},
				});
			})();
		});
		getIndexManager()?.onDidChange(() => {
			void this.postState();
		});
		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.invalidateProjectEnabledCache();
			}),
		);
	}

	private invalidateProjectEnabledCache(): void {
		this.projectEnabledCached = undefined;
	}

	getSession(): ChatSession {
		return this.session;
	}

	// Проброс host->webview (команды Design без CDP)
	postToWebview(message: ToWebviewMessage): void {
		this.post(message);
	}

	private notifyDesignClickResult(result: DesignClickResult): void {
		this.post({ type: 'designClickResult', result });
		this.post(buildDesignSessionMessage());
	}

	requestConfirm(options: ConfirmDialogOptions) {
		return this.session.requestConfirm({
			title: options.title,
			detail: options.detail,
			hint: vscode.l10n.t('confirm.panelHint'),
			variant: options.variant,
			applyLabel: options.applyLabel,
			rejectLabel: options.rejectLabel,
		});
	}

	addSelectionToChat(): Promise<void> {
		return this.session.addSelectionToChat();
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.views.add(webviewView);
		this.mountChatWebview(webviewView.webview);

		const messageSub = webviewView.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onWebviewMessage(msg);
		});

		webviewView.onDidDispose(() => {
			messageSub.dispose();
			this.views.delete(webviewView);
		});
	}

	// Открыть / показать чат как вкладку редактора (не узкий sidebar WebviewView)
	showEditorChat(): void {
		for (const panel of this.editorPanels) {
			panel.reveal(vscode.ViewColumn.Active, false);
			return;
		}

		const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
		const codiconsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'codicons');
		const panel = vscode.window.createWebviewPanel(
			CHAT_EDITOR_VIEW_TYPE,
			vscode.l10n.t('chat.editorTabTitle'),
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{
				enableScripts: true,
				enableFindWidget: true,
				retainContextWhenHidden: true,
				localResourceRoots: [assetsRoot, codiconsRoot],
			},
		);
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'logo.svg');
		this.editorPanels.add(panel);
		this.mountChatWebview(panel.webview);

		const messageSub = panel.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onWebviewMessage(msg);
		});

		panel.onDidDispose(() => {
			messageSub.dispose();
			this.editorPanels.delete(panel);
		});
	}

	private mountChatWebview(webview: vscode.Webview): void {
		const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
		const codiconsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'codicons');
		webview.options = {
			enableScripts: true,
			localResourceRoots: [assetsRoot, codiconsRoot],
		};

		const l10n = loadWebviewL10n(this.context.extensionUri);
		webview.html = renderChatHtml({
			cspSource: webview.cspSource,
			nonce: createNonce(),
			scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			codiconsStyleUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, 'codicon.css')),
			title: l10n.strings['chat.webviewTitle'],
			screen: 'chat',
			l10n,
		});
	}

	private post(message: ToWebviewMessage): void {
		for (const view of this.views) {
			void view.webview.postMessage(message);
		}

		for (const panel of this.editorPanels) {
			void panel.webview.postMessage(message);
		}
	}

	private async buildProjectStatus(): Promise<ChatProjectStatus> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.projectEnabledCached = undefined;
			return {
				hasWorkspace: false,
				enabled: false,
				indexing: false,
				ready: false,
			};
		}

		const folderKey = folder.uri.fsPath;
		let enabled: boolean;
		if (this.projectEnabledCached?.folder === folderKey) {
			enabled = this.projectEnabledCached.enabled;
		} else {
			enabled = await isProjectEnabled(folderKey);
			this.projectEnabledCached = { folder: folderKey, enabled };
		}
		const progress = getIndexManager()?.getProgress(folderKey);
		return {
			hasWorkspace: true,
			enabled,
			indexing: progress?.state === 'indexing',
			ready: progress?.state === 'ready',
			error: progress?.lastError,
			fileCount: progress?.fileCount,
			chunkCount: progress?.chunkCount,
		};
	}

	private async postState(): Promise<void> {
		const project = await this.buildProjectStatus();
		this.post({
			type: 'state',
			state: {
				...this.session.getState(),
				project,
			},
		});
	}

	private async onWebviewMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'gen.design.click': {
				const result = await handleDesignClick(msg);
				this.notifyDesignClickResult(result);
				if (!result.ok) {
					void vscode.window.showInformationMessage(result.message);
				}

				return;
			}
			case 'loadDesignSession':
				this.post(buildDesignSessionMessage());
				return;
			
			case 'ready':
				await this.postState();
				// Настройки нужны webview для loadModels(baseUrl) на экране чата
				{
					const snap = getAdminPolicySnapshot();
					this.post({
						type: 'settings',
						settings: getSettings(),
						persistedAlwaysAllow: getPersistedAlwaysAllow(),
						adminPolicy: {
							active: isAdminPolicyActive(),
							path: snap.path,
							lockedKeys: [...snap.lockedKeys],
						},
					});
				}
				return;
			case 'clear':
				this.session.clear();
				return;
			case 'cancel':
				this.session.cancel();
				return;
			case 'send':
				await this.session.send(msg.text, msg.images);
				return;
			case 'editMessage':
				await this.session.editMessage(msg.id, msg.content, {
					revertFiles: msg.revertFiles,
				});
				return;
			case 'reviewHunk':
				await this.session.reviewHunk(msg.toolCallId, msg.hunkId, msg.action);
				return;
			case 'reviewDiff':
				await this.session.reviewDiff(msg.toolCallId, msg.action);
				return;
			case 'mentionSuggest': {
				const items = await suggestMentions(msg.query);
				this.post({
					type: 'mentionSuggestions',
					requestId: msg.requestId,
					items,
				});
				return;
			}
			case 'resolveComposerUris': {
				const { resolveComposerAttachPaths } = await import('./resolveComposerAttach');
				const items = await resolveComposerAttachPaths(msg.uris ?? []);
				this.post({
					type: 'composerUrisResolved',
					requestId: msg.requestId,
					items,
				});
				return;
			}
			case 'setChatMode':
				await this.session.setMode(msg.mode);
				return;
			case 'setModel':
				this.session.setModel(msg.model);
				return;
			case 'loadModels':
				await this.llmHost.loadModels(msg.baseUrl, msg.requestId);
				return;
			case 'checkConnection':
				await this.llmHost.checkConnection(msg.baseUrl, msg.requestId);
				return;
			case 'openSettings':
				SettingsPanel.show(this.context);
				return;
			case 'confirmChoice':
				this.session.resolveConfirm(msg.id, msg.choice);
				return;
			case 'answerQuestion':
				this.session.answerQuestion(msg.id, msg.answer);
				return;
			case 'retryIndex': {
				const folder = vscode.workspace.workspaceFolders?.[0];
				if (folder) {
					await getIndexManager()?.enableAndIndex(folder);
				}
				await this.postState();
				return;
			}
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
			case 'newSession':
				this.session.createSession();
				return;
			case 'switchSession':
				this.session.switchSession(msg.id);
				return;
			case 'renameSession':
				this.session.renameSession(msg.id, msg.title);
				return;
			case 'setSessionFilter':
				this.session.setSessionFilter(msg.query);
				return;
			case 'deleteSession': {
				const deleteLabel = vscode.l10n.t('chat.session.delete');
				const choice = await vscode.window.showWarningMessage(
					vscode.l10n.t('chat.session.deleteConfirm'),
					{ modal: true },
					deleteLabel,
				);
				if (choice === deleteLabel) {
					this.session.deleteSession(msg.id);
				}
				return;
			}
			case 'forkSession':
				this.session.forkFromMessage(msg.messageId);
				return;
			case 'setComposerDraft':
				this.session.setComposerDraft(msg.text, msg.chips, msg.sessionId);
				return;
			case 'cancelToolCall':
				this.session.cancelToolCall(msg.id);
				return;
			case 'dismissPlanHandoff':
				this.session.dismissPlanHandoff();
				return;
			case 'restoreExportArchive':
				await this.session.restoreExportArchive();
				return;
			case 'openPath': {
				const path = String(msg.path ?? '').trim();
				if (!path) {
					return;
				}
				await this.session.openEditedPath(path);
				return;
			}
			case 'interruptResearchJob': {
				const id = (msg.id ?? msg.jobId ?? '').trim();
				if (id) {
					this.session.interruptResearchJob(id);
				}
				return;
			}
			case 'interruptAllResearch':
				this.session.interruptAllResearch();
				return;
			case 'resumeResearchJob': {
				const id = (msg.id ?? msg.jobId ?? '').trim();
				if (id) {
					this.session.resumeResearchJob(id);
				}
				return;
			}
			case 'openChildSession':
				this.session.openChildSession(msg.sessionId);
				return;
			case 'attachResearchTranscript': {
				const id = (msg.id ?? msg.jobId ?? '').trim();
				if (id) {
					this.session.attachResearchTranscript(id);
				}
				return;
			}
			case 'cleanupWorktree':
			case 'removeWorktree':
				await this.session.cleanupWorktree(msg.path);
				return;
			case 'cleanupAllFinishedWorktrees':
				await this.session.cleanupAllFinishedWorktrees();
				return;
			case 'openProjectReport': {
				const path = String(msg.path ?? '').trim();
				if (!path) {
					return;
				}
				await this.session.openEditedPath(path);
				return;
			}
		}
	}
}
