import { applyOpenAfterEdit, readOpenAfterEdit } from '../../../core/config/connections';
import type { OpenAfterEditMode } from '../../../core/config/connections';
import type { PlanShellPolicy, TabEvictionPolicy, VerifyAfterEdit } from '../../../core/config/types';
import { t } from '../../i18n';
import { JsonOnlyHint } from './JsonOnlyHint';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';
import { SettingsBlock, SettingsFieldGrid } from './SettingsChrome';
import { FieldNumber, FieldSelect, FieldToggle } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsSection } from './SettingsSection';

export function AgentBehaviorPage({ draft, setField, updateDraft }: SettingsPageProps) {
	const openAfterEdit = readOpenAfterEdit(draft);

	return (
		<>
			<SettingsPageHeader pageId="agent" />

			<SettingsBlock
				titleKey="settings.section.agent.loop"
				hintKey="settings.section.agent.loopHint"
			>
				<SettingsFieldGrid>
					<FieldNumber
						labelKey="settings.subagentDepth.label"
						hintKey="settings.subagentDepth.hint"
						value={draft.subagentDepth}
						min={1}
						max={4}
						step={1}
						parse={parseNumberInput}
						onChange={(v) => setField('subagentDepth', v)}
					/>
					<FieldNumber
						labelKey="settings.maxTabCount.label"
						hintKey="settings.maxTabCount.hint"
						value={draft.maxTabCount}
						min={1}
						max={40}
						step={1}
						parse={parseNumberInput}
						onChange={(v) => setField('maxTabCount', v)}
					/>
					<FieldNumber
						labelKey="settings.maxConcurrentRuns.label"
						hintKey="settings.maxConcurrentRuns.hint"
						value={draft.maxConcurrentRuns}
						min={1}
						max={10}
						step={1}
						parse={parseNumberInput}
						onChange={(v) => setField('maxConcurrentRuns', v)}
					/>
				</SettingsFieldGrid>
				<FieldSelect
					labelKey="settings.tabEvictionPolicy.label"
					hintKey="settings.tabEvictionPolicy.hint"
					value={draft.tabEvictionPolicy}
					onChange={(v) => setField('tabEvictionPolicy', v as TabEvictionPolicy)}
				>
					<option value="closeOldestIdle">{t('settings.tabEvictionPolicy.closeOldestIdle')}</option>
					<option value="block">{t('settings.tabEvictionPolicy.block')}</option>
				</FieldSelect>
			</SettingsBlock>

			<SettingsBlock
				titleKey="settings.section.agent.edits"
				hintKey="settings.section.agent.editsHint"
			>
				<label className="field">
					<span className="field__label">{t('settings.openAfterEdit.label')}</span>
					<select
						className="field__input"
						value={openAfterEdit}
						onChange={(e) => {
							const mode = e.target.value as OpenAfterEditMode;
							const patch = applyOpenAfterEdit(mode);
							if (updateDraft) {
								updateDraft((prev) => ({ ...prev, ...patch }));
								return;
							}
							setField('backgroundEditMode', patch.backgroundEditMode);
							setField('revealOnEdit', patch.revealOnEdit);
						}}
					>
						<option value="never">{t('settings.openAfterEdit.never')}</option>
						<option value="preview">{t('settings.openAfterEdit.preview')}</option>
						<option value="focus">{t('settings.openAfterEdit.focus')}</option>
					</select>
					<span className="field__hint">{t('settings.openAfterEdit.hint')}</span>
				</label>
				<div className="settings-toggle-stack">
					<FieldToggle
						labelKey="settings.snapshotEnabled.label"
						hintKey="settings.snapshotEnabled.hint"
						checked={draft.snapshotEnabled}
						onChange={(v) => setField('snapshotEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.formatAfterEdit.label"
						hintKey="settings.formatAfterEdit.hint"
						checked={draft.formatAfterEdit}
						onChange={(v) => setField('formatAfterEdit', v)}
					/>
				</div>
				<FieldSelect
					labelKey="settings.verifyAfterEdit.label"
					hintKey="settings.verifyAfterEdit.hint"
					value={draft.verifyAfterEdit}
					onChange={(v) => setField('verifyAfterEdit', v as VerifyAfterEdit)}
				>
					<option value="off">{t('settings.verifyAfterEdit.off')}</option>
					<option value="diagnostics">{t('settings.verifyAfterEdit.diagnostics')}</option>
					<option value="diagnostics_tests">{t('settings.verifyAfterEdit.diagnostics_tests')}</option>
					<option value="full">{t('settings.verifyAfterEdit.full')}</option>
				</FieldSelect>
				<JsonOnlyHint messageKey="settings.verifyGateCompletion.jsonOnlyHint" />
			</SettingsBlock>

			<SettingsSection
				titleKey="settings.section.agent.plan"
				hintKey="settings.section.agent.planHint"
				defaultOpen={false}
			>
				<FieldSelect
					labelKey="settings.planShellPolicy.label"
					hintKey="settings.planShellPolicy.hint"
					value={draft.planShellPolicy}
					onChange={(v) => setField('planShellPolicy', v as PlanShellPolicy)}
				>
					<option value="ask">{t('settings.planShellPolicy.ask')}</option>
					<option value="deny">{t('settings.planShellPolicy.deny')}</option>
				</FieldSelect>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.agent.worktrees"
				hintKey="settings.section.agent.worktreesHint"
				defaultOpen={false}
			>
				<FieldToggle
					labelKey="settings.worktreesEnabled.label"
					hintKey="settings.worktreesEnabled.hint"
					checked={draft.worktreesEnabled}
					onChange={(v) => setField('worktreesEnabled', v)}
				/>
				<p className="field__hint">{t('settings.worktrees.manageHint')}</p>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.agent.compact"
				hintKey="settings.section.agent.compactHint"
				defaultOpen={false}
			>
				<FieldToggle
					labelKey="settings.midLoopAutoCompact.label"
					hintKey="settings.midLoopAutoCompact.hint"
					checked={draft.midLoopAutoCompact}
					onChange={(v) => setField('midLoopAutoCompact', v)}
				/>
			</SettingsSection>

			<SettingsSection
				titleKey="settings.section.agent.advanced"
				hintKey="settings.section.agent.advancedHint"
				defaultOpen={false}
			>
				<JsonOnlyHint messageKey="settings.agent.jsonOnlyHint" />
			</SettingsSection>
		</>
	);
}
