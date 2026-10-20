import { useEffect } from 'react';
import type { DesignSessionPayload } from '../../../features/chat/protocol';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldNumber, FieldText, FieldToggle } from './SettingsFields';
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
			<SettingsSection titleKey="settings.section.security.basics" hintKey="settings.section.security.basicsHint">
				<FieldToggle
					labelKey="settings.autoApprove.label"
					hintKey="settings.autoApprove.hint"
					checked={draft.autoApprove}
					onChange={(v) => setField('autoApprove', v)}
				/>
				<FieldToggle
					labelKey="settings.continueLoopOnDeny.label"
					hintKey="settings.continueLoopOnDeny.hint"
					checked={draft.continueLoopOnDeny}
					onChange={(v) => setField('continueLoopOnDeny', v)}
				/>
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
				<FieldNumber
					labelKey="settings.browserViewportWidth.label"
					value={draft.browserViewportWidth}
					min={320}
					onChange={(v) => setField('browserViewportWidth', v)}
					parse={(raw, fallback) => {
						const n = Number(raw);
						return Number.isFinite(n) ? Math.max(320, Math.floor(n)) : fallback;
					}}
				/>
				<FieldNumber
					labelKey="settings.browserViewportHeight.label"
					value={draft.browserViewportHeight}
					min={240}
					onChange={(v) => setField('browserViewportHeight', v)}
					parse={(raw, fallback) => {
						const n = Number(raw);
						return Number.isFinite(n) ? Math.max(240, Math.floor(n)) : fallback;
					}}
				/>
				<FieldText
					labelKey="settings.browserCdpEndpoint.label"
					hintKey="settings.browserCdpEndpoint.hint"
					value={draft.browserCdpEndpoint}
					onChange={(v) => setField('browserCdpEndpoint', v)}
				/>
				<FieldText
					labelKey="settings.browserChromePath.label"
					hintKey="settings.browserChromePath.hint"
					value={draft.browserChromePath}
					onChange={(v) => setField('browserChromePath', v)}
				/>
				<FieldToggle
					labelKey="settings.inlineCompletionEnabled.label"
					hintKey="settings.inlineCompletionEnabled.hint"
					checked={draft.inlineCompletionEnabled}
					onChange={(v) => setField('inlineCompletionEnabled', v)}
				/>
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
					labelKey="settings.enableWorkspaceContext.label"
					checked={draft.enableWorkspaceContext}
					onChange={(v) => setField('enableWorkspaceContext', v)}
				/>
				<FieldToggle
					labelKey="settings.allowExternalDirectory.label"
					hintKey="settings.allowExternalDirectory.hint"
					checked={draft.allowExternalDirectory}
					onChange={(v) => setField('allowExternalDirectory', v)}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.design" hintKey="settings.section.designHint">
				<div className="field field-status" role="status">
					<span className="field__label">
						{designSession
							? buildDesignSessionLine(designSession)
							: t('settings.designSession.empty')}
					</span>
					<span className="field__hint">{t('settings.designSession.hint')}</span>
					{designSession?.selector && designSession.path ? (
						<span className="field__hint field__hint--mono">{designSession.selector}</span>
					) : null}
					{formatDesignSessionUpdatedAt(designSession?.updatedAt) ? (
						<span className="field__hint">
							{t('settings.designSession.updatedAt', formatDesignSessionUpdatedAt(designSession?.updatedAt)!)}
						</span>
					) : null}
				</div>
			</SettingsSection>
		</>
	);
}
