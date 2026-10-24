import { normalizeBaseUrl } from '../../../core/llm/normalizeBaseUrl';
import type { LlmModelOption } from '../../../core/llm/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { SettingsBlock, SettingsCallout, SettingsPill, SettingsToolbar } from './SettingsChrome';
import { SettingsPageHeader } from './SettingsPageHeader';

interface ModelsPageProps extends SettingsPageProps {
	models: LlmModelOption[];
	modelsStatus?: string;
	modelsLoading: boolean;
	onLoadModels: (baseUrl: string) => void;
}

export function ModelsPage({
	draft,
	setField,
	models,
	modelsStatus,
	modelsLoading,
	onLoadModels,
}: ModelsPageProps) {
	const modelOptions = draft.model && !models.some((item) => item.id === draft.model)
		? [{ id: draft.model, label: draft.model }, ...models]
		: models;

	const needUrl = !draft.baseUrl.trim();
	const statusTone = needUrl ? 'warn' : modelsLoading ? 'neutral' : 'ok';

	return (
		<>
			<SettingsPageHeader pageId="models" />

			{needUrl || modelsStatus ? (
				<SettingsCallout tone={needUrl ? 'warn' : 'neutral'}>
					<div className="settings-callout__row">
						<span className="settings-callout__label">{t('settings.models.statusLabel')}</span>
						<SettingsPill tone={statusTone}>
							{needUrl
								? t('settings.models.needUrlShort')
								: modelsLoading
									? t('settings.model.loading')
									: `${modelOptions.length}`}
						</SettingsPill>
					</div>
					<p className="settings-callout__text">
						{needUrl ? t('settings.models.needUrl') : (modelsStatus || t('settings.models.readyHint'))}
					</p>
				</SettingsCallout>
			) : null}

			<SettingsBlock
				titleKey="settings.section.models.primary"
				hintKey="settings.section.models.primaryHint"
			>
				<label className="field">
					<span className="field__label">{t('settings.model.label')}</span>
					<div className="field__row">
						<select
							className="field__input field__input--lg"
							value={draft.model}
							disabled={modelsLoading && modelOptions.length === 0}
							onChange={(e) => setField('model', e.target.value)}
						>
							{modelOptions.length === 0 ? (
								<option value="">
									{modelsLoading ? t('settings.model.loading') : t('settings.model.empty')}
								</option>
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
							disabled={modelsLoading || needUrl}
							onClick={() => onLoadModels(normalizeBaseUrl(draft.baseUrl))}
						>
							{modelsLoading ? '...' : t('settings.model.refresh')}
						</button>
					</div>
				</label>
			</SettingsBlock>

			<SettingsBlock
				titleKey="settings.section.models.modes"
				hintKey="settings.section.models.modesHint"
			>
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

				<SettingsToolbar>
					<button
						className="btn btn--secondary"
						type="button"
						disabled={needUrl || !draft.model}
						onClick={() => {
							setField('planModel', '');
							setField('actModel', '');
						}}
					>
						{t('settings.models.clearModeOverrides')}
					</button>
				</SettingsToolbar>
			</SettingsBlock>
		</>
	);
}
