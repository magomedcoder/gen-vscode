import { t } from '../../i18n';
import { JsonOnlyHint } from './JsonOnlyHint';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';
import { SettingsBlock, SettingsCallout, SettingsFieldGrid } from './SettingsChrome';
import { FieldNumber, FieldSelect, FieldText, FieldToggle } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsSection } from './SettingsSection';

interface RequestPageProps extends SettingsPageProps {
	cachedNCtx?: number;
}

export function RequestPage({
	draft,
	setField,
	cachedNCtx,
}: RequestPageProps) {
	const nCtxWarn = typeof cachedNCtx === 'number'
		&& cachedNCtx > 0
		&& draft.maxContextTokens > cachedNCtx;

	return (
		<>
			<SettingsPageHeader pageId="request" />

			<SettingsBlock
				titleKey="settings.section.request.context"
				hintKey="settings.section.request.contextHint"
			>
				<SettingsFieldGrid>
					<FieldNumber
						labelKey="settings.temperature.label"
						value={draft.temperature}
						min={0}
						max={2}
						step={0.1}
						parse={parseNumberInput}
						onChange={(v) => setField('temperature', v)}
					/>
					<FieldNumber
						labelKey="settings.maxTokens.label"
						value={draft.maxTokens}
						min={64}
						step={1}
						parse={parseNumberInput}
						onChange={(v) => setField('maxTokens', v)}
					/>
				</SettingsFieldGrid>
				<FieldNumber
					labelKey="settings.maxContextTokens.label"
					hintKey="settings.maxContextTokens.hint"
					value={draft.maxContextTokens}
					min={1024}
					step={1024}
					parse={parseNumberInput}
					onChange={(v) => setField('maxContextTokens', v)}
				/>
				{nCtxWarn ? (
					<SettingsCallout tone="warn">
						<p className="settings-callout__text">
							{t('settings.maxContextTokens.nCtxWarn', cachedNCtx!, draft.maxContextTokens)}
						</p>
					</SettingsCallout>
				) : (
					<p className="field__hint">{t('settings.maxContextTokens.nCtxRecommend')}</p>
				)}
				<FieldSelect
					labelKey="settings.contextOverflowPolicy.label"
					hintKey="settings.contextOverflowPolicy.hint"
					value={draft.contextOverflowPolicy}
					onChange={(v) => setField('contextOverflowPolicy', v as typeof draft.contextOverflowPolicy)}
				>
					<option value="auto_compact_retry">{t('settings.contextOverflowPolicy.auto')}</option>
					<option value="ask">{t('settings.contextOverflowPolicy.ask')}</option>
					<option value="fail_fast">{t('settings.contextOverflowPolicy.failFast')}</option>
				</FieldSelect>
			</SettingsBlock>

			<SettingsSection titleKey="settings.section.request.search" hintKey="settings.section.request.searchHint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.webSearchBackend.label"
					hintKey="settings.webSearchBackend.hint"
					value={draft.webSearchBackend}
					onChange={(v) => {
						const backend = v === 'exa' || v === 'parallel' || v === 'http' || v === 'duckduckgo'
							? v
							: 'duckduckgo';
						setField('webSearchBackend', backend);
					}}
				>
					<option value="duckduckgo">{t('settings.webSearchBackend.duckduckgo')}</option>
					<option value="exa">{t('settings.webSearchBackend.exa')}</option>
					<option value="parallel">{t('settings.webSearchBackend.parallel')}</option>
					<option value="http">{t('settings.webSearchBackend.http')}</option>
				</FieldSelect>

				{draft.webSearchBackend === 'http' ? (
					<>
						<FieldText
							labelKey="settings.webSearchHttpUrl.label"
							hintKey="settings.webSearchHttpUrl.hint"
							value={draft.webSearchHttpUrl}
							placeholder={t('settings.webSearchHttpUrl.placeholder')}
							onChange={(v) => setField('webSearchHttpUrl', v)}
						/>
						<FieldText
							labelKey="settings.webSearchHttpHeader.label"
							value={draft.webSearchHttpHeader}
							onChange={(v) => setField('webSearchHttpHeader', v)}
						/>
					</>
				) : null}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.request.images" hintKey="settings.section.request.imagesHint" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.visionEnabled.label"
					hintKey="settings.visionEnabled.hint"
					checked={draft.visionEnabled}
					onChange={(v) => setField('visionEnabled', v)}
				/>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.request.advanced"
				hintKey="settings.section.request.advancedHint"
				defaultOpen={false}
			>
				<JsonOnlyHint messageKey="settings.request.jsonOnlyHint" />
				<span className="field__hint">{t('settings.toolOutputMaxChars.jsonHint')}</span>
			</SettingsSection>
		</>
	);
}
