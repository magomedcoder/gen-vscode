import type { PlanShellPolicy, RevealOnEdit, ShareMode, TabEvictionPolicy } from '../../../core/config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';
import { FieldNumber, FieldSelect, FieldText, FieldTextarea, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

export function AgentBehaviorPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<SettingsSection titleKey="settings.section.agent.loop" hintKey="settings.section.agent.loopHint">
				<FieldNumber
					labelKey="settings.agentMaxIterations.label"
					hintKey="settings.agentMaxIterations.hint"
					value={draft.agentMaxIterations}
					min={0}
					max={40}
					step={1}
					parse={parseNumberInput}
					onChange={(v) => setField('agentMaxIterations', v)}
				/>
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
				<FieldSelect
					labelKey="settings.tabEvictionPolicy.label"
					hintKey="settings.tabEvictionPolicy.hint"
					value={draft.tabEvictionPolicy}
					onChange={(v) => setField('tabEvictionPolicy', v as TabEvictionPolicy)}
				>
					<option value="closeOldestIdle">{t('settings.tabEvictionPolicy.closeOldestIdle')}</option>
					<option value="block">{t('settings.tabEvictionPolicy.block')}</option>
				</FieldSelect>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agent.plan" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.planWriteToFile.label"
					hintKey="settings.planWriteToFile.hint"
					checked={draft.planWriteToFile}
					onChange={(v) => setField('planWriteToFile', v)}
				/>
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

			<SettingsSection titleKey="settings.section.agent.edits" defaultOpen={false}>
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
				<FieldToggle
					labelKey="settings.gitSyncAutoKeep.label"
					hintKey="settings.gitSyncAutoKeep.hint"
					checked={draft.gitSyncAutoKeep}
					onChange={(v) => setField('gitSyncAutoKeep', v)}
				/>
				<FieldSelect
					labelKey="settings.revealOnEdit.label"
					hintKey="settings.revealOnEdit.hint"
					value={draft.revealOnEdit}
					onChange={(v) => setField('revealOnEdit', v as RevealOnEdit)}
					disabled={draft.backgroundEditMode}
				>
					<option value="never">{t('settings.revealOnEdit.never')}</option>
					<option value="preview">{t('settings.revealOnEdit.preview')}</option>
					<option value="focus">{t('settings.revealOnEdit.focus')}</option>
				</FieldSelect>
				<FieldToggle
					labelKey="settings.backgroundEditMode.label"
					hintKey="settings.backgroundEditMode.hint"
					checked={draft.backgroundEditMode}
					onChange={(v) => setField('backgroundEditMode', v)}
				/>
				<FieldToggle
					labelKey="settings.modelRoutedPatch.label"
					hintKey="settings.modelRoutedPatch.hint"
					checked={draft.modelRoutedPatch}
					onChange={(v) => setField('modelRoutedPatch', v)}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agent.context" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.alwaysOnWorkspaceContext.label"
					hintKey="settings.alwaysOnWorkspaceContext.hint"
					checked={draft.alwaysOnWorkspaceContext}
					onChange={(v) => setField('alwaysOnWorkspaceContext', v)}
				/>
				<FieldSelect
					labelKey="settings.shareMode.label"
					hintKey="settings.shareMode.hint"
					value={draft.shareMode}
					onChange={(v) => setField('shareMode', v as ShareMode)}
				>
					<option value="manual">{t('settings.shareMode.manual')}</option>
					<option value="auto">{t('settings.shareMode.auto')}</option>
					<option value="disabled">{t('settings.shareMode.disabled')}</option>
				</FieldSelect>
				<FieldTextarea
					labelKey="settings.primaryTools.label"
					hintKey="settings.primaryTools.hint"
					code
					rows={4}
					value={draft.primaryTools.join('\n')}
					onChange={(v) => setField('primaryTools', v.split(/\r?\n/))}
				/>
				<FieldTextarea
					labelKey="settings.skillsPaths.label"
					hintKey="settings.skillsPaths.hint"
					code
					rows={3}
					value={draft.skillsPaths.join('\n')}
					onChange={(v) => setField('skillsPaths', v.split(/\r?\n/))}
				/>
				<FieldTextarea
					labelKey="settings.skillsUrls.label"
					hintKey="settings.skillsUrls.hint"
					code
					rows={3}
					value={draft.skillsUrls.join('\n')}
					onChange={(v) => setField('skillsUrls', v.split(/\r?\n/))}
				/>
				<FieldTextarea
					labelKey="settings.instructionUrls.label"
					hintKey="settings.instructionUrls.hint"
					code
					rows={3}
					value={draft.instructionUrls.join('\n')}
					onChange={(v) => setField('instructionUrls', v.split(/\r?\n/))}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agent.worktrees" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.worktreesEnabled.label"
					hintKey="settings.worktreesEnabled.hint"
					checked={draft.worktreesEnabled}
					onChange={(v) => setField('worktreesEnabled', v)}
				/>
				<FieldText
					labelKey="settings.worktreeStartCommand.label"
					hintKey="settings.worktreeStartCommand.hint"
					value={draft.worktreeStartCommand}
					onChange={(v) => setField('worktreeStartCommand', v)}
					placeholder={t('settings.worktreeStartCommand.placeholder')}
					disabled={!draft.worktreesEnabled}
				/>
				<p className="field__hint">{t('settings.worktrees.manageHint')}</p>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.agent.compact" defaultOpen={false}>
				<FieldNumber
					labelKey="settings.compactTailTurns.label"
					hintKey="settings.compactTailTurns.hint"
					value={draft.compactTailTurns}
					min={1}
					max={40}
					step={1}
					parse={parseNumberInput}
					onChange={(v) => setField('compactTailTurns', v)}
				/>
				<FieldToggle
					labelKey="settings.compactPruneToolResults.label"
					hintKey="settings.compactPruneToolResults.hint"
					checked={draft.compactPruneToolResults}
					onChange={(v) => setField('compactPruneToolResults', v)}
				/>
				<FieldNumber
					labelKey="settings.compactReservedTokens.label"
					hintKey="settings.compactReservedTokens.hint"
					value={draft.compactReservedTokens}
					min={0}
					step={1000}
					parse={parseNumberInput}
					onChange={(v) => setField('compactReservedTokens', v)}
				/>
				<FieldToggle
					labelKey="settings.midLoopAutoCompact.label"
					hintKey="settings.midLoopAutoCompact.hint"
					checked={draft.midLoopAutoCompact}
					onChange={(v) => setField('midLoopAutoCompact', v)}
				/>
				<FieldToggle
					labelKey="settings.llmAutoCompact.label"
					hintKey="settings.llmAutoCompact.hint"
					checked={draft.llmAutoCompact}
					onChange={(v) => setField('llmAutoCompact', v)}
				/>
			</SettingsSection>
		</>
	);
}
