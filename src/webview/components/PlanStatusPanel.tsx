import type { ChatViewState } from '../../features/chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

type StickyPlanUi = NonNullable<ChatViewState['stickyPlan']>;

interface PlanStatusPanelProps {
	plan: StickyPlanUi;
}

function statusLabel(status: StickyPlanUi['steps'][number]['status']): string {
	switch (status) {
		case 'in_progress':
			return t('chat.stickyPlan.in_progress');
		case 'done':
			return t('chat.stickyPlan.done');
		case 'skipped':
			return t('chat.stickyPlan.skipped');
		default:
			return t('chat.stickyPlan.pending');
	}
}

function statusIcon(status: StickyPlanUi['steps'][number]['status']): string {
	switch (status) {
		case 'in_progress':
			return '◐';
		case 'done':
			return '✓';
		case 'skipped':
			return '-';
		default:
			return '○';
	}
}

export function PlanStatusPanel({ plan }: PlanStatusPanelProps) {
	return (
		<section className="todo-panel plan-panel" aria-label={t('chat.stickyPlan.title')}>
			<div className="todo-panel__title-row">
				<div className="todo-panel__title">
					{t('chat.stickyPlan.title')}: {plan.title}
					<span className="plan-panel__meta">
						{' '}
						({plan.doneCount}/{plan.steps.length}
						{plan.pendingCount > 0 ? ` ${t('chat.stickyPlan.pendingCount', plan.pendingCount)}` : ''})
					</span>
				</div>
				<button
					type="button"
					className="btn btn--secondary plan-panel__open"
					onClick={() => vscodeApi.postMessage({ type: 'openStickyPlan' })}
					title={plan.relativePath}
				>
					{t('chat.stickyPlan.open')}
				</button>
			</div>
			<ul className="todo-panel__list">
				{plan.steps.map((step, index) => (
					<li
						key={`${index}-${step.title}`}
						className={`todo-panel__item todo-panel__item--${step.status === 'done' ? 'completed' : step.status === 'skipped' ? 'cancelled' : step.status}`}
					>
						<span className="todo-panel__icon" aria-hidden="true">{statusIcon(step.status)}</span>
						<span className="todo-panel__content">
							{step.title}
							{step.path ? <span className="plan-panel__path"> {step.path}</span> : null}
						</span>
						<span className="todo-panel__status">{statusLabel(step.status)}</span>
					</li>
				))}
			</ul>
		</section>
	);
}
