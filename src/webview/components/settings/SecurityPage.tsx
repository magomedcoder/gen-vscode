import { useEffect } from 'react';
import type { DesignSessionPayload } from '../../../features/chat/protocol';
import { t } from '../../i18n';
import { JsonOnlyHint } from './JsonOnlyHint';
import type { SettingsPageProps } from './pages';
import { SettingsBlock, SettingsCallout } from './SettingsChrome';
import { FieldToggle } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsSection } from './SettingsSection';

export interface SecurityPageProps extends SettingsPageProps {
	designSession?: DesignSessionPayload | null;
	onLoadDesignSession?: () => void;
}

function formatDesignSessionUpdatedAt(ms?: number): string | undefined {
	if (!ms || !Number.isFinite(ms) || ms <= 0) {
		return undefined;
	}

	try {
		return new Date(ms).toLocaleString();
	} catch {
		return undefined;
	}
}

function buildDesignSessionLine(session: DesignSessionPayload): string {
	const parts: string[] = [];
	if (session.path) {
		parts.push(session.line ? `${session.path}:${session.line}` : session.path);
	} else if (session.selector) {
		parts.push(session.selector);
	}

	if (session.url) {
		parts.push(session.url);
	}

	return parts.toString() || t('settings.designSession.emptyDetail');
}

export function SecurityPage({
	draft,
	setField,
	designSession,
	onLoadDesignSession,
}: SecurityPageProps) {
	useEffect(() => {
		onLoadDesignSession?.();
	}, [onLoadDesignSession]);

	return (
		<>
			<SettingsPageHeader pageId="security" />

			<SettingsBlock
				titleKey="settings.section.security.tools"
				hintKey="settings.section.security.toolsHint"
			>
				<div className="settings-toggle-stack">
					<FieldToggle
						labelKey="settings.enableFileReading.label"
						checked={draft.enableFileReading}
						onChange={(v) => setField('enableFileReading', v)}
					/>
					<FieldToggle
						labelKey="settings.enableTerminal.label"
						checked={draft.enableTerminal}
						onChange={(v) => setField('enableTerminal', v)}
					/>
					<FieldToggle
						labelKey="settings.webSearchEnabled.label"
						checked={draft.webSearchEnabled}
						onChange={(v) => setField('webSearchEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.webFetchEnabled.label"
						checked={draft.webFetchEnabled}
						onChange={(v) => setField('webFetchEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.designScreenshotEnabled.label"
						hintKey="settings.designScreenshotEnabled.hint"
						checked={draft.designScreenshotEnabled}
						onChange={(v) => setField('designScreenshotEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.browserComputerUseEnabled.label"
						hintKey="settings.browserComputerUseEnabled.hint"
						checked={draft.browserComputerUseEnabled}
						onChange={(v) => setField('browserComputerUseEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.inlineCompletionEnabled.label"
						hintKey="settings.inlineCompletionEnabled.hint"
						checked={draft.inlineCompletionEnabled}
						onChange={(v) => setField('inlineCompletionEnabled', v)}
					/>
				</div>
			</SettingsBlock>

			<SettingsBlock
				titleKey="settings.section.security.privacy"
				hintKey="settings.section.security.privacyHint"
			>
				<div className="settings-toggle-stack">
					<FieldToggle
						labelKey="settings.privacyMode.label"
						hintKey="settings.privacyMode.hint"
						checked={draft.privacyMode}
						onChange={(v) => setField('privacyMode', v)}
					/>
					<FieldToggle
						labelKey="settings.blockNonLocalUrls.label"
						hintKey="settings.blockNonLocalUrls.hint"
						checked={draft.blockNonLocalUrls}
						onChange={(v) => setField('blockNonLocalUrls', v)}
					/>
					<FieldToggle
						labelKey="settings.allowExternalDirectory.label"
						hintKey="settings.allowExternalDirectory.hint"
						checked={draft.allowExternalDirectory}
						onChange={(v) => setField('allowExternalDirectory', v)}
					/>
					<FieldToggle
						labelKey="settings.continueLoopOnDeny.label"
						hintKey="settings.continueLoopOnDeny.hint"
						checked={draft.continueLoopOnDeny}
						onChange={(v) => setField('continueLoopOnDeny', v)}
					/>
				</div>
			</SettingsBlock>

			<SettingsSection titleKey="settings.section.design" hintKey="settings.section.designHint" defaultOpen={false}>
				<SettingsCallout tone={designSession ? 'ok' : 'neutral'}>
					<p className="settings-callout__text">
						{designSession
							? buildDesignSessionLine(designSession)
							: t('settings.designSession.empty')}
					</p>
					<p className="settings-callout__meta">{t('settings.designSession.hint')}</p>
					{designSession?.selector && designSession.path ? (
						<p className="settings-callout__meta field__hint--mono">{designSession.selector}</p>
					) : null}
					{formatDesignSessionUpdatedAt(designSession?.updatedAt) ? (
						<p className="settings-callout__meta">
							{t('settings.designSession.updatedAt', formatDesignSessionUpdatedAt(designSession?.updatedAt)!)}
						</p>
					) : null}
				</SettingsCallout>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.security.advanced"
				hintKey="settings.section.security.advancedHint"
				defaultOpen={false}
			>
				<JsonOnlyHint messageKey="settings.security.jsonOnlyHint" />
			</SettingsSection>
		</>
	);
}
