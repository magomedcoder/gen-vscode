import { useEffect, useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import type { AdminPolicyInfo, DesignSessionPayload, IndexEngineStatus, PersonaOption, ResearchJobUi } from '../../features/chat/protocol';
import { UI_LAYER_EXCLUDED_KEYS } from '../../core/config/layerKeys';
import type { GenSettings } from '../../core/config/types';
import { DEFAULT_SETTINGS } from '../../core/config/types';
import type { LlmModelOption } from '../../core/llm/types';
import { t } from '../i18n';
import { AgentBehaviorPage } from './settings/AgentBehaviorPage';
import { AgentsPage, type AgentsPageData } from './settings/AgentsPage';
import { ChatPage } from './settings/ChatPage';
import { HooksPage, type HooksPageData } from './settings/HooksPage';
import { IndexingPage } from './settings/IndexingPage';
import { LoggingPage } from './settings/LoggingPage';
import { ModelsPage } from './settings/ModelsPage';
import { SETTINGS_PAGE_CODICON, SETTINGS_PAGE_IDS, settingsNavTitleKey } from './settings/pages';
import type { SettingsPageId } from './settings/pages';
import { PermissionsPage } from './settings/PermissionsPage';
import { PersonasPage } from './settings/PersonasPage';
import { ProvidersPage } from './settings/ProvidersPage';
import { RequestPage } from './settings/RequestPage';
import { RulesSkillsPage, type RulesSkillsPageData } from './settings/RulesSkillsPage';
import { SecurityPage } from './settings/SecurityPage';
import { SettingsPageHeader } from './settings/SettingsPageHeader';
import { SettingsSubNavProvider } from './settings/SettingsSubNav';
import { UsagePage } from './settings/UsagePage';

interface SettingsScreenProps {
	settings: GenSettings;
	personas?: PersonaOption[];
	adminPolicy?: AdminPolicyInfo;
	status?: string;
	persistedAlwaysAllow?: string[];
	models: LlmModelOption[];
	modelsStatus?: string;
	modelsLoading: boolean;
	connectionHealth?: {
		ok: boolean;
		message: string;
		capabilities?: { 
			contextLength?: number; 
			toolsHint?: string 
		};
	};
	connectionHealthLoading?: boolean;
	indexStatus?: IndexEngineStatus;
	designSession?: DesignSessionPayload | null;
	hooks?: HooksPageData;
	hooksStatus?: string;
	agents?: AgentsPageData;
	agentsStatus?: string;
	rulesSkills?: RulesSkillsPageData;
	onSave: (settings: GenSettings, extras?: {
		persistedAlwaysAllow?: string[];
	}) => void;
	onLoadModels: (baseUrl: string) => void;
	onCheckConnection?: (baseUrl: string) => void;
	onOpenLogsFolder: () => void;
	onLoadIndexStatus?: () => void;
	onLoadDesignSession?: () => void;
	onCancelIndex?: () => void;
	onRepairIndex?: () => void;
	onLoadHooks?: () => void;
	onSaveHooks?: (payload: {
		beforeSubmit: string[];
		beforeShell: string[];
		sessionDiff: string[];
		sessionCompacting: string[];
		shellEnv: string[];
		fileWatcher: string[];
	}) => void;
	onOpenHooksFile?: () => void;
	onDryRunHook?: (event: 'beforeSubmit' | 'beforeShell' | 'session.diff' | 'session.compacting' | 'shell.env' | 'file.watcher', sample?: string) => void;
	onLoadAgents?: () => void;
	onCloneAgentPreset?: (id: string) => void;
	onLoadRulesSkills?: () => void;
	onLoadPersonas?: () => void;
	onOpenProjectPath?: (path: string) => void;
	cachedNCtx?: number;
	researchJobs?: ResearchJobUi[];
}

function renderNavItems(
	pages: SettingsPageId[],
	active: SettingsPageId,
	onSelect: (id: SettingsPageId) => void,
): ReactNode {
	return pages.map((id) => (
		<button
			key={id}
			type="button"
			className={`settings-nav__item${id === active ? ' settings-nav__item--active' : ''}`}
			onClick={() => onSelect(id)}
		>
			<span
				className={`codicon codicon-${SETTINGS_PAGE_CODICON[id]} settings-nav__icon`}
				aria-hidden="true"
			/>
			<span className="settings-nav__title">{t(settingsNavTitleKey(id))}</span>
		</button>
	));
}

export function SettingsScreen({
	settings,
	personas = [],
	adminPolicy,
	persistedAlwaysAllow: persistedAlwaysAllowProp = [],
	status,
	models,
	modelsStatus,
	modelsLoading,
	connectionHealth,
	connectionHealthLoading = false,
	indexStatus,
	designSession,
	hooks,
	hooksStatus,
	agents,
	agentsStatus,
	rulesSkills,
	onSave,
	onLoadModels,
	onCheckConnection,
	onOpenLogsFolder,
	onLoadIndexStatus,
	onLoadDesignSession,
	onCancelIndex,
	onRepairIndex,
	onLoadHooks,
	onSaveHooks,
	onOpenHooksFile,
	onDryRunHook,
	onLoadAgents,
	onCloneAgentPreset,
	onLoadRulesSkills,
	onLoadPersonas,
	onOpenProjectPath,
	cachedNCtx,
	researchJobs,
}: SettingsScreenProps) {
	const [page, setPage] = useState<SettingsPageId>('providers');
	const [draft, setDraft] = useState<GenSettings>(settings);
	const [persistedAlwaysAllowDraft, setPersistedAlwaysAllowDraft] = useState<string[]>(persistedAlwaysAllowProp);

	const lockedKeySet = useMemo(
		() => new Set(adminPolicy?.active ? adminPolicy.lockedKeys : []),
		[adminPolicy],
	);

	useEffect(() => {
		setDraft({ ...settings });
		setPersistedAlwaysAllowDraft(persistedAlwaysAllowProp);
		if (settings.baseUrl.trim()) {
			onLoadModels(settings.baseUrl);
		} else {
			onLoadModels('');
		}
	}, [settings, persistedAlwaysAllowProp, onLoadModels]);

	useEffect(() => {
		if (models.length === 0) {
			return;
		}
		setDraft((prev) => {
			if (!prev.baseUrl.trim() || prev.model.trim()) {
				return prev;
			}

			return {
				...prev,
				model: models[0].id,
			};
		});
	}, [models]);

	const updateDraft = (fn: (prev: GenSettings) => GenSettings) => {
		setDraft((prev) => {
			const next = fn(prev);
			if (lockedKeySet.size === 0) {
				return next;
			}

			const out = { ...next };
			for (const key of lockedKeySet) {
				(out as Record<string, unknown>)[key] = prev[key as keyof GenSettings];
			}

			return out;
		});
	};

	const setField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => {
		if (lockedKeySet.has(key)) {
			return;
		}
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const onReset = () => {
		const next: GenSettings = { ...DEFAULT_SETTINGS };
		for (const key of lockedKeySet) {
			if (key in settings) {
				(next as unknown as Record<string, unknown>)[key] = settings[key as keyof GenSettings];
			}
		}
		
		for (const key of UI_LAYER_EXCLUDED_KEYS) {
			(next as unknown as Record<string, unknown>)[key] = structuredClone(settings[key]);
		}

		setDraft(next);
		onSave(next);
	};

	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSave({ ...draft }, {
			persistedAlwaysAllow: persistedAlwaysAllowDraft,
		});
	};

	const currentTitle = t(settingsNavTitleKey(page));
	const showAdminBanner = Boolean(adminPolicy?.active && adminPolicy.lockedKeys.length > 0);

	return (
		<div className="app">
			<header className="header">
				<div className="header__left">
					<span className="header__title">{t('settings.title')}</span>
					<span className="header__subtitle">{currentTitle}</span>
				</div>
				<button className="btn btn--secondary" type="button" onClick={onReset} title={t('settings.reset.hint')}>
					{t('settings.reset')}
				</button>
			</header>

			{showAdminBanner ? (
				<div className="project-banner project-banner--policy" role="status">
					<div className="project-banner__text">
						<strong className="project-banner__title">{t('settings.adminPolicy.title')}</strong>
						<span className="project-banner__hint">
							{t('settings.adminPolicy.hint', adminPolicy!.lockedKeys.join(', '))}
						</span>
						{adminPolicy?.path ? (
							<span className="project-banner__hint project-banner__hint--mono">{adminPolicy.path}</span>
						) : null}
					</div>
				</div>
			) : null}

			<form className="settings-layout" onSubmit={onSubmit}>
				<nav className="settings-nav" aria-label={t('settings.navAria')}>
					{renderNavItems(SETTINGS_PAGE_IDS, page, setPage)}
				</nav>

				<div className="settings-main">
					<div className="settings">
						<SettingsSubNavProvider key={page}>
						{page === 'providers' ? (
							<ProvidersPage
								draft={draft}
								setField={setField}
								connectionHealth={connectionHealth}
								connectionHealthLoading={connectionHealthLoading}
								onLoadModels={onLoadModels}
								onCheckConnection={onCheckConnection}
							/>
						) : null}
						{page === 'models' ? (
							<ModelsPage
								draft={draft}
								setField={setField}
								models={models}
								modelsStatus={modelsStatus}
								modelsLoading={modelsLoading}
								onLoadModels={onLoadModels}
							/>
						) : null}
						{page === 'request' ? (
							<RequestPage
								draft={draft}
								setField={setField}
								cachedNCtx={cachedNCtx}
							/>
						) : null}
						{page === 'chat' ? (
							<ChatPage
								draft={draft}
								setField={setField}
								updateDraft={updateDraft}
							/>
						) : null}
						{page === 'agent' ? (
							<AgentBehaviorPage draft={draft} setField={setField} updateDraft={updateDraft} />
						) : null}
						{page === 'security' ? (
							<SecurityPage
								draft={draft}
								setField={setField}
								designSession={designSession}
								onLoadDesignSession={onLoadDesignSession}
							/>
						) : null}
						{page === 'permissions' ? (
							<PermissionsPage
								draft={draft}
								setField={setField}
								persistedAlwaysAllow={persistedAlwaysAllowDraft}
								onPersistedAlwaysAllowChange={setPersistedAlwaysAllowDraft}
							/>
						) : null}
						{page === 'project' ? (
							<>
								<SettingsPageHeader pageId="project" />
								<IndexingPage
									draft={draft}
									setField={setField}
									indexStatus={indexStatus}
									onLoadIndexStatus={onLoadIndexStatus}
									onCancelIndex={onCancelIndex}
									onRepairIndex={onRepairIndex}
								/>
								<RulesSkillsPage
									data={rulesSkills}
									onLoad={onLoadRulesSkills}
									onOpenPath={onOpenProjectPath}
								/>
								<PersonasPage
									draft={draft}
									setField={setField}
									personas={personas}
									onLoadPersonas={onLoadPersonas}
									onOpenPath={onOpenProjectPath}
								/>
								<AgentsPage
									agents={agents}
									agentsStatus={agentsStatus}
									onLoadAgents={onLoadAgents}
									onCloneAgentPreset={onCloneAgentPreset}
									researchJobs={researchJobs}
								/>
								<HooksPage
									hooks={hooks}
									hooksStatus={hooksStatus}
									onLoadHooks={onLoadHooks}
									onSaveHooks={onSaveHooks}
									onOpenHooksFile={onOpenHooksFile}
									onDryRunHook={onDryRunHook}
								/>
							</>
						) : null}
						{page === 'journal' ? (
							<>
								<SettingsPageHeader pageId="journal" />
								<UsagePage draft={draft} setField={setField} />
								<LoggingPage
									draft={draft}
									setField={setField}
									onOpenLogsFolder={onOpenLogsFolder}
								/>
							</>
						) : null}
						</SettingsSubNavProvider>
					</div>

					<div className="settings-footer">
						{status ? <div className="settings__status">{status}</div> : null}
						<button className="btn" type="submit">{t('settings.save')}</button>
					</div>
				</div>
			</form>
		</div>
	);
}
