import type { PersonaOption } from '../../../features/chat/protocol';
import { CHAT_MODE_DEFS } from '../../../features/chat/chatModes';
import type { ChatMode, CommentStyle, ThinkingDisplay } from '../../../core/config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldSelect, FieldTextarea, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface ChatPageProps extends SettingsPageProps {
	personas?: PersonaOption[];
	onOpenPersonasPage?: () => void;
}

export function ChatPage({
	draft,
	setField,
	personas = [],
	onOpenPersonasPage,
}: ChatPageProps) {
	const personaValue = draft.personaId && personas.some((p) => p.id === draft.personaId) ? draft.personaId : '';

	return (
		<>
			<span className="field__hint">{t('settings.chat.referencesHint')}</span>

			<SettingsSection titleKey="settings.section.chat.basics" hintKey="settings.section.chat.basicsHint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.chatMode.label"
					value={draft.chatMode}
					onChange={(v) => setField('chatMode', v as ChatMode)}
				>
					{CHAT_MODE_DEFS.map((def) => (
						<option key={def.id} value={def.id}>{t(def.labelKey)}</option>
					))}
				</FieldSelect>

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

				<FieldSelect
					labelKey="settings.personaId.label"
					hintKey="settings.personaId.hint"
					value={personaValue}
					onChange={(v) => setField('personaId', v)}
				>
					<option value="">{t('settings.personaId.none')}</option>
					{personas.map((p) => (
						<option key={p.id} value={p.id} title={p.description}>{p.name}</option>
					))}
				</FieldSelect>

				{onOpenPersonasPage ? (
					<div className="settings__actions">
						<button
							className="btn btn--secondary"
							type="button"
							onClick={() => onOpenPersonasPage()}
						>
							{t('settings.personaId.openPage')}
						</button>
					</div>
				) : null}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.chat.notify" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.notifyOnComplete.label"
					hintKey="settings.notifyOnComplete.hint"
					checked={draft.notifyOnComplete}
					onChange={(v) => setField('notifyOnComplete', v)}
				/>
				<FieldToggle
					labelKey="settings.notifySoundOnComplete.label"
					hintKey="settings.notifySoundOnComplete.hint"
					checked={draft.notifySoundOnComplete}
					onChange={(v) => setField('notifySoundOnComplete', v)}
					disabled={!draft.notifyOnComplete}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.comments" hintKey="settings.section.commentsHint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.commentStyle.label"
					value={draft.commentStyle}
					onChange={(v) => setField('commentStyle', v as CommentStyle)}
				>
					<option value="inline">{t('settings.commentStyle.inline')}</option>
					<option value="block">{t('settings.commentStyle.block')}</option>
				</FieldSelect>

				<FieldToggle
					labelKey="settings.previewBeforeApply.label"
					checked={draft.previewBeforeApply}
					onChange={(v) => setField('previewBeforeApply', v)}
				/>

				<FieldTextarea
					labelKey="settings.commentSystemPrompt.label"
					rows={4}
					placeholder={t('settings.commentSystemPrompt.placeholder')}
					value={draft.commentSystemPrompt}
					onChange={(v) => setField('commentSystemPrompt', v)}
					spellCheck
				/>
			</SettingsSection>
		</>
	);
}
