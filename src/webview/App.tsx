import { useCallback } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { ProjectSetupBanner } from './components/ProjectSetupBanner';
import { ResearchJobsPanel } from './components/ResearchJobsPanel';
import { SessionsRail } from './components/SessionsRail';
import { SettingsScreen } from './components/SettingsScreen';
import { TodoPanel } from './components/TodoPanel';
import { t } from './i18n';
import { useGenBridge } from './useGenBridge';
import { vscodeApi } from './vscodeApi';

export function App() {
	const {
		screen,
		chat,
		settings,
		personas,
		adminPolicy,
		persistedAlwaysAllow,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		connectionHealth,
		connectionHealthLoading,
		indexStatus,
		designSession,
		hooks,
		hooksStatus,
		agents,
		agentsStatus,
		rulesSkills,
		saveSettings,
		loadModels,
		checkConnection,
		openLogsFolder,
		loadIndexStatus,
		loadDesignSession,
		cancelIndex,
		repairIndex,
		loadHooks,
		saveHooks,
		openHooksFile,
		dryRunHook,
		loadAgents,
		cloneAgentPreset,
		loadRulesSkills,
		loadPersonas,
		openProjectPath,
	} = useGenBridge();

	// Подгрузить модели для компактного picker в шапке чата
	const handleLoadChatModels = useCallback(() => {
		const baseUrl = settings.baseUrl.trim();
		if (baseUrl) {
			loadModels(baseUrl);
		}
	}, [settings.baseUrl, loadModels]);

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				personas={personas}
				adminPolicy={adminPolicy}
				persistedAlwaysAllow={persistedAlwaysAllow}
				status={settingsStatus}
				models={models}
				modelsStatus={modelsStatus}
				modelsLoading={modelsLoading}
				connectionHealth={connectionHealth}
				connectionHealthLoading={connectionHealthLoading}
				indexStatus={indexStatus}
				designSession={designSession}
				hooks={hooks}
				hooksStatus={hooksStatus}
				agents={agents}
				agentsStatus={agentsStatus}
				rulesSkills={rulesSkills}
				onSave={saveSettings}
				onLoadModels={loadModels}
				onCheckConnection={checkConnection}
				onOpenLogsFolder={openLogsFolder}
				onLoadIndexStatus={loadIndexStatus}
				onLoadDesignSession={loadDesignSession}
				onCancelIndex={cancelIndex}
				onRepairIndex={repairIndex}
				onLoadHooks={loadHooks}
				onSaveHooks={saveHooks}
				onOpenHooksFile={openHooksFile}
				onDryRunHook={dryRunHook}
				onLoadAgents={loadAgents}
				onCloneAgentPreset={cloneAgentPreset}
				onLoadRulesSkills={loadRulesSkills}
				onLoadPersonas={loadPersonas}
				onOpenProjectPath={openProjectPath}
				cachedNCtx={chat.cachedNCtx}
				researchJobs={chat.researchJobs}
			/>
		);
	}

	const confirming = Boolean(chat.pendingConfirm) || Boolean(chat.pendingQuestion);
	const researchJobs = chat.researchJobs ?? [];
	const activeSessionTitle = chat.sessions?.find((s) => s.id === chat.sessionId)?.title
		?? chat.sessions?.[0]?.title;

	return (
		<div className="app">
			<div className="app-shell">
				<SessionsRail sessionId={chat.sessionId} sessions={chat.sessions} />
				<div className="app-main">
					<ChatHeader
						sessionTitle={activeSessionTitle}
						usage={chat.usage}
						maxContextTokens={chat.maxContextTokens}
						estimatedPromptTokens={chat.estimatedPromptTokens}
						contextBudget={chat.contextBudget}
						cachedNCtx={chat.cachedNCtx}
						lastContextPrune={chat.lastContextPrune}
						nearBudget={chat.nearBudget}
						nCtxWarn={chat.nCtxWarn}
						contextBreakdown={chat.contextBreakdown}
						mentionsTruncated={chat.mentionsTruncated}
						models={models}
						model={chat.model}
						modelsLoading={modelsLoading}
						onLoadModels={handleLoadChatModels}
					/>
					<ProjectSetupBanner project={chat.project} />
					{chat.hasExportArchive ? (
						<div className="pause-banner" role="status">
							<span className="pause-banner__text">{t('chat.restoreArchive.banner')}</span>
							<span className="pause-banner__actions">
								<button
									type="button"
									className="btn btn--secondary"
									onClick={() => vscodeApi.postMessage({ type: 'restoreExportArchive' })}
								>
									{t('chat.restoreArchive.action')}
								</button>
							</span>
						</div>
					) : null}
					{chat.nCtxWarn ? (
						<div className="pause-banner pause-banner--warn" role="status">
							<span className="pause-banner__text">{t('chat.tokens.nCtxWarnBanner')}</span>
						</div>
					) : null}
					{chat.nearBudget && !chat.nCtxWarn ? (
						<div className="pause-banner pause-banner--near" role="status">
							<span className="pause-banner__text">{t('chat.tokens.nearBudgetBanner')}</span>
							<span className="pause-banner__actions">
								<button
									type="button"
									className="btn btn--secondary"
									onClick={() => vscodeApi.postMessage({ type: 'send', text: '/compact' })}
								>
									{t('chat.contextOverflow.compactAction')}
								</button>
							</span>
						</div>
					) : null}
					{chat.todos && chat.todos.length > 0 ? <TodoPanel todos={chat.todos} /> : null}
					<MessageList
						key={chat.sessionId ?? 'none'}
						sessionId={chat.sessionId}
						messages={chat.messages}
						busy={chat.busy}
						busyDetail={chat.busy ? chat.busyDetail : undefined}
						detailsExpanded={settings.toolDetailsExpanded}
						thinkingDisplay={settings.thinkingDisplay}
						pendingConfirm={chat.pendingConfirm}
						pendingQuestion={chat.pendingQuestion}
					/>
					{(() => {
						const lastErr = [...chat.messages].reverse().find((m) => m.role === 'error');
						const overflowHint = lastErr?.content && /\/compact|context overflow|переполнен|prompt слишком большой|context budget/i.test(lastErr.content);
						if (!overflowHint || chat.busy) {
							return null;
						}
						return (
							<div className="pause-banner pause-banner--warn" role="status">
								<span className="pause-banner__text">{t('chat.contextOverflow.actionHint')}</span>
								<span className="pause-banner__actions">
									<button
										type="button"
										className="btn"
										onClick={() => vscodeApi.postMessage({ type: 'send', text: '/compact' })}
									>
										{t('chat.contextOverflow.compactAction')}
									</button>
								</span>
							</div>
						);
					})()}
					{chat.planHandoff ? (
						<div className="pause-banner" role="status">
							<span className="pause-banner__text">
								{chat.planHandoff.title
									? `${t('chat.planHandoff.title')}: ${chat.planHandoff.title}`
									: t('chat.planHandoff.title')}
							</span>
							<span className="pause-banner__actions">
								<button
									type="button"
									className="btn"
									onClick={() => vscodeApi.postMessage({ type: 'setChatMode', mode: 'agent' })}
								>
									{t('chat.planHandoff.run')}
								</button>
								<button
									type="button"
									className="btn btn--secondary"
									onClick={() => vscodeApi.postMessage({ type: 'dismissPlanHandoff' })}
								>
									{t('chat.planHandoff.dismiss')}
								</button>
							</span>
						</div>
					) : null}
					<div className="composer-dock">
						{researchJobs.length > 0 ? (
							<ResearchJobsPanel jobs={researchJobs} compact />
						) : null}
						<Composer
							key={chat.sessionId ?? 'none'}
							busy={chat.busy || confirming}
							queuedCount={chat.queuedCount ?? 0}
							mode={chat.mode}
							sessionId={chat.sessionId}
							composerDraft={chat.composerDraft}
							composerChips={chat.composerChips}
							customSlashCommands={chat.customSlashCommands}
							imageResize={{
								attachmentImageAutoResize: settings.attachmentImageAutoResize,
								attachmentImageMaxWidth: settings.attachmentImageMaxWidth,
								attachmentImageMaxHeight: settings.attachmentImageMaxHeight,
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
