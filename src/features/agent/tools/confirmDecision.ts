import type { ApprovalActionType, PermissionDecision } from '../permissionPolicy';
import type { ConfirmChoice } from '../types';
import { shouldSkipConfirmForBatchEdits } from './batchEditConfirm';
import { needsReviewDiffConfirm } from './reviewEditPreview';

// Исход кнопки confirm: продолжить tool, deny в loop, или abort turn
export type ConfirmChoiceOutcome = 'proceed' | 'denied' | 'abort';

/**
 * Матрица ask UI: apply / always / allow_remaining -> продолжить; skip -> denied; abort -> abort.
 * Без UI / vscode - для unit-тестов и единого поведения toolsFallback.
 */
export function resolveConfirmChoiceOutcome(choice: ConfirmChoice): ConfirmChoiceOutcome {
	if (choice === 'apply' || choice === 'always' || choice === 'allow_remaining') {
		return 'proceed';
	}

	if (choice === 'skip') {
		return 'denied';
	}

	return 'abort';
}

// «Allow remaining edits» - продолжить + batch на этот turn (не Always)
export function isAllowRemainingConfirmChoice(choice: ConfirmChoice): boolean {
	return choice === 'allow_remaining';
}

export function isAlwaysConfirmChoice(choice: ConfirmChoice): boolean {
	return choice === 'always';
}

/**
 * Сервер отклонил native tools -> карточка Continue/Stop.
 * Continue (apply|always) -> text `<tool_call>`; Stop (skip|abort) -> выход из run.
 */
export function shouldContinueToolsFallback(choice: ConfirmChoice): boolean {
	return resolveConfirmChoiceOutcome(choice) === 'proceed';
}

export type ToolsFallbackPolicyDecision = 'continue' | 'stop' | 'ask';

/**
 * Политика settings.toolsFallbackPolicy до Confirm UI.
 * always -> сразу text-tools; stop -> выход; ask -> показать Continue/Stop.
 */
export function resolveToolsFallbackPolicy(
	policy: 'ask' | 'always' | 'stop' | undefined,
): ToolsFallbackPolicyDecision {
	if (policy === 'stop') {
		return 'stop';
	}
	if (policy === 'ask') {
		return 'ask';
	}
	return 'continue';
}

/**
 * После deny tool: остановить agent loop, если continueLoopOnDeny выключен.
 * cancelled (per-tool kill) всегда продолжает цикл.
 */
export function shouldStopLoopOnToolDeny(
	denied: boolean,
	cancelled: boolean | undefined,
	continueLoopOnDeny: boolean,
): boolean {
	return denied && !cancelled && !continueLoopOnDeny;
}

export type ToolConfirmGating = {
	skipConfirm: boolean;
	forceConfirm: boolean;
};

/**
 * Центральный gating до confirmAlwaysOrSkip (edits/shell/web).
 * deny обрабатывается отдельно (ранний return); сюда приходит ask|allow|review.
 */
export function resolveToolConfirmGating(input: {
	decision: PermissionDecision;
	action: ApprovalActionType | undefined;
	autoApprove: boolean;
	sensitiveWrite: boolean;
	planShellForceAsk: boolean;
	// Субагент + мутирующий tool: не пропускать confirm автоматически
	nestedStrictMutating: boolean;
	// После «Allow remaining edits» в этом turn
	allowRemainingEditsThisTurn?: boolean;
}): ToolConfirmGating {
	const reviewEdit = needsReviewDiffConfirm(input.decision, input.action);
	const canSkip = input.decision === 'allow' || (input.autoApprove && input.decision === 'ask');
	let skipConfirm = canSkip && !input.sensitiveWrite && !input.planShellForceAsk && !input.nestedStrictMutating;

	let forceConfirm = false;

	if (input.planShellForceAsk || reviewEdit) {
		// Shell в Plan / review edits: всегда карточка (в т.ч. при autoApprove)
		forceConfirm = true;
		skipConfirm = false;
	}

	// Пакетно: разрешить остальные edits/delete этого turn (не shell; не .env*)
	if (shouldSkipConfirmForBatchEdits({
		allowRemainingEditsThisTurn: input.allowRemainingEditsThisTurn,
		action: input.action,
		sensitiveWrite: input.sensitiveWrite,
	})) {
		skipConfirm = true;
		forceConfirm = false;
	}

	return {
		skipConfirm,
		forceConfirm
	};
}
