import type { LlmModelOption } from '../../../core/llm/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldText } from './SettingsFields';
import { SecretFieldBlock } from './SecretFieldBlock';
import { SettingsSection } from './SettingsSection';

interface ConnectionPageProps extends SettingsPageProps {
	apiKeySet: boolean;
	apiKeyDraft: string;
	clearApiKey?: boolean;
	models: LlmModelOption[];
	modelsStatus?: string;
	modelsLoading: boolean;
	connectionHealth?: { ok: boolean; message: string };
	connectionHealthLoading?: boolean;
	onApiKeyDraft: (value: string) => void;
	onClearApiKey?: () => void;
	onLoadModels: (baseUrl: string) => void;
	onCheckConnection?: (baseUrl: string) => void;
}

export function ConnectionPage({
	draft,
	setField,
	apiKeySet,
	apiKeyDraft,
	clearApiKey = false,
	models,
	modelsStatus,
	modelsLoading,
	connectionHealth,
	connectionHealthLoading = false,
	onApiKeyDraft,
	onClearApiKey,
	onLoadModels,
	onCheckConnection,
}: ConnectionPageProps) {
	const modelOptions = draft.model && !models.some((item) => item.id === draft.model)
		? [{ id: draft.model, label: draft.model }, ...models]
		: models;

	return (
		<>
			<SettingsSection titleKey="settings.section.connection.main" hintKey="settings.section.connection.mainHint" defaultOpen>
				<FieldText
					labelKey="settings.baseUrl.label"
					hintKey="settings.baseUrl.hint"
					value={draft.baseUrl}
					onChange={(v) => setField('baseUrl', v)}
					onBlur={() => {
						if (draft.baseUrl.trim()) {
							onLoadModels(draft.baseUrl);
						}
					}}
				/>

				<div className="field">
					<span className="field__label">{t('settings.connection.healthLabel')}</span>
					<span className="field__hint">{t('settings.connection.healthHint')}</span>
					<div className="field__row">
						<button
							className="btn btn--secondary"
							type="button"
							disabled={connectionHealthLoading || !draft.baseUrl.trim()}
							onClick={() => onCheckConnection?.(draft.baseUrl)}
						>
							{connectionHealthLoading
								? t('settings.connection.healthChecking')
								: t('settings.connection.healthButton')}
						</button>
					</div>
					{connectionHealth ? (
						<span
							className={
								connectionHealth.ok
									? 'field__hint field__hint--ok'
									: 'field__hint field__hint--error'
							}
							role="status"
						>
							{connectionHealth.message}
						</span>
					) : null}
				</div>

				<SecretFieldBlock
					labelKey="settings.apiKey.label"
					hintKey="settings.apiKey.hint"
					value={apiKeyDraft}
					keySet={apiKeySet}
					markedClear={clearApiKey}
					placeholder={
						clearApiKey
							? t('settings.apiKey.placeholderClear')
							: apiKeySet
								? t('settings.apiKey.placeholderSet')
								: ''
					}
					onChange={(v) => onApiKeyDraft(v)}
					onMarkClear={() => onClearApiKey?.()}
				/>
				<label className="field">
					<span className="field__label">{t('settings.model.label')}</span>
					<div className="field__row">
						<select
							className="field__input"
							value={draft.model}
							disabled={modelsLoading && modelOptions.length === 0}
							onChange={(e) => setField('model', e.target.value)}
						>
							{modelOptions.length === 0 ? (
								<option value="">{modelsLoading ? t('settings.model.loading') : t('settings.model.empty')}</option>
							) : (
								modelOptions.map((item) => (
									<option key={item.id} value={item.id} title={item.id}>
										{item.label}
									</option>
								))
							)}
						</select>
						<button
							className="btn btn--secondary"
							type="button"
							disabled={modelsLoading || !draft.baseUrl.trim()}
							onClick={() => onLoadModels(draft.baseUrl)}
						>
							{modelsLoading ? '...' : t('settings.model.refresh')}
						</button>
					</div>
					{modelsStatus ? <span className="field__hint">{modelsStatus}</span> : null}
				</label>

				<label className="field">
					<span className="field__label">{t('settings.planModel.label')}</span>
					<select
						className="field__input"
						value={draft.planModel}
						onChange={(e) => setField('planModel', e.target.value)}
					>
						<option value="">{t('settings.planModel.empty')}</option>
						{modelOptions.map((item) => (
							<option key={`plan-${item.id}`} value={item.id}>{item.label}</option>
						))}
					</select>
					<span className="field__hint">{t('settings.planModel.hint')}</span>
				</label>

				<label className="field">
					<span className="field__label">{t('settings.actModel.label')}</span>
					<select
						className="field__input"
						value={draft.actModel}
						onChange={(e) => setField('actModel', e.target.value)}
					>
						<option value="">{t('settings.actModel.empty')}</option>
						{modelOptions.map((item) => (
							<option key={`act-${item.id}`} value={item.id}>{item.label}</option>
						))}
					</select>
					<span className="field__hint">{t('settings.actModel.hint')}</span>
				</label>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.connection.auth" hintKey="settings.section.connection.authHint" defaultOpen={false}>
				<FieldText
					labelKey="settings.authHeader.label"
					value={draft.authHeader}
					onChange={(v) => setField('authHeader', v)}
				/>
				<FieldText
					labelKey="settings.authScheme.label"
					hintKey="settings.authScheme.hint"
					value={draft.authScheme}
					onChange={(v) => setField('authScheme', v)}
				/>
			</SettingsSection>
		</>
	);
}
