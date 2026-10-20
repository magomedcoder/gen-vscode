import * as path from 'node:path';
import * as vscode from 'vscode';
import { getEffectiveHooksPath } from '../../core/config/layers';
import { getSettings, isAdminPolicyActive, updateSettings, getAdminPolicySnapshot } from '../../core/config/settings';
import { getPersistedAlwaysAllow, setPersistedAlwaysAllow } from '../../core/stores/alwaysAllowStore';
import { collectIndexEngineStatus } from '../index/engineStatus';
import { getIndexManagerInstance } from '../index/IndexManager';
import { HttpLlmClient } from '../../core/llm/client';
import { loadWebviewL10n } from '../../l10n/loadBundle';
import { revealLogsFolder } from '../../core/log/logger';
import { discoverPersonas } from '../project/personas';
import { BUILTIN_PRESETS, cloneBuiltinPreset, discoverCustomAgents, getAgentDiscoveryDiagnostics } from '../project/customAgents';
import { listRulesCandidates, previewRulesMergeConflicts } from '../project/projectRules';
import { discoverSkills } from '../project/skills';
import { discoverLocalPlugins } from '../project/plugins';
import { dryRunHookEvent, type HookEvent } from '../project/hooks';
import { readUsage, resetUsage } from '../../core/stores/usageStore';
import { createNonce, renderChatHtml } from './chatHtml';
import { LlmHostRequests } from './llmHostHelpers';
import { buildDesignSessionMessage } from '../design/designSessionBridge';
import type { AdminPolicyInfo, FromWebviewMessage, PersonaOption, ToWebviewMessage } from './protocol';
const VIEW_TYPE = 'gen.settings';

export class SettingsPanel {
	private static current?: SettingsPanel;
	private readonly client = new HttpLlmClient();
	// loadModels / checkConnection (общий хелпер с ChatViewProvider)
	private readonly llmHost = new LlmHostRequests(this.client, (message) => this.post(message));
	private indexChangeSub?: vscode.Disposable;

	static show(context: vscode.ExtensionContext): void {
		if (SettingsPanel.current) {
			SettingsPanel.current.panel.reveal();
			return;
		}

		const assetsRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
		const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'codicons');
		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, vscode.l10n.t('settings.panelTitle'), vscode.ViewColumn.Active, {
			enableScripts: true,
			enableFindWidget: true,
			retainContextWhenHidden: true,
			localResourceRoots: [assetsRoot, codiconsRoot],
		});
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
		SettingsPanel.current = new SettingsPanel(panel, assetsRoot, context, codiconsRoot);
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		assetsRoot: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
		codiconsRoot: vscode.Uri,
	) {
		const l10n = loadWebviewL10n(this.context.extensionUri);
		this.panel.webview.html = renderChatHtml({
			cspSource: this.panel.webview.cspSource,
			nonce: createNonce(),
			scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			codiconsStyleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, 'codicon.css')),
			title: l10n.strings['settings.webviewTitle'],
			screen: 'settings',
			l10n,
		});

		const messageSub = this.panel.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onMessage(msg);
		});

		// Живой статус индексации, пока открыты Settings
		this.indexChangeSub = getIndexManagerInstance()?.onDidChange(() => {
			void this.postIndexStatus();
		});

		this.panel.onDidDispose(() => {
			messageSub.dispose();
			this.indexChangeSub?.dispose();
			this.indexChangeSub = undefined;
			this.llmHost.abort();
			if (SettingsPanel.current === this) {
				SettingsPanel.current = undefined;
			}
		});
	}

	private post(message: ToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private async listPersonaOptions(): Promise<PersonaOption[]> {
		try {
			const list = await discoverPersonas();
			return list.map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description,
				path: p.path || undefined,
				source: p.source,
			}));
		} catch {
			return [];
		}
	}

	// Отправить актуальный список персон в webview (Reload на странице Personas)
	private async postPersonasData(): Promise<void> {
		const personas = await this.listPersonaOptions();
		this.post({
			type: 'personasData',
			personas,
		});
	}

	private adminPolicyInfo(): AdminPolicyInfo {
		const snap = getAdminPolicySnapshot();
		return {
			active: isAdminPolicyActive(),
			path: snap.path,
			lockedKeys: [...snap.lockedKeys],
		};
	}

	private async postSettings(): Promise<void> {
		this.post({
			type: 'settings',
			settings: getSettings(),
			persistedAlwaysAllow: getPersistedAlwaysAllow(),
			personas: await this.listPersonaOptions(),
			adminPolicy: this.adminPolicyInfo(),
		});
		await this.postIndexStatus();
	}

	// Статус движка индекса (CPU/remote/...) для секции Indexing
	private async postIndexStatus(): Promise<void> {
		this.post({
			type: 'indexStatus',
			status: await collectIndexEngineStatus(),
		});
	}

	private async onMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.postSettings();
				return;
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
			case 'loadModels':
				await this.llmHost.loadModels(msg.baseUrl, msg.requestId);
				return;
			case 'checkConnection':
				await this.llmHost.checkConnection(msg.baseUrl, msg.requestId);
				return;
			case 'openLogsFolder':
				await revealLogsFolder();
				return;
			case 'loadUsage':
				this.post({
					type: 'usageLedger',
					ledger: readUsage(),
				});
				return;
			case 'resetUsage':
				resetUsage();
				this.post({
					type: 'usageLedger',
					ledger: readUsage(),
				});
				return;
			case 'loadIndexStatus':
				await this.postIndexStatus();
				return;
			case 'loadDesignSession':
				this.post(buildDesignSessionMessage());
				return;
			case 'cancelIndex':
				getIndexManagerInstance()?.cancelIndex();
				await this.postIndexStatus();
				return;
			case 'repairIndex':
				await getIndexManagerInstance()?.repairAndReindex();
				await this.postIndexStatus();
				return;
			case 'loadHooks':
				await this.postHooksData();
				return;
			case 'saveHooks':
				await this.handleSaveHooks(
					msg.beforeSubmit,
					msg.beforeShell,
					msg.sessionDiff,
					msg.sessionCompacting,
					msg.shellEnv,
					msg.fileWatcher,
				);
				return;
			case 'openHooksFile':
				await this.handleOpenHooksFile();
				return;
			case 'dryRunHook':
				await this.handleDryRunHook(msg.event, msg.sample);
				return;
			case 'loadAgents':
				await this.postAgentsData();
				return;
			case 'cloneAgentPreset':
				await this.handleCloneAgentPreset(msg.id);
				return;
			case 'loadRulesSkills':
				await this.postRulesSkillsData();
				return;
			case 'loadPersonas':
				await this.postPersonasData();
				return;
			case 'openProjectPath':
				await this.handleOpenProjectPath(msg.path);
				return;
			case 'saveSettings':
				try {
					if (Array.isArray(msg.persistedAlwaysAllow)) {
						await setPersistedAlwaysAllow(msg.persistedAlwaysAllow);
					}

					const saved = await updateSettings(msg.settings);
					this.post({
						type: 'settingsSaved',
						settings: saved,
						persistedAlwaysAllow: getPersistedAlwaysAllow(),
						personas: await this.listPersonaOptions(),
						adminPolicy: this.adminPolicyInfo(),
					});
					// После сохранения - обновить статус индекса в фоне
					void this.postIndexStatus();
				} catch (err) {
					this.post({
						type: 'settingsError',
						message: err instanceof Error ? err.message : String(err),
					});
				}
				return;
		}
	}

	private hooksFileUri(): vscode.Uri | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}

		const configured = getEffectiveHooksPath();
		if (configured) {
			if (path.isAbsolute(configured)) {
				return vscode.Uri.file(configured);
			}
			
			return vscode.Uri.joinPath(folder.uri, configured);
		}

		return vscode.Uri.joinPath(folder.uri, '.gen', 'hooks.json');
	}

	// Разобрать список команд из hooks.json (строки или { command })
	private asHookCommands(raw: unknown): string[] {
		if (!Array.isArray(raw)) {
			return [];
		}

		const out: string[] = [];
		for (const item of raw) {
			if (typeof item === 'string' && item.trim()) {
				out.push(item.trim());
				continue;
			}

			if (item && typeof item === 'object' && typeof (item as { command?: unknown }).command === 'string') {
				const command = String((item as { command: string }).command).trim();
				if (command) {
					out.push(command);
				}
			}
		}

		return out;
	}

	private async postHooksData(): Promise<void> {
		const uri = this.hooksFileUri();
		if (!uri) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		const path = uri.fsPath;
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = JSON.parse(new TextDecoder().decode(bytes)) as {
				hooks?: Record<string, unknown>;
				beforeSubmit?: unknown;
				beforeShell?: unknown;
			};
			const hooks = (raw.hooks ?? raw) as Record<string, unknown>;
			this.post({
				type: 'hooksData',
				beforeSubmit: this.asHookCommands(hooks.beforeSubmit),
				beforeShell: this.asHookCommands(hooks.beforeShell),
				sessionDiff: this.asHookCommands(hooks['session.diff']),
				sessionCompacting: this.asHookCommands(hooks['session.compacting']),
				shellEnv: this.asHookCommands(hooks['shell.env']),
				fileWatcher: this.asHookCommands(hooks['file.watcher']),
				path,
			});
		} catch (err) {
			const code = (err as { code?: string | number }).code;
			const name = (err as { name?: string }).name;
			// Файл отсутствует - пустые хуки, не ошибка
			if (code === 'FileNotFound' || code === 'ENOENT' || name === 'EntryNotFound') {
				this.post({
					type: 'hooksData',
					beforeSubmit: [],
					beforeShell: [],
					sessionDiff: [],
					sessionCompacting: [],
					shellEnv: [],
					fileWatcher: [],
					path,
				});
				return;
			}
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				path,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleSaveHooks(
		beforeSubmit: string[],
		beforeShell: string[],
		sessionDiff: string[],
		sessionCompacting: string[],
		shellEnv: string[],
		fileWatcher: string[],
	): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const uri = this.hooksFileUri();
		if (!folder || !uri) {
			this.post({
				type: 'hooksSaved',
				ok: false,
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		try {
			const genDir = vscode.Uri.joinPath(folder.uri, '.gen');
			try {
				await vscode.workspace.fs.createDirectory(genDir);
			} catch {}

			const toCommands = (list: string[]) => list.map((c) => c.trim())
				.filter(Boolean)
				.map((command) => ({ command }));

			const payload = {
				beforeSubmit: toCommands(beforeSubmit),
				beforeShell: toCommands(beforeShell),
				'session.diff': toCommands(sessionDiff),
				'session.compacting': toCommands(sessionCompacting),
				'shell.env': toCommands(shellEnv),
				'file.watcher': toCommands(fileWatcher),
			};
			const text = `${JSON.stringify(payload, null, 2)}\n`;
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
			this.post({ type: 'hooksSaved', ok: true });
			await this.postHooksData();
		} catch (err) {
			this.post({
				type: 'hooksSaved',
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleOpenHooksFile(): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const uri = this.hooksFileUri();
		if (!folder || !uri) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		try {
			const genDir = vscode.Uri.joinPath(folder.uri, '.gen');
			try {
				await vscode.workspace.fs.createDirectory(genDir);
			} catch {}

			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				const empty = `${JSON.stringify({
					beforeSubmit: [],
					beforeShell: [],
					'session.diff': [],
					'session.compacting': [],
					'shell.env': [],
					'file.watcher': [],
				}, null, 2)}\n`;
				await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(empty));
			}

			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: false });
		} catch (err) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				path: uri.fsPath,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleDryRunHook(event: HookEvent, sample?: string): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.post({
				type: 'hookDryRunResult',
				event,
				ok: false,
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		const subject = (sample ?? '').trim();
		const env: Record<string, string> = event === 'beforeSubmit'
			? { GEN_HOOK_TEXT: subject || 'dry-run sample text' }
			: event === 'beforeShell'
				? { GEN_HOOK_COMMAND: subject || 'echo dry-run' }
				: event === 'session.diff'
					? {
						GEN_HOOK_PATHS: subject || 'src/example.ts',
						GEN_HOOK_TURN_ID: 'dry-run-turn',
					}
					: event === 'file.watcher'
						? {
							GEN_HOOK_PATH: subject || '.gen/hooks.json',
							GEN_HOOK_FILE_EVENT: 'change',
						}
						: {};

		try {
			const result = await dryRunHookEvent(event, env);
			this.post({
				type: 'hookDryRunResult',
				event,
				ok: result.ok,
				exitCode: typeof result.exitCode === 'number' ? result.exitCode : undefined,
				stdout: result.stdout,
				stderr: result.stderr,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.post({
				type: 'hookDryRunResult',
				event,
				ok: false,
				error: message,
			});
		}
	}

	// Кандидаты правил и обнаруженные skills/plugins для UI только для чтения
	private async postRulesSkillsData(): Promise<void> {
		try {
			const [rules, skillsRaw, pluginsRaw, ruleConflicts] = await Promise.all([
				listRulesCandidates(),
				discoverSkills(),
				discoverLocalPlugins(),
				previewRulesMergeConflicts(),
			]);
			this.post({
				type: 'rulesSkillsData',
				rules,
				skills: skillsRaw.map((s) => ({
					name: s.name,
					description: s.description,
					path: s.path,
				})),
				plugins: pluginsRaw.map((p) => ({
					kind: p.kind,
					name: p.name,
					description: p.description,
					path: p.path,
				})),
				ruleConflicts,
			});
		} catch {
			this.post({
				type: 'rulesSkillsData',
				rules: [],
				skills: [],
				plugins: [],
				ruleConflicts: [],
			});
		}
	}

	// Открыть файл в редакторе (workspace-relative или абсолютный) / http(s) во внешнем браузере
	private async handleOpenProjectPath(rawPath: string): Promise<void> {
		const input = String(rawPath ?? '').trim();
		if (!input) {
			return;
		}

		if (/^https?:\/\//i.test(input)) {
			try {
				await vscode.env.openExternal(vscode.Uri.parse(input));
			} catch {}
			return;
		}

		try {
			const isAbsolute = input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input);
			let uri: vscode.Uri;
			if (isAbsolute) {
				uri = vscode.Uri.file(input);
			} else {
				const folder = vscode.workspace.workspaceFolders?.[0];
				if (!folder) {
					return;
				}
				uri = vscode.Uri.joinPath(folder.uri, ...input.split(/[/\\]+/).filter(Boolean));
			}

			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true });
		} catch {}
	}

	// Отправить список builtin presets и кастомных агентов из `.gen/agents/`
	private async postAgentsData(): Promise<void> {
		try {
			const custom = await discoverCustomAgents();
			const diagnostics = getAgentDiscoveryDiagnostics();
			this.post({
				type: 'agentsData',
				presets: BUILTIN_PRESETS.map((p) => ({
					id: p.id,
					name: p.name,
					description: p.description,
					readonly: p.readonly,
					mode: p.mode,
				})),
				custom: custom.map((a) => ({
					id: a.id,
					name: a.name,
					description: a.description,
					readonly: a.readonly,
				})),
				...(diagnostics.length > 0
					? { 
						error: diagnostics.map((item) => `${item.path}: ${item.message}`).join('\n') 
					}
					: {}),
			});
		} catch (err) {
			this.post({
				type: 'agentsData',
				presets: BUILTIN_PRESETS.map((p) => ({
					id: p.id,
					name: p.name,
					description: p.description,
					readonly: p.readonly,
					mode: p.mode,
				})),
				custom: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Клонировать builtin preset в `.gen/agents/` и открыть файл
	private async handleCloneAgentPreset(id: string): Promise<void> {
		try {
			const { relativePath, created } = await cloneBuiltinPreset(id);
			this.post({
				type: 'agentsCloned',
				relativePath,
				created,
			});
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (folder) {
				const uri = vscode.Uri.joinPath(folder.uri, relativePath);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
			await this.postAgentsData();
		} catch (err) {
			this.post({
				type: 'agentsCloned',
				relativePath: '',
				created: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
