import * as vscode from 'vscode';
import { getSettings } from '../../../core/config/settings';
import { beginGenOperationSpan } from '../../../core/llm/otel';
import { shouldConfirmDeletes, shouldConfirmWrites } from '../auth';
import { previewText } from '../policy';
import { throwIfAborted } from '../workspacePath';
import type { ConfirmChoice, ToolContext, ToolResult } from '../types';
import { isAllowRemainingConfirmChoice, isAlwaysConfirmChoice, resolveConfirmChoiceOutcome } from './confirmDecision';

export function abortTurn(): never {
	const err = new Error(vscode.l10n.t('agent.operationCancelled'));
	err.name = 'AbortError';
	throw err;
}

export type ConfirmOrSkipOpts = {
	suggestion?: string;
	allowAlways?: boolean;
	// Предложить «Allow remaining edits» (очередь в этом turn)
	allowRemaining?: boolean;
	remainingEdits?: number;
	applyLabel?: string;
	skipLabel?: string;
	rejectLabel?: string;
	hint?: string;
};

// Единое правило: после central confirm skipConfirm=true - вторая карточка Always/Apply не нужна
export function shouldSkipToolConfirm(opts: {
	skipConfirm?: boolean;
	forceConfirm?: boolean;
	autoApprove: boolean;
}): boolean {
	// forceConfirm (shell в Plan / review / перезапись правок пользователя) перекрывает skip и autoApprove
	return !opts.forceConfirm && (Boolean(opts.skipConfirm) || opts.autoApprove);
}

// Временный forceConfirm для особых ask (конфликт с правками пользователя после central Apply)
export async function withForcedConfirm<T>(
	ctx: ToolContext,
	run: () => Promise<T>,
): Promise<T> {
	const ext = ctx as ToolContext & {
		skipConfirm?: boolean;
		forceConfirm?: boolean;
	};
	const prevForce = ext.forceConfirm;
	const prevSkip = ext.skipConfirm;
	ext.forceConfirm = true;
	ext.skipConfirm = false;
	try {
		return await run();
	} finally {
		ext.forceConfirm = prevForce;
		ext.skipConfirm = prevSkip;
	}
}

export async function confirmOrSkip(
	ctx: ToolContext,
	title: string,
	detail?: string,
	opts?: ConfirmOrSkipOpts,
): Promise<ToolResult | undefined> {
	throwIfAborted(ctx.signal);
	const ext = ctx as ToolContext & {
		skipConfirm?: boolean
		forceConfirm?: boolean
	};
	if (shouldSkipToolConfirm({
		skipConfirm: ext.skipConfirm,
		forceConfirm: ext.forceConfirm,
		autoApprove: getSettings().autoApprove,
	})) {
		return undefined;
	}

	if (!ctx.confirm) {
		return {
			ok: false,
			denied: true,
			content: vscode.l10n.t('agent.confirmUiUnavailable'),
		};
	}

	const span = beginGenOperationSpan(getSettings(), 'tool.confirm', { title: title.slice(0, 120) });
	let choice: ConfirmChoice;
	try {
		choice = await new Promise((resolve, reject) => {
		const onAbort = () => {
			const err = new Error(vscode.l10n.t('agent.operationCancelled'));
			err.name = 'AbortError';
			reject(err);
		};
		if (ctx.signal?.aborted) {
			onAbort();
			return;
		}

		ctx.signal?.addEventListener('abort', onAbort, { once: true });
		void Promise.resolve(ctx.confirm!({
			title,
			detail: detail ? previewText(detail) : undefined,
			hint: opts?.hint,
			suggestion: opts?.suggestion,
			allowAlways: opts?.allowAlways,
			allowRemaining: opts?.allowRemaining,
			remainingEdits: opts?.remainingEdits,
			applyLabel: opts?.applyLabel,
			skipLabel: opts?.skipLabel,
			rejectLabel: opts?.rejectLabel,
		})).then((value) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			resolve(value);
		}, (err: unknown) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			reject(err);
		});
		});
		span?.end('ok', { choice });
	} catch (err) {
		span?.end('error');
		throw err;
	}

	// apply|always|allow_remaining -> продолжить; skip -> denied; abort -> AbortError
	const outcome = resolveConfirmChoiceOutcome(choice);
	if (outcome === 'proceed') {
		const hooks = ctx as ToolContext & {
			onAlwaysAllow?: (pattern: string) => void
			onAllowRemainingEditsThisTurn?: () => void
		};
		if (isAlwaysConfirmChoice(choice) && opts?.suggestion && hooks.onAlwaysAllow) {
			hooks.onAlwaysAllow(opts.suggestion);
		}
		if (isAllowRemainingConfirmChoice(choice)) {
			hooks.onAllowRemainingEditsThisTurn?.();
		}

		return undefined;
	}

	if (outcome === 'denied') {
		return {
			ok: false,
			denied: true,
			content: vscode.l10n.t('agent.userDenied'),
		};
	}

	abortTurn();
}

export async function confirmAlwaysOrSkip(
	ctx: ToolContext,
	title: string,
	detail?: string,
	opts?: Omit<ConfirmOrSkipOpts, 'allowAlways'>,
): Promise<ToolResult | undefined> {
	const ext = ctx as ToolContext & {
		skipConfirm?: boolean;
		forceConfirm?: boolean;
		suggestAlwaysPattern?: string;
	};
	// Тот же gate, что confirmOrSkip - иначе Always/Apply дублируются после central ask
	if (shouldSkipToolConfirm({
		skipConfirm: ext.skipConfirm,
		forceConfirm: ext.forceConfirm,
		autoApprove: getSettings().autoApprove,
	})) {
		return undefined;
	}

	const suggestion = opts?.suggestion ?? ext.suggestAlwaysPattern;
	return confirmOrSkip(ctx, title, detail, {
		...opts,
		allowAlways: true,
		suggestion,
	});
}

export { shouldConfirmDeletes, shouldConfirmWrites };
