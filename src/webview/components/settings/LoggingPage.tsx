import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface LoggingPageProps extends SettingsPageProps {
	onOpenLogsFolder: () => void;
}

export function LoggingPage({ draft, setField, onOpenLogsFolder }: LoggingPageProps) {
	return (
		<>
			<SettingsSection titleKey="settings.section.logging.files" hintKey="settings.section.logging.filesHint">
				<FieldToggle
					labelKey="settings.loggingEnabled.label"
					hintKey="settings.loggingEnabled.hint"
					checked={draft.loggingEnabled}
					onChange={(v) => setField('loggingEnabled', v)}
				/>
				<div className="settings__actions">
					<button className="btn btn--secondary" type="button" onClick={onOpenLogsFolder}>
						{t('settings.openLogsFolder')}
					</button>
				</div>
			</SettingsSection>
		</>
	);
}
