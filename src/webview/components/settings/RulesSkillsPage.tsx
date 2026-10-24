import { useEffect } from 'react';
import { t } from '../../i18n';
import { SettingsSection } from './SettingsSection';

export interface RulesSkillsRuleRow {
	label: string;
	path: string;
	exists: boolean;
}

export interface RulesSkillsSkillRow {
	name: string;
	description: string;
	path: string;
}

export interface RulesSkillsPluginRow {
	kind: 'tool' | 'plugin' | 'npm';
	name: string;
	description: string;
	path: string;
}

export interface RulesSkillsPageData {
	rules: RulesSkillsRuleRow[];
	skills: RulesSkillsSkillRow[];
	plugins: RulesSkillsPluginRow[];
	ruleConflicts: Array<{ heading: string; sources: string[] }>;
}

interface RulesSkillsPageProps {
	data?: RulesSkillsPageData;
	onLoad?: () => void;
	onOpenPath?: (path: string) => void;
}

function isHttpUrl(path: string): boolean {
	return /^https?:\/\//i.test(path);
}

export function RulesSkillsPage({ data, onLoad, onOpenPath }: RulesSkillsPageProps) {
	useEffect(() => {
		onLoad?.();
	}, [onLoad]);

	const rules = data?.rules ?? [];
	const skills = data?.skills ?? [];
	const plugins = data?.plugins ?? [];
	const ruleConflicts = data?.ruleConflicts ?? [];

	return (
		<>
			<div className="settings__actions" style={{ marginBottom: 8 }}>
				<button className="btn btn--secondary" type="button" onClick={() => onLoad?.()}>
					{t('settings.rulesSkills.reload')}
				</button>
			</div>
			<span className="field__hint">{t('settings.rulesSkills.pageHint')}</span>
			{ruleConflicts.length > 0 ? (
				<div className="settings-list" style={{ marginTop: 8 }}>
					{ruleConflicts.map((conflict) => (
						<div key={`${conflict.heading}:${conflict.sources.join(':')}`} className="settings-card">
							<span className="settings-card__name">{t('settings.rulesSkills.conflict', conflict.heading)}</span>
							<span className="settings-card__command">{conflict.sources.toString()}</span>
						</div>
					))}
				</div>
			) : null}

			<SettingsSection
				titleKey="settings.section.rulesSkills.rules"
				hintKey="settings.section.rulesSkills.rulesHint"
			>
			{rules.length === 0 ? (
				<span className="field__hint">{t('settings.rulesSkills.rulesEmpty')}</span>
			) : (
				<div className="settings-list">
					{rules.map((rule) => {
						const canOpen = rule.exists || isHttpUrl(rule.path);
						return (
							<div key={`${rule.label}:${rule.path}`} className="settings-card">
								<div className="settings-card__header">
									<div className="settings-card__title-row">
										<span className="settings-card__name">{rule.label}</span>
										<span className={`settings-card__badge${rule.exists ? ' settings-card__badge--ok' : ' settings-card__badge--muted'}`}>
											{rule.exists
												? t('settings.rulesSkills.existsYes')
												: t('settings.rulesSkills.existsNo')}
										</span>
									</div>
									{canOpen ? (
										<button
											className="btn btn--secondary"
											type="button"
											onClick={() => onOpenPath?.(rule.path)}
										>
											{t('settings.rulesSkills.open')}
										</button>
									) : null}
								</div>
								<span className="settings-card__command">{rule.path}</span>
							</div>
						);
					})}
				</div>
			)}
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.rulesSkills.skills"
				hintKey="settings.section.rulesSkills.skillsHint"
				defaultOpen={false}
			>
			{skills.length === 0 ? (<span className="field__hint">{t('settings.rulesSkills.skillsEmpty')}</span>) : (
				<div className="settings-list">
					{skills.map((skill) => (
						<div key={`${skill.name}:${skill.path}`} className="settings-card">
							<div className="settings-card__header">
								<div className="settings-card__title-row">
									<span className="settings-card__name">{skill.name}</span>
								</div>
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onOpenPath?.(skill.path)}
								>
									{t('settings.rulesSkills.open')}
								</button>
							</div>
							{skill.description ? (<span className="settings-card__tool-desc">{skill.description}</span>) : null}
							<span className="settings-card__command">{skill.path}</span>
						</div>
					))}
				</div>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.rulesSkills.plugins" hintKey="settings.rulesSkills.pluginsHint" defaultOpen={false}>
			{plugins.length === 0 ? (
				<span className="field__hint">{t('settings.rulesSkills.pluginsEmpty')}</span>
			) : (
				<div className="settings-list">
					{plugins.map((item) => (
						<div key={`${item.kind}:${item.name}:${item.path}`} className="settings-card">
							<div className="settings-card__header">
								<div className="settings-card__title-row">
									<span className="settings-card__name">{item.name}</span>
									<span className="settings-card__badge settings-card__badge--muted">
										{item.kind === 'tool'
											? t('settings.rulesSkills.kindTool')
											: t('settings.rulesSkills.kindPlugin')}
									</span>
								</div>
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onOpenPath?.(item.path)}
								>
									{t('settings.rulesSkills.open')}
								</button>
							</div>
							{item.description ? (
								<span className="settings-card__tool-desc">{item.description}</span>
							) : null}
							<span className="settings-card__command">{item.path}</span>
						</div>
					))}
				</div>
			)}
			</SettingsSection>
		</>
	);
}
