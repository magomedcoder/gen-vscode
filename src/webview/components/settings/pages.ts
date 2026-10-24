import type { GenSettings } from '../../../core/config/types';

export type SettingsPageId =
	| 'providers'
	| 'models'
	| 'request'
	| 'chat'
	| 'agent'
	| 'security'
	| 'permissions'
	| 'project'
	| 'journal';

export type SetSettingsField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => void;

export interface SettingsPageProps {
	draft: GenSettings;
	setField: SetSettingsField;
	updateDraft?: (fn: (prev: GenSettings) => GenSettings) => void;
}

export const SETTINGS_PAGE_IDS: SettingsPageId[] = [
	'providers',
	'models',
	'request',
	'chat',
	'agent',
	'security',
	'permissions',
	'project',
	'journal',
];

export const SETTINGS_PAGE_CODICON: Record<SettingsPageId, string> = {
	providers: 'server-environment',
	models: 'symbol-misc',
	request: 'dashboard',
	chat: 'comment-discussion',
	agent: 'hubot',
	security: 'shield',
	permissions: 'lock',
	project: 'folder',
	journal: 'history',
};

export function settingsNavTitleKey(id: SettingsPageId): string {
	return `settings.nav.${id}`;
}

export function settingsPageIntroKey(id: SettingsPageId): string {
	return `settings.page.${id}.intro`;
}
