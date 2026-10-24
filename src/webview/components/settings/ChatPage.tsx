import { applyWorkspaceContextScale, readWorkspaceContextScale } from '../../../core/config/connections';
import type { WorkspaceContextScale } from '../../../core/config/connections';
import { CHAT_MODE_DEFS } from '../../../features/chat/chatModes';
import type { ChatMode, ThinkingDisplay } from '../../../core/config/types';
import { t } from '../../i18n';
import { JsonOnlyHint } from './JsonOnlyHint';
import type { SettingsPageProps } from './pages';
import { SettingsBlock } from './SettingsChrome';
import { FieldSelect, FieldToggle } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsSection } from './SettingsSection';

export function ChatPage({
	draft,
	setField,
	updateDraft,
}: SettingsPageProps) {
	const contextScale = readWorkspaceContextScale(draft);

	return (
		<>
			<SettingsPageHeader pageId="chat" />

			<SettingsBlock
				titleKey="settings.section.chat.basics"
				hintKey="settings.section.chat.basicsHint"
			>
				<label className="field">
					<span className="field__label">{t('settings.chatMode.label')}</span>
					<select
						className="field__input field__input--lg"
						value={draft.chatMode}
						onChange={(e) => setField('chatMode', e.target.value as ChatMode)}
					>
						{CHAT_MODE_DEFS.map((def) => (
							<option key={def.id} value={def.id}>{t(def.labelKey)}</option>
						))}
					</select>
				</label>

				<FieldSelect
					labelKey="settings.thinkingDisplay.label"
					hintKey="settings.thinkingDisplay.hint"
					value={draft.thinkingDisplay}
					onChange={(v) => setField('thinkingDisplay', v as ThinkingDisplay)}
				>
					<option value="off">{t('settings.thinkingDisplay.off')}</option>
					<option value="collapsed">{t('settings.thinkingDisplay.collapsed')}</option>
					<option value="expanded">{t('settings.thinkingDisplay.expanded')}</option>
				</FieldSelect>

				<FieldToggle
					labelKey="settings.toolDetailsExpanded.label"
					hintKey="settings.toolDetailsExpanded.hint"
					checked={draft.toolDetailsExpanded}
					onChange={(v) => setField('toolDetailsExpanded', v)}
				/>
			</SettingsBlock>

			<SettingsBlock
				titleKey="settings.section.chat.context"
				hintKey="settings.section.chat.contextHint"
			>
				<label className="field">
					<span className="field__label">{t('settings.workspaceContextScale.label')}</span>
					<select
						className="field__input field__input--lg"
						value={contextScale}
						onChange={(e) => {
							const scale = e.target.value as WorkspaceContextScale;
							const patch = applyWorkspaceContextScale(draft, scale);
							if (updateDraft) {
								updateDraft((prev) => ({ ...prev, ...patch }));
								return;
							}
							setField('enableWorkspaceContext', patch.enableWorkspaceContext);
							setField('shareMode', patch.shareMode);
							setField('alwaysOnWorkspaceContext', patch.alwaysOnWorkspaceContext);
						}}
					>
						<option value="off">{t('settings.workspaceContextScale.off')}</option>
						<option value="manual">{t('settings.workspaceContextScale.manual')}</option>
						<option value="auto">{t('settings.workspaceContextScale.auto')}</option>
						<option value="full">{t('settings.workspaceContextScale.full')}</option>
					</select>
					<span className="field__hint">{t('settings.workspaceContextScale.hint')}</span>
				</label>
			</SettingsBlock>

			<SettingsSection
				titleKey="settings.section.chat.notify"
				hintKey="settings.section.chat.notifyHint"
				defaultOpen={false}
			>
				<FieldToggle
					labelKey="settings.notifyOnComplete.label"
					hintKey="settings.notifyOnComplete.hint"
					checked={draft.notifyOnComplete}
					onChange={(v) => setField('notifyOnComplete', v)}
				/>
				<span className="field__hint">{t('settings.notifySoundOnComplete.jsonHint')}</span>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.chat.advanced"
				hintKey="settings.section.chat.advancedHint"
				defaultOpen={false}
			>
				<JsonOnlyHint messageKey="settings.chat.referencesHint" />
			</SettingsSection>
		</>
	);
}
