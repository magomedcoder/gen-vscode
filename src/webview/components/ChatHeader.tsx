import { useEffect, useRef } from 'react';
import type { TokenUsage } from '../../core/llm/usage';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	// Название активной сессии (LLM / rename / «Новый чат»)
	sessionTitle?: string;
	usage?: TokenUsage;
	maxContextTokens?: number;
	estimatedPromptTokens?: number;
	contextBudget?: number;
	cachedNCtx?: number;
	lastContextPrune?: { chars: number; messages: number };
	nearBudget?: boolean;
	nCtxWarn?: boolean;
	contextBreakdown?: {
		history: number;
		mentions: number;
		system: number;
		user: number;
	};
	mentionsTruncated?: boolean;
	models?: Array<{ id: string; label: string }>;
	model?: string;
	modelsLoading?: boolean;
	onLoadModels?: () => void;
}

export function ChatHeader({
	sessionTitle,
	usage,
	maxContextTokens,
	estimatedPromptTokens,
	contextBudget,
	cachedNCtx,
	lastContextPrune,
	nearBudget,
	nCtxWarn,
	contextBreakdown,
	mentionsTruncated,
	models,
	model,
	modelsLoading = false,
	onLoadModels,
}: ChatHeaderProps) {
	const modelList = models ?? [];
	const currentModel = model ?? '';
	const optsRef = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		onLoadModels?.();
	}, [onLoadModels]);

	const onModelChange = (next: string) => {
		if (!next || next === currentModel) {
			return;
		}

		vscodeApi.postMessage({ type: 'setModel', model: next });
		optsRef.current?.removeAttribute('open');
	};

	const modelInList = currentModel
		? modelList.some((item) => item.id === currentModel)
		: true;

	const modelSummary = currentModel
		? (modelList.find((item) => item.id === currentModel)?.label ?? currentModel)
		: t('chat.model.label');

	const title = sessionTitle?.trim() || t('chat.header.title');

	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title" title={title}>{title}</span>
			</div>
			<div className="header__actions">
				<TokenMeter
					usage={usage}
					maxContextTokens={maxContextTokens}
					estimatedPromptTokens={estimatedPromptTokens}
					contextBudget={contextBudget}
					cachedNCtx={cachedNCtx}
					lastContextPrune={lastContextPrune}
					nearBudget={nearBudget}
					nCtxWarn={nCtxWarn}
					contextBreakdown={contextBreakdown}
					mentionsTruncated={mentionsTruncated}
					compact
				/>
				<details ref={optsRef} className="header-opts">
					<summary className="btn btn--secondary header-opts__summary" title={t('chat.header.options')}>
						<span className="header-opts__summary-text">{modelSummary}</span>
						<span className="header-opts__chevron" aria-hidden="true">▾</span>
					</summary>
					<div className="header-opts__panel" onClick={(e) => e.stopPropagation()}>
						<label className="header-opts__row">
							<span className="header-opts__label">{t('chat.model.label')}</span>
							<select
								className="header-opts__select"
								value={currentModel}
								disabled={modelsLoading || modelList.length === 0}
								onChange={(e) => onModelChange(e.target.value)}
								aria-label={t('chat.model.aria')}
							>
								{!modelInList && currentModel ? (
									<option value={currentModel}>{currentModel}</option>
								) : null}
								{modelList.length === 0 ? (
									<option value="">{modelsLoading ? '...' : '-'}</option>
								) : (
									modelList.map((item) => (
										<option key={item.id} value={item.id}>{item.label}</option>
									))
								)}
							</select>
						</label>
					</div>
				</details>
			</div>
		</header>
	);
}
