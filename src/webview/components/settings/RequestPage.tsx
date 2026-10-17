import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';
import { FieldNumber, FieldSelect, FieldText, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface RequestPageProps extends SettingsPageProps {
	cachedNCtx?: number;
	webSearchApiKeySet?: boolean;
	webSearchApiKeyDraft?: string;
	clearWebSearchApiKey?: boolean;
	onWebSearchApiKeyDraft?: (value: string) => void;
	onClearWebSearchApiKey?: () => void;
}

export function RequestPage({
	draft,
	setField,
	cachedNCtx,
	webSearchApiKeySet = false,
	webSearchApiKeyDraft = '',
	clearWebSearchApiKey = false,
	onWebSearchApiKeyDraft,
	onClearWebSearchApiKey,
}: RequestPageProps) {
	const nCtxWarn = typeof cachedNCtx === 'number'
		&& cachedNCtx > 0
		&& draft.maxContextTokens > cachedNCtx;

	return (
		<>
			<SettingsSection titleKey="settings.section.request.model" hintKey="settings.section.request.modelHint">
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
					<p className="field__hint field__hint--warn" role="status">
						{t('settings.maxContextTokens.nCtxWarn', cachedNCtx!, draft.maxContextTokens)}
					</p>
				) : null}
				<p className="field__hint">{t('settings.maxContextTokens.nCtxRecommend')}</p>
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
				<FieldNumber
					labelKey="settings.maxInputChars.label"
					value={draft.maxInputChars}
					min={500}
					step={100}
					parse={parseNumberInput}
					onChange={(v) => setField('maxInputChars', v)}
				/>
				<FieldNumber
					labelKey="settings.toolOutputModelMaxChars.label"
					hintKey="settings.toolOutputModelMaxChars.hint"
					value={draft.toolOutputModelMaxChars}
					min={400}
					step={100}
					parse={parseNumberInput}
					onChange={(v) => setField('toolOutputModelMaxChars', v)}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.request.timeouts" hintKey="settings.section.request.timeoutsHint" defaultOpen={false}>
				<FieldNumber
					labelKey="settings.timeout.label"
					value={draft.requestTimeoutMs}
					min={1000}
					step={1000}
					parse={parseNumberInput}
					onChange={(v) => setField('requestTimeoutMs', v)}
				/>
				<FieldNumber
					labelKey="settings.defaultToolTimeoutMs.label"
					hintKey="settings.defaultToolTimeoutMs.hint"
					value={draft.defaultToolTimeoutMs}
					min={1000}
					step={1000}
					parse={parseNumberInput}
					onChange={(v) => setField('defaultToolTimeoutMs', v)}
				/>
				<FieldNumber
					labelKey="settings.maxToolTimeoutMs.label"
					hintKey="settings.maxToolTimeoutMs.hint"
					value={draft.maxToolTimeoutMs}
					min={1000}
					step={1000}
					parse={parseNumberInput}
					onChange={(v) => setField('maxToolTimeoutMs', v)}
				/>
			</SettingsSection>

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

				{draft.webSearchBackend === 'exa' || draft.webSearchBackend === 'parallel' || draft.webSearchBackend === 'http' ? (
					<div className="field">
						<FieldText
							labelKey="settings.webSearchApiKey.label"
							hintKey="settings.webSearchApiKey.hint"
							type="password"
							autoComplete="off"
							value={webSearchApiKeyDraft}
							placeholder={
								clearWebSearchApiKey
									? t('settings.apiKey.placeholderClear')
									: webSearchApiKeySet
										? t('settings.apiKey.placeholderSet')
										: ''
							}
							onChange={(v) => onWebSearchApiKeyDraft?.(v)}
						/>
						{(webSearchApiKeySet || clearWebSearchApiKey) ? (
							<div className="field__row" style={{ marginTop: 6 }}>
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onClearWebSearchApiKey?.()}
									disabled={clearWebSearchApiKey}
								>
									{clearWebSearchApiKey ? t('settings.secret.markedClear') : t('settings.secret.clear')}
								</button>
							</div>
						) : null}
					</div>
				) : null}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.request.images" hintKey="settings.section.request.imagesHint" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.visionEnabled.label"
					hintKey="settings.visionEnabled.hint"
					checked={draft.visionEnabled}
					onChange={(v) => setField('visionEnabled', v)}
				/>
				<FieldNumber
					labelKey="settings.attachmentImageMaxBase64.label"
					hintKey="settings.attachmentImageMaxBase64.hint"
					value={draft.attachmentImageMaxBase64}
					min={10000}
					step={10000}
					parse={parseNumberInput}
					onChange={(v) => setField('attachmentImageMaxBase64', v)}
				/>
				<FieldToggle
					labelKey="settings.attachmentImageAutoResize.label"
					hintKey="settings.attachmentImageAutoResize.hint"
					checked={draft.attachmentImageAutoResize}
					onChange={(v) => setField('attachmentImageAutoResize', v)}
				/>
				<FieldSelect
					labelKey="settings.attachmentImageQuality.label"
					hintKey="settings.attachmentImageQuality.hint"
					value={draft.attachmentImageQuality}
					onChange={(v) => setField('attachmentImageQuality', v as typeof draft.attachmentImageQuality)}
				>
					<option value="low">{t('settings.attachmentImageQuality.low')}</option>
					<option value="medium">{t('settings.attachmentImageQuality.medium')}</option>
					<option value="high">{t('settings.attachmentImageQuality.high')}</option>
				</FieldSelect>
				<FieldNumber
					labelKey="settings.pdfVisionMaxPages.label"
					hintKey="settings.pdfVisionMaxPages.hint"
					value={draft.pdfVisionMaxPages}
					min={1}
					max={6}
					step={1}
					parse={parseNumberInput}
					onChange={(v) => setField('pdfVisionMaxPages', v)}
				/>
				<FieldNumber
					labelKey="settings.attachmentImageMaxWidth.label"
					value={draft.attachmentImageMaxWidth}
					min={64}
					step={64}
					parse={parseNumberInput}
					onChange={(v) => setField('attachmentImageMaxWidth', v)}
				/>
				<FieldNumber
					labelKey="settings.attachmentImageMaxHeight.label"
					hintKey="settings.attachmentImageMaxHeight.hint"
					value={draft.attachmentImageMaxHeight}
					min={64}
					step={64}
					parse={parseNumberInput}
					onChange={(v) => setField('attachmentImageMaxHeight', v)}
				/>
			</SettingsSection>
		</>
	);
}
