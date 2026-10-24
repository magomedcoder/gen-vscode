import type { ApprovalActionType, ApprovalMode } from '../../../core/config/approvalTypes';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { SettingsBlock, SettingsToolbar } from './SettingsChrome';
import { FieldTextarea, FieldToggle } from './SettingsFields';
import { SettingsPageHeader } from './SettingsPageHeader';
import { SettingsSection } from './SettingsSection';

const APPROVAL_ACTIONS: ApprovalActionType[] = ['shell', 'edits', 'delete', 'web', 'outside', 'task', 'skill'];
const APPROVAL_MODES: ApprovalMode[] = ['allow', 'ask', 'review', 'deny'];

interface PermissionsPageProps extends SettingsPageProps {
	persistedAlwaysAllow?: string[];
	onPersistedAlwaysAllowChange?: (patterns: string[]) => void;
}

export function PermissionsPage({
	draft,
	setField,
	persistedAlwaysAllow = [],
	onPersistedAlwaysAllowChange,
}: PermissionsPageProps) {
	const setApprovalRule = (
		action: ApprovalActionType,
		patch: Partial<{
			mode: ApprovalMode
			allowlist: string[]
			denylist: string[]
		}>,
	) => {
		const prev = draft.approvalPolicy[action];
		setField('approvalPolicy', {
			...draft.approvalPolicy,
			[action]: {
				...prev,
				...patch,
			},
		});
	};

	return (
		<>
			<SettingsPageHeader pageId="permissions" />

			<SettingsBlock
				titleKey="settings.section.permissions.presets"
				hintKey="settings.section.permissions.presetsHint"
			>
				<FieldToggle
					labelKey="settings.autoApprove.label"
					hintKey="settings.autoApprove.hint"
					checked={draft.autoApprove}
					onChange={(v) => setField('autoApprove', v)}
				/>
				<p className="field__hint">{t('settings.section.permissions.presetsLead')}</p>
				<SettingsToolbar>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of APPROVAL_ACTIONS) {
								next[action] = { ...next[action], mode: 'ask' };
							}
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.askAll')}
					</button>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of ['edits', 'web', 'skill', 'task'] as ApprovalActionType[]) {
								next[action] = { ...next[action], mode: 'allow' };
							}
							next.shell = { ...next.shell, mode: 'ask' };
							next.delete = { ...next.delete, mode: 'ask' };
							next.outside = { ...next.outside, mode: 'ask' };
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.dev')}
					</button>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of APPROVAL_ACTIONS) {
								next[action] = { ...next[action], mode: action === 'delete' ? 'deny' : 'allow' };
							}
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.allowMost')}
					</button>
				</SettingsToolbar>
			</SettingsBlock>

			<SettingsSection titleKey="settings.section.permissions.always" hintKey="settings.section.permissions.alwaysHint" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.persistAlwaysAllow.label"
					hintKey="settings.persistAlwaysAllow.hint"
					checked={draft.persistAlwaysAllow}
					onChange={(v) => setField('persistAlwaysAllow', v)}
				/>
				<div className="field">
					<span className="field__label">{t('settings.persistedAlwaysAllow.label')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={4}
						value={persistedAlwaysAllow.join('\n')}
						spellCheck={false}
						disabled={!draft.persistAlwaysAllow}
						onChange={(e) => onPersistedAlwaysAllowChange?.(e.target.value.split(/\r?\n/))}
					/>
					<span className="field__hint">{t('settings.persistedAlwaysAllow.hint')}</span>
					{draft.persistAlwaysAllow && persistedAlwaysAllow.length > 0 ? (
						<SettingsToolbar>
							<button
								type="button"
								className="btn btn--secondary"
								onClick={() => onPersistedAlwaysAllowChange?.([])}
							>
								{t('settings.persistedAlwaysAllow.clear')}
							</button>
						</SettingsToolbar>
					) : null}
				</div>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.permissions.policy" hintKey="settings.section.permissions.policyHint" defaultOpen={false}>
				{APPROVAL_ACTIONS.map((action) => {
					const rule = draft.approvalPolicy[action];
					return (
						<div key={action} className="field-card">
							<span className="field-card__title">{t(`settings.approvalPolicy.action.${action}`)}</span>
							<label className="field">
								<span className="field__label">{t('settings.approvalPolicy.mode')}</span>
								<select
									className="field__input"
									value={rule.mode}
									onChange={(e) => setApprovalRule(action, { mode: e.target.value as ApprovalMode })}
								>
									{APPROVAL_MODES.map((mode) => (
										<option key={mode} value={mode}>{mode}</option>
									))}
								</select>
							</label>
							<FieldTextarea
								labelKey="settings.approvalPolicy.allowlist"
								rows={2}
								value={rule.allowlist.join('\n')}
								onChange={(v) => setApprovalRule(action, { allowlist: v.split(/\r?\n/) })}
							/>
							<FieldTextarea
								labelKey="settings.approvalPolicy.denylist"
								rows={2}
								value={rule.denylist.join('\n')}
								onChange={(v) => setApprovalRule(action, { denylist: v.split(/\r?\n/) })}
							/>
						</div>
					);
				})}
			</SettingsSection>
		</>
	);
}
