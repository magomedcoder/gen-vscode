import type { TokenUsage } from '../../core/llm/usage';
import { formatTokenCount } from '../../core/llm/usage';
import { t } from '../i18n';

interface TokenMeterProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	compact?: boolean;
	estimatedPromptTokens?: number;
	contextBudget?: number;
	cachedNCtx?: number;
	lastContextPrune?: {
		chars: number;
		messages: number;
	};
	nearBudget?: boolean;
	nCtxWarn?: boolean;
	contextBreakdown?: {
		history: number;
		mentions: number;
		system: number;
		user: number;
	};
	mentionsTruncated?: boolean;
}

export function TokenMeter({
	usage,
	maxContextTokens,
	compact,
	estimatedPromptTokens,
	contextBudget,
	cachedNCtx,
	lastContextPrune,
	nearBudget,
	nCtxWarn,
	contextBreakdown,
	mentionsTruncated,
}: TokenMeterProps) {
	const hasUsage = Boolean(usage && usage.totalTokens > 0);
	const limit = (typeof contextBudget === 'number' && contextBudget > 0)
		? contextBudget
		: (maxContextTokens && maxContextTokens > 0 ? maxContextTokens : undefined);

	// Для шапки важнее размер текущего запроса, а не сумма usage за всю сессию
	const occupied = (typeof estimatedPromptTokens === 'number' && estimatedPromptTokens > 0)
		? estimatedPromptTokens
		: (usage?.totalTokens ?? 0);

	const hasMeter = Boolean(limit && occupied > 0)
		|| Boolean(limit && hasUsage)
		|| (typeof estimatedPromptTokens === 'number' && estimatedPromptTokens > 0)
		|| Boolean(limit);

	if (!hasUsage && !hasMeter) {
		return null;
	}

	const pct = limit && occupied > 0
		? Math.min(100, Math.round((occupied / limit) * 100))
		: (limit ? 0 : undefined);

	const tooltipLines: string[] = [];
	if (occupied > 0) {
		tooltipLines.push(t('chat.tokens.filledHint', formatTokenCount(occupied)));
	}
	
	if (limit) {
		tooltipLines.push(t('chat.tokens.limitHint', formatTokenCount(limit)));
	}

	if (typeof cachedNCtx === 'number' && cachedNCtx > 0) {
		tooltipLines.push(t('chat.tokens.serverWindowHint', formatTokenCount(cachedNCtx)));
	}

	if (contextBreakdown) {
		tooltipLines.push(
			t(
				'chat.tokens.breakdownHint',
				formatTokenCount(contextBreakdown.history),
				formatTokenCount(contextBreakdown.mentions),
				formatTokenCount(contextBreakdown.user),
			),
		);
	}

	if (lastContextPrune && (lastContextPrune.chars > 0 || lastContextPrune.messages > 0)) {
		tooltipLines.push(t('chat.tokens.prunedHint', lastContextPrune.messages));
	}
	if (nCtxWarn) {
		tooltipLines.push(t('chat.tokens.nCtxWarn'));
	}

	if (mentionsTruncated) {
		tooltipLines.push(t('chat.tokens.mentionsTruncated'));
	}
	
	if (nearBudget) {
		tooltipLines.push(t('chat.tokens.nearBudget'));
	}

	const tooltip = tooltipLines.join('\n');

	if (compact) {
		const label = limit
			? t(
				'chat.tokens.context',
				formatTokenCount(occupied),
				formatTokenCount(limit),
				pct ?? 0,
			)
			: occupied > 0
				? t('chat.tokens.compact', formatTokenCount(occupied))
				: null;

		if (!label) {
			return null;
		}

		return (
			<span className={`token-meter-wrap${nearBudget ? ' token-meter-wrap--near' : ''}${nCtxWarn ? ' token-meter-wrap--warn' : ''}`}>
				<span
					className="token-meter token-meter--budget"
					title={tooltip || t('chat.tokens.contextTitle', formatTokenCount(occupied), formatTokenCount(limit ?? 0))}
				>
					{label}
				</span>
			</span>
		);
	}

	if (!hasUsage) {
		return null;
	}

	return (
		<div className="token-meter token-meter--msg">
			{t('chat.tokens.detail', formatTokenCount(usage!.promptTokens), formatTokenCount(usage!.completionTokens))}
		</div>
	);
}
