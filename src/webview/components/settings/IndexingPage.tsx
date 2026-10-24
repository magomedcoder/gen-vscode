import { useEffect, useState } from 'react';
import type { IndexEngineStatus } from '../../../features/chat/protocol';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { JsonOnlyHint } from './JsonOnlyHint';
import { SettingsBlock, SettingsCallout, SettingsToolbar } from './SettingsChrome';
import { FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface IndexingPageProps extends SettingsPageProps {
	indexStatus?: IndexEngineStatus;
	onLoadIndexStatus?: () => void;
	onCancelIndex?: () => void;
	onRepairIndex?: () => void;
}

function formatIndexUpdatedAt(iso?: string): string | undefined {
	if (!iso) {
		return undefined;
	}
	const ms = new Date(iso).getTime();
	if (!Number.isFinite(ms) || ms <= 0) {
		return undefined;
	}
	try {
		return new Date(ms).toLocaleString();
	} catch {
		return iso;
	}
}

function indexEngineModeLabel(mode: IndexEngineStatus['mode']): string {
	switch (mode) {
		case 'remote':
			return t('settings.indexEngine.remote');
		case 'local-vector':
			return t('settings.indexEngine.localVector');
		case 'cpu-trigram':
		default:
			return t('settings.indexEngine.cpuTrigram');
	}
}

function buildIndexEngineLine(status: IndexEngineStatus): string {
	const parts = [indexEngineModeLabel(status.mode)];

	if (!status.indexingEnabled) {
		parts.push(t('settings.indexEngine.disabled'));
	} else if (status.progressState === 'indexing') {
		parts.push(t('settings.indexEngine.indexing'));
	} else if (status.progressState === 'cancelled') {
		parts.push(t('settings.indexEngine.cancelled'));
	} else if (status.progressState === 'error' || status.corrupt || status.merkleMismatch) {
		parts.push(t('settings.indexEngine.error'));
	}

	if (typeof status.fileCount === 'number' && status.fileCount > 0) {
		parts.push(t('settings.indexEngine.files', status.fileCount));
	}

	const updated = formatIndexUpdatedAt(status.updatedAt);
	if (updated) {
		parts.push(t('settings.indexEngine.updated', updated));
	}

	return `${t('settings.indexEngine.label')}: ${parts.toString()}`;
}

const TREE_SITTER_LANGS_DISPLAY_MAX = 96;

function formatTreeSitterLangList(langs: string[]): string {
	const joined = langs.join(', ');
	if (joined.length <= TREE_SITTER_LANGS_DISPLAY_MAX) {
		return joined;
	}

	return `${joined.slice(0, TREE_SITTER_LANGS_DISPLAY_MAX - 1)}...`;
}

async function copyTreeSitterMissingLangs(langs: string[]): Promise<void> {
	await navigator.clipboard.writeText(langs.join('\n'));
}

function TreeSitterMissingWasmBlock({ langs }: { langs: string[] }) {
	const [copied, setCopied] = useState(false);

	return (
		<div className="field field-status field-status--treesitter-missing">
			<span className="field__label">
				{t('settings.indexEngine.treesitterMissingWasm', langs.join(', '))}
			</span>
			<pre
				className="field__hint"
				style={{ margin: '4px 0', whiteSpace: 'pre-wrap', userSelect: 'text', cursor: 'pointer' }}
				role="button"
				tabIndex={0}
				title={t('settings.indexEngine.treesitterMissingCopy')}
				onClick={() => {
					void copyTreeSitterMissingLangs(langs).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					});
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						void copyTreeSitterMissingLangs(langs).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						});
					}
				}}
			>
				{langs.join('\n')}
			</pre>
			<span className="field__hint">{t('settings.indexEngine.treesitterMissingHint')}</span>
			<div className="field__actions" style={{ marginTop: '4px' }}>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => {
						void copyTreeSitterMissingLangs(langs).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						});
					}}
				>
					{copied ? '✓' : t('settings.indexEngine.treesitterMissingCopy')}
				</button>
			</div>
		</div>
	);
}

function buildIndexExtrasLine(status: IndexEngineStatus): string | undefined {
	const bits: string[] = [];
	if (status.treeSitterAvailable) {
		const n = status.treeSitterGrammars?.length ?? 0;
		bits.push(t('settings.indexEngine.treesitterOn', n));
	} else {
		bits.push(t('settings.indexEngine.treesitterOff'));
	}

	if (status.treeSitterEnabledLangs && status.treeSitterEnabledLangs.length > 0) {
		bits.push(t('settings.indexEngine.treesitterLangs', formatTreeSitterLangList(status.treeSitterEnabledLangs)));
	}

	if (status.treeSitterMissingWasm && status.treeSitterMissingWasm.length > 0) {
		bits.push(
			t(
				'settings.indexEngine.treesitterMissingWasm',
				formatTreeSitterLangList(status.treeSitterMissingWasm),
			),
		);
	}

	if (typeof status.astChunkRatio === 'number') {
		bits.push(t('settings.indexEngine.astRatio', Math.round(status.astChunkRatio * 100)));
	}

	if (typeof status.merkleSkipPct === 'number') {
		bits.push(t('settings.indexEngine.merkleSkip', status.merkleSkipPct));
	}

	if (status.outlineBySource && Object.keys(status.outlineBySource).length > 0) {
		const parts = Object.entries(status.outlineBySource).map(([k, v]) => `${k}:${v}`).join(' ');
		bits.push(t('settings.indexEngine.outlineSources', parts));
	}

	if (status.indexStorageBackend) {
		bits.push(
			t(
				'settings.indexEngine.storage',
				status.indexStorageBackend + (status.sqliteAvailable ? '' : ` (${t('settings.indexEngine.sqliteUnavailable')})`),
			),
		);
	}

	if (typeof status.localVectorCount === 'number' && status.localVectorCount > 0) {
		bits.push(t('settings.indexEngine.vectors', status.localVectorCount));
	}

	if (
		typeof status.symbolIndexFail === 'number'
		|| typeof status.symbolIndexPartial === 'number'
		|| typeof status.symbolCount === 'number'
	) {
		const ok = status.symbolIndexOk ?? 0;
		const fail = status.symbolIndexFail ?? 0;
		const partial = status.symbolIndexPartial ?? 0;
		const n = status.symbolCount ?? 0;
		bits.push(t('settings.indexEngine.symbols', n, ok, fail, partial));
		if (status.symbolIndexLastError) {
			bits.push(status.symbolIndexLastError);
		}
	}

	return bits.length ? bits.toString() : undefined;
}

function showRepairButton(status: IndexEngineStatus): boolean {
	if (!status.indexingEnabled) {
		return false;
	}

	if (status.progressState === 'indexing') {
		return false;
	}

	return (
		status.progressState === 'error' ||
		status.progressState === 'cancelled' ||
		Boolean(status.corrupt) ||
		Boolean(status.missingDirDigests) ||
		Boolean(status.merkleMismatch) ||
		Boolean(status.partialErrors?.length) ||
		Boolean(status.lastError) ||
		(typeof status.symbolIndexFail === 'number' && status.symbolIndexFail > 0)
	);
}

export function IndexingPage({
	draft,
	setField,
	indexStatus,
	onLoadIndexStatus,
	onCancelIndex,
	onRepairIndex,
}: IndexingPageProps) {
	useEffect(() => {
		onLoadIndexStatus?.();
	}, [onLoadIndexStatus]);

	const statusTone = !indexStatus
		? 'neutral'
		: indexStatus.progressState === 'error' || indexStatus.corrupt
			? 'error'
			: indexStatus.progressState === 'indexing'
				? 'warn'
				: 'ok';

	return (
		<>
			<SettingsBlock
				titleKey="settings.section.indexing"
				hintKey="settings.section.indexingHint"
			>
				{indexStatus ? (
					<SettingsCallout tone={statusTone}>
						<p className="settings-callout__text">{buildIndexEngineLine(indexStatus)}</p>
						<p className="settings-callout__meta">{t('settings.indexEngine.hint')}</p>
						{buildIndexExtrasLine(indexStatus) ? (
							<p className="settings-callout__meta">{buildIndexExtrasLine(indexStatus)}</p>
						) : null}
						{indexStatus.lastError ? (
							<p className="settings-callout__meta field__hint--error">{indexStatus.lastError}</p>
						) : null}
						{indexStatus.partialErrors && indexStatus.partialErrors.length > 0 ? (
							<p className="settings-callout__meta field__hint--error">
								{indexStatus.partialErrors.slice(0, 5).join('\n')}
								{indexStatus.partialErrors.length > 5
									? `\n...+${indexStatus.partialErrors.length - 5}`
									: ''}
							</p>
						) : null}
						<SettingsToolbar>
							{indexStatus.progressState === 'indexing' ? (
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onCancelIndex?.()}
								>
									{t('settings.indexEngine.cancel')}
								</button>
							) : null}
							{showRepairButton(indexStatus) ? (
								<button
									className="btn btn--secondary"
									type="button"
									onClick={() => onRepairIndex?.()}
								>
									{t('settings.indexEngine.repair')}
								</button>
							) : null}
						</SettingsToolbar>
					</SettingsCallout>
				) : null}

				{indexStatus?.treeSitterMissingWasm && indexStatus.treeSitterMissingWasm.length > 0 ? (
					<TreeSitterMissingWasmBlock langs={indexStatus.treeSitterMissingWasm} />
				) : null}

				<div className="settings-toggle-stack">
					<FieldToggle
						labelKey="settings.indexingEnabled.label"
						hintKey="settings.indexingEnabled.hint"
						checked={draft.indexingEnabled}
						onChange={(v) => setField('indexingEnabled', v)}
					/>
					<FieldToggle
						labelKey="settings.indexNewFolders.label"
						hintKey="settings.indexNewFolders.hint"
						checked={draft.indexNewFolders}
						onChange={(v) => setField('indexNewFolders', v)}
					/>
					<FieldToggle
						labelKey="settings.indexForGrep.label"
						hintKey="settings.indexForGrep.hint"
						checked={draft.indexForGrep}
						onChange={(v) => setField('indexForGrep', v)}
					/>
				</div>
			</SettingsBlock>

			<SettingsSection
				titleKey="settings.section.indexing.advanced"
				hintKey="settings.section.indexing.advancedHint"
				defaultOpen={false}
			>
				<JsonOnlyHint messageKey="settings.indexing.jsonOnlyHint" />
			</SettingsSection>
		</>
	);
}
