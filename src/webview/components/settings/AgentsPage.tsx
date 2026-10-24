import { useEffect } from 'react';
import type { AgentCustomInfo, AgentPresetInfo, ResearchJobUi } from '../../../features/chat/protocol';
import { t } from '../../i18n';
import { ResearchJobsPanel } from '../ResearchJobsPanel';
import { SettingsSection } from './SettingsSection';

export interface AgentsPageData {
	presets: AgentPresetInfo[];
	custom: AgentCustomInfo[];
	error?: string;
}

interface AgentsPageProps {
	agents?: AgentsPageData;
	agentsStatus?: string;
	onLoadAgents?: () => void;
	onCloneAgentPreset?: (id: string) => void;
	researchJobs?: ResearchJobUi[];
}

export function AgentsPage({
	agents,
	agentsStatus,
	onLoadAgents,
	onCloneAgentPreset,
	researchJobs,
}: AgentsPageProps) {
	useEffect(() => {
		onLoadAgents?.();
	}, [onLoadAgents]);

	const statusIsError = Boolean(agentsStatus && agentsStatus !== t('settings.agents.cloning') && !agentsStatus.startsWith(t('settings.agents.cloned', '').trimEnd()) && !agentsStatus.startsWith(t('settings.agents.updated', '').trimEnd()));
	const jobs = researchJobs ?? [];

	return (
		<>
			<SettingsSection titleKey="chat.research.teamsLive" hintKey="settings.section.agents.teamsHint">
				{jobs.length > 0 ? (
					<ResearchJobsPanel jobs={jobs} titleKey="chat.research.teamsLive" />
				) : (
					<span className="field__hint">{t('chat.research.empty')}</span>
				)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agents.presets" hintKey="settings.agents.pageHint">
			<span className="field__hint">{t('settings.agents.runtimeNote')}</span>

			{agents?.error ? (
				<span className="field__hint field__hint--error">{agents.error}</span>
			) : null}

			{agentsStatus ? (
				<span className={`field__hint${statusIsError ? ' field__hint--error' : ''}`}>
					{agentsStatus}
				</span>
			) : null}

			<div className="settings__actions">
				<button className="btn btn--secondary" type="button" onClick={() => onLoadAgents?.()}>
					{t('settings.agents.reload')}
				</button>
			</div>

			<span className="field__hint">{t('settings.agents.presets.hint')}</span>

			{(agents?.presets ?? []).length === 0 ? (
				<span className="field__hint">{t('settings.agents.presets.empty')}</span>
			) : (
				<div className="settings-list">
					{(agents?.presets ?? []).map((preset) => (
						<div key={preset.id} className="settings-card">
							<div className="settings-card__header">
								<div className="settings-card__title-row">
									<span className="settings-card__name">{preset.name}</span>
									{preset.readonly ? (
										<span className="settings-card__badge settings-card__badge--muted">
											{t('settings.agents.readonly')}
										</span>
									) : null}
									{preset.mode ? (
										<span className="settings-card__badge">{preset.mode}</span>
									) : null}
								</div>
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onCloneAgentPreset?.(preset.id)}
								>
									{t('settings.agents.clone')}
								</button>
							</div>
							<span className="settings-card__command">{preset.description}</span>
						</div>
					))}
				</div>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agents.custom" hintKey="settings.agents.custom.hint" defaultOpen={false}>
			{(agents?.custom ?? []).length === 0 ? (
				<span className="field__hint">{t('settings.agents.custom.empty')}</span>
			) : (
				<div className="settings-list">
					{(agents?.custom ?? []).map((agent) => (
						<div key={agent.id} className="settings-card">
							<div className="settings-card__header">
								<div className="settings-card__title-row">
									<span className="settings-card__name">{agent.name}</span>
									{agent.readonly ? (
										<span className="settings-card__badge settings-card__badge--muted">
											{t('settings.agents.readonly')}
										</span>
									) : null}
								</div>
							</div>
							<span className="settings-card__command">{agent.description}</span>
						</div>
					))}
				</div>
			)}
			</SettingsSection>
		</>
	);
}
