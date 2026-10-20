import { useEffect, useMemo, useState } from 'react';
import type { ModelUsage } from '../../../core/stores/usageStore';
import { t } from '../../i18n';
import { vscodeApi } from '../../vscodeApi';
import type { SettingsPageProps } from './pages';
import { SettingsSection } from './SettingsSection';

type UsageSort = 'lastUsed' | 'tokens' | 'requests';

function formatTs(ms: number): string {
	if (!ms) {
		return '-';
	}

	try {
		return new Date(ms).toLocaleString();
	} catch {
		return String(ms);
	}
}

function formatCount(n: number): string {
	try {
		return Math.max(0, Math.floor(n)).toLocaleString();
	} catch {
		return String(n);
	}
}

export function UsagePage(_props: SettingsPageProps) {
	const [ledger, setLedger] = useState<Record<string, ModelUsage>>({});
	const [sortBy, setSortBy] = useState<UsageSort>('lastUsed');

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data;
			if (data?.type === 'usageLedger' && data.ledger && typeof data.ledger === 'object') {
				setLedger(data.ledger as Record<string, ModelUsage>);
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'loadUsage' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const rows = useMemo(() => {
		const entries = Object.entries(ledger);
		entries.sort((a, b) => {
			const [idA, rowA] = a;
			const [idB, rowB] = b;
			if (sortBy === 'tokens') {
				const tokensA = (rowA.promptTokens || 0) + (rowA.completionTokens || 0);
				const tokensB = (rowB.promptTokens || 0) + (rowB.completionTokens || 0);
				return tokensB - tokensA || idA.localeCompare(idB);
			}

			if (sortBy === 'requests') {
				return (rowB.requests || 0) - (rowA.requests || 0) || idA.localeCompare(idB);
			}

			return (rowB.lastUsed || 0) - (rowA.lastUsed || 0) || idA.localeCompare(idB);
		});
		return entries;
	}, [ledger, sortBy]);

	const totals = useMemo(() => {
		let promptTokens = 0;
		let completionTokens = 0;
		let requests = 0;
		for (const row of Object.values(ledger)) {
			promptTokens += row.promptTokens || 0;
			completionTokens += row.completionTokens || 0;
			requests += row.requests || 0;
		}

		return {
			promptTokens,
			completionTokens,
			requests
		};
	}, [ledger]);

	return (
		<>
			<SettingsSection titleKey="settings.section.usage.ledger" hintKey="settings.usage.hint">
			{rows.length > 0 ? (
				<label className="field">
					<span className="field__label">{t('settings.usage.sort')}</span>
					<select
						className="field__input"
						value={sortBy}
						onChange={(e) => setSortBy(e.target.value as UsageSort)}
					>
						<option value="lastUsed">{t('settings.usage.sort.lastUsed')}</option>
						<option value="tokens">{t('settings.usage.sort.tokens')}</option>
						<option value="requests">{t('settings.usage.sort.requests')}</option>
					</select>
				</label>
			) : null}

			{rows.length === 0 ? (
				<span className="field__hint">{t('settings.usage.empty')}</span>
			) : (
				<table className="usage-table">
					<thead>
						<tr>
							<th>{t('settings.usage.model')}</th>
							<th>{t('settings.usage.prompt')}</th>
							<th>{t('settings.usage.completion')}</th>
							<th>{t('settings.usage.requests')}</th>
							<th>{t('settings.usage.lastUsed')}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(([model, row]) => (
							<tr key={model}>
								<td>{model}</td>
								<td>{formatCount(row.promptTokens)}</td>
								<td>{formatCount(row.completionTokens)}</td>
								<td>{formatCount(row.requests)}</td>
								<td>{formatTs(row.lastUsed)}</td>
							</tr>
						))}
						<tr className="usage-table__totals">
							<td>{t('settings.usage.totals')}</td>
							<td>{formatCount(totals.promptTokens)}</td>
							<td>{formatCount(totals.completionTokens)}</td>
							<td>{formatCount(totals.requests)}</td>
							<td>-</td>
						</tr>
					</tbody>
				</table>
			)}

			<div className="field__row" style={{ gap: 8 }}>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'loadUsage' })}
				>
					{t('settings.usage.refresh')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'resetUsage' })}
				>
					{t('settings.usage.reset')}
				</button>
			</div>
			</SettingsSection>
		</>
	);
}
