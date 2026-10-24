import type { ReactNode } from 'react';
import { t } from '../../i18n';
import type { SettingsPageId } from './pages';
import { settingsNavTitleKey, settingsPageIntroKey } from './pages';

interface SettingsPageHeaderProps {
	pageId: SettingsPageId;
	status?: ReactNode;
}

export function SettingsPageHeader({ pageId, status }: SettingsPageHeaderProps) {
	const intro = t(settingsPageIntroKey(pageId)).trim();
	return (
		<header className="settings-page-header">
			<h2 className="settings-page-header__title">{t(settingsNavTitleKey(pageId))}</h2>
			{intro ? <p className="settings-page-header__intro">{intro}</p> : null}
			{status ? <div className="settings-page-header__status" role="status">{status}</div> : null}
		</header>
	);
}
