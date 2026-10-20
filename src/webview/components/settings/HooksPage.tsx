import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { SettingsSection } from './SettingsSection';

const EXAMPLE_BEFORE_SUBMIT = ['echo "beforeSubmit: $GEN_HOOK_TEXT"'];
const EXAMPLE_BEFORE_SHELL = ['echo "beforeShell: $GEN_HOOK_COMMAND"'];
const EXAMPLE_SESSION_DIFF = ['echo "session.diff: $GEN_HOOK_TURN_ID" && echo "$GEN_HOOK_PATHS"'];
const EXAMPLE_SESSION_COMPACTING = ['echo "session.compacting"'];
const EXAMPLE_SHELL_ENV = ['echo \'{"env":{"GEN_EXAMPLE":"1","GEN_HOOK_CWD_ECHO":"\'"$GEN_HOOK_CWD"\'"}}\''];
const EXAMPLE_FILE_WATCHER = ['echo "file.watcher: $GEN_HOOK_FILE_EVENT $GEN_HOOK_PATH"'];

const DRY_RUN_EVENTS = [
	'beforeSubmit',
	'beforeShell',
	'session.diff',
	'session.compacting',
	'shell.env',
	'file.watcher',
] as const;

type DryRunHookEvent = typeof DRY_RUN_EVENTS[number];

export interface HooksPageData {
	beforeSubmit: string[];
	beforeShell: string[];
	sessionDiff: string[];
	sessionCompacting: string[];
	shellEnv: string[];
	fileWatcher: string[];
	path?: string;
	error?: string;
}

export type HooksSavePayload = {
	beforeSubmit: string[];
	beforeShell: string[];
	sessionDiff: string[];
	sessionCompacting: string[];
	shellEnv: string[];
	fileWatcher: string[];
};

interface HooksPageProps {
	hooks?: HooksPageData;
	hooksStatus?: string;
	onLoadHooks?: () => void;
	onSaveHooks?: (payload: HooksSavePayload) => void;
	onOpenHooksFile?: () => void;
	onDryRunHook?: (event: DryRunHookEvent, sample?: string) => void;
}

function linesToList(raw: string): string[] {
	return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

function listToLines(list: string[]): string {
	return list.join('\n');
}

export function HooksPage({
	hooks,
	hooksStatus,
	onLoadHooks,
	onSaveHooks,
	onOpenHooksFile,
	onDryRunHook,
}: HooksPageProps) {
	const [dryRunEvent, setDryRunEvent] = useState<DryRunHookEvent>('beforeSubmit');
	const [dryRunSample, setDryRunSample] = useState('');
	const [beforeSubmitText, setBeforeSubmitText] = useState('');
	const [beforeShellText, setBeforeShellText] = useState('');
	const [sessionDiffText, setSessionDiffText] = useState('');
	const [sessionCompactingText, setSessionCompactingText] = useState('');
	const [shellEnvText, setShellEnvText] = useState('');
	const [fileWatcherText, setFileWatcherText] = useState('');

	useEffect(() => {
		onLoadHooks?.();
	}, [onLoadHooks]);

	useEffect(() => {
		if (!hooks) {
			return;
		}
		setBeforeSubmitText(listToLines(hooks.beforeSubmit));
		setBeforeShellText(listToLines(hooks.beforeShell));
		setSessionDiffText(listToLines(hooks.sessionDiff));
		setSessionCompactingText(listToLines(hooks.sessionCompacting));
		setShellEnvText(listToLines(hooks.shellEnv));
		setFileWatcherText(listToLines(hooks.fileWatcher));
	}, [hooks]);

	const onSave = () => {
		onSaveHooks?.({
			beforeSubmit: linesToList(beforeSubmitText),
			beforeShell: linesToList(beforeShellText),
			sessionDiff: linesToList(sessionDiffText),
			sessionCompacting: linesToList(sessionCompactingText),
			shellEnv: linesToList(shellEnvText),
			fileWatcher: linesToList(fileWatcherText),
		});
	};

	const onInsertExample = () => {
		setBeforeSubmitText(listToLines(EXAMPLE_BEFORE_SUBMIT));
		setBeforeShellText(listToLines(EXAMPLE_BEFORE_SHELL));
		setSessionDiffText(listToLines(EXAMPLE_SESSION_DIFF));
		setSessionCompactingText(listToLines(EXAMPLE_SESSION_COMPACTING));
		setShellEnvText(listToLines(EXAMPLE_SHELL_ENV));
		setFileWatcherText(listToLines(EXAMPLE_FILE_WATCHER));
	};

	const statusIsError = Boolean(
		hooksStatus
		&& hooksStatus !== t('settings.hooks.saved')
		&& hooksStatus !== t('settings.hooks.saving')
		&& hooksStatus !== t('settings.hooks.dryRunning')
		&& !hooksStatus.startsWith(t('settings.hooks.dryRunOkPrefix'))
		&& !hooksStatus.startsWith(t('settings.hooks.dryRunFailedPrefix')),
	);

	return (
		<>
			<SettingsSection titleKey="settings.section.hooks.actions" hintKey="settings.hooks.pageHint">
			{hooks?.path ? (<span className="field__hint">{t('settings.hooks.path', hooks.path)}</span>) : null}

			{hooks?.error ? (<span className="field__hint field__hint--error">{hooks.error}</span>) : null}

			{hooksStatus ? (<span className={`field__hint${statusIsError ? ' field__hint--error' : ''}`}>{hooksStatus}</span>) : null}

			<div className="settings__actions">
				<button className="btn" type="button" onClick={onSave}>
					{t('settings.hooks.save')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={() => onLoadHooks?.()}>
					{t('settings.hooks.reload')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={() => onOpenHooksFile?.()}>
					{t('settings.hooks.openFile')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={onInsertExample}>
					{t('settings.hooks.insertExample')}
				</button>
			</div>

			<div className="settings__actions" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
				<label className="field" style={{ flex: '1 1 200px', margin: 0 }}>
					<span className="field__label">{t('settings.hooks.dryRun.event')}</span>
					<select
						className="field__input"
						value={dryRunEvent}
						onChange={(e) => setDryRunEvent(e.target.value as DryRunHookEvent)}
					>
						{DRY_RUN_EVENTS.map((ev) => (
							<option key={ev} value={ev}>{ev}</option>
						))}
					</select>
				</label>
				{(dryRunEvent === 'beforeSubmit' || dryRunEvent === 'beforeShell' || dryRunEvent === 'session.diff' || dryRunEvent === 'file.watcher') ? (
					<label className="field" style={{ flex: '2 1 280px', margin: 0 }}>
						<span className="field__label">{t('settings.hooks.dryRun.sample')}</span>
						<input
							className="field__input"
							type="text"
							value={dryRunSample}
							spellCheck={false}
							placeholder={t('settings.hooks.dryRun.samplePlaceholder')}
							onChange={(e) => setDryRunSample(e.target.value)}
						/>
					</label>
				) : null}
				<button
					className="btn btn--secondary"
					type="button"
					style={{ alignSelf: 'flex-end' }}
					onClick={() => onDryRunHook?.(dryRunEvent, dryRunSample.trim() || undefined)}
				>
					{t('settings.hooks.dryRun')}
				</button>
			</div>
			<span className="field__hint">{t('settings.hooks.dryRunHint')}</span>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.hooks.commands" hintKey="settings.section.hooks.commandsHint" defaultOpen={false}>
			<label className="field">
				<span className="field__label">{t('settings.hooks.beforeSubmit.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={8}
					value={beforeSubmitText}
					placeholder={EXAMPLE_BEFORE_SUBMIT.join('\n')}
					spellCheck={false}
					onChange={(e) => setBeforeSubmitText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.beforeSubmit.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.beforeShell.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={8}
					value={beforeShellText}
					placeholder={EXAMPLE_BEFORE_SHELL.join('\n')}
					spellCheck={false}
					onChange={(e) => setBeforeShellText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.beforeShell.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.shellEnv.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={shellEnvText}
					placeholder={EXAMPLE_SHELL_ENV.join('\n')}
					spellCheck={false}
					onChange={(e) => setShellEnvText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.shellEnv.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.sessionDiff.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={sessionDiffText}
					placeholder={EXAMPLE_SESSION_DIFF.join('\n')}
					spellCheck={false}
					onChange={(e) => setSessionDiffText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.sessionDiff.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.sessionCompacting.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={sessionCompactingText}
					placeholder={EXAMPLE_SESSION_COMPACTING.join('\n')}
					spellCheck={false}
					onChange={(e) => setSessionCompactingText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.sessionCompacting.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.fileWatcher.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={fileWatcherText}
					placeholder={EXAMPLE_FILE_WATCHER.join('\n')}
					spellCheck={false}
					onChange={(e) => setFileWatcherText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.fileWatcher.hint')}</span>
			</label>
			</SettingsSection>
		</>
	);
}
