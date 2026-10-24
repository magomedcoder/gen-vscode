import { normalizeBaseUrl } from '../../../core/llm/normalizeBaseUrl';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { SettingsBlock, SettingsCallout, SettingsPill, SettingsToolbar } from './SettingsChrome';
import { FieldText } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';

interface ProvidersPageProps extends SettingsPageProps {
	connectionHealth?: {
		ok: boolean;
		message: string;
		capabilities?: {
			contextLength?: number;
			toolsHint?: string
		};
	};
	connectionHealthLoading?: boolean;
	onLoadModels: (baseUrl: string) => void;
	onCheckConnection?: (baseUrl: string) => void;
}

export function ProvidersPage({
	draft,
	setField,
	connectionHealth,
	connectionHealthLoading = false,
	onLoadModels,
	onCheckConnection,
}: ProvidersPageProps) {
	const applyBaseUrl = (raw: string, load = false) => {
		const normalized = normalizeBaseUrl(raw);
		setField('baseUrl', normalized);
		if (load && normalized) {
			onLoadModels(normalized);
		}
	};

	const healthTone = !connectionHealth
		? 'neutral'
		: connectionHealth.ok
			? 'ok'
			: 'error';

	return (
		<>
			<SettingsPageHeader pageId="providers" />

			<SettingsBlock
				titleKey="settings.section.connection.server"
				hintKey="settings.section.connection.serverHint"
			>
				<FieldText
					labelKey="settings.baseUrl.label"
					value={draft.baseUrl}
					onChange={(v) => setField('baseUrl', v)}
					onBlur={() => applyBaseUrl(draft.baseUrl, true)}
				/>

				<SettingsCallout tone={healthTone}>
					<div className="settings-callout__row">
						<span className="settings-callout__label">{t('settings.connection.healthLabel')}</span>
						{connectionHealth ? (
							<SettingsPill tone={healthTone}>
								{connectionHealth.ok ? 'OK' : 'ERR'}
							</SettingsPill>
						) : (
							<SettingsPill>{t('settings.connection.healthIdle')}</SettingsPill>
						)}
					</div>
					{connectionHealth ? (
						<p className="settings-callout__text">{connectionHealth.message}</p>
					) : null}
					{connectionHealth?.capabilities?.contextLength ? (
						<p className="settings-callout__meta">
							{t('settings.connection.capabilitiesCtx', connectionHealth.capabilities.contextLength)}
						</p>
					) : null}
					<SettingsToolbar>
						<button
							className="btn btn--secondary"
							type="button"
							disabled={connectionHealthLoading || !draft.baseUrl.trim()}
							onClick={() => onCheckConnection?.(normalizeBaseUrl(draft.baseUrl))}
						>
							{connectionHealthLoading
								? t('settings.connection.healthChecking')
								: t('settings.connection.healthButton')}
						</button>
					</SettingsToolbar>
				</SettingsCallout>
			</SettingsBlock>
		</>
	);
}
