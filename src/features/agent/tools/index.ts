import * as vscode from 'vscode';
import type { LlmToolDefinition } from '../../../core/llm/types';
import { getSettings } from '../../../core/config/settings';
import { logAgentTool } from '../audit';
import { isMutatingTool } from '../auth';
import { evaluateApproval, matchesSensitivePath, suggestPattern, toolActionType, type PermissionDecision } from '../permissionPolicy';
import { mutationPathsFromArgs } from '../plan';
import { isOutsideWorkspaceInput, pathIsInside } from '../policy';
import { getAgentRoot } from '../agentRoot';
import { extractPathFromPartialJson, parseToolArguments, toLlmToolDefinition } from '../types';
import type { ToolContext, ToolResult } from '../types';
import { includeApplyPatchForModel } from '../modelRoutedPatch';
import { getToolByName, listTools } from './registry';
import { confirmAlwaysOrSkip } from './confirm';
import { shouldOfferAllowRemainingEdits } from './batchEditConfirm';
import { resolveToolConfirmGating } from './confirmDecision';
import { formatToolConfirmDetail } from './toolConfirmFormat';
import { buildEditReviewEntriesFromArgs, editPathsFromToolArgs, formatEditReviewPreview, needsReviewDiffConfirm } from './reviewEditPreview';
import { pathExists, resolveWorkspacePath } from '../workspacePath';
import type { TodoStore } from '../todoStore';
import type { ShellSession } from '../shellSession';
import type { TaskToolContext } from './shell/taskShell';
import type { ChatMode } from '../../../core/config/types';

// Побочный эффект: регистрация всех builtin tools
import './builtins';

export type ExtendedToolContext = ToolContext & TaskToolContext & {
	sessionAllow?: string[];
	onAlwaysAllow?: (pattern: string) => void;
	// Паттерн для кнопки Always (из suggestPattern); читает confirmAlwaysOrSkip
	suggestAlwaysPattern?: string;
	// Флаг turn: после «Allow remaining edits» пропускать confirm на edits/delete
	allowRemainingEditsThisTurn?: boolean;
	// Колбэк: пользователь выбрал «Allow remaining» на ConfirmCard
	onAllowRemainingEditsThisTurn?: () => void;
	// Сколько mutating edits ещё в очереди этого turn (после текущего)
	remainingMutatingEdits?: number;
	todos?: TodoStore;
	// Mid-run вопрос пользователю (ask_question)
	askQuestion?(request: {
		title: string;
		questions: Array<{
			id: string;
			prompt: string;
			options?: string[]
		}>;
	}): Promise<Record<string, string>>;
	skipConfirm?: boolean;
	// Принудительный confirm (например shell в Plan), даже при autoApprove
	forceConfirm?: boolean;
	shell?: ShellSession;
	subagentDepth?: number;
	// Смена режима чата из tools plan_enter / plan_exit / switch_mode
	setChatMode?: (mode: ChatMode) => void | Promise<void>;
	createNewTask?(params: {
		title?: string;
		prompt: string;
		mode?: ChatMode;
		autoStart?: boolean;
	}): Promise<{ sessionId: string; title: string }>;
};

export function getAgentLlmTools(mode?: string, opts?: {
	readonly?: boolean;
	disableTask?: boolean;
	primary?: boolean;
	// Id модели текущего run (для маршрутизации patch по модели)
	modelId?: string;
}): LlmToolDefinition[] {
	const settings = getSettings();
	const modelId = opts?.modelId ?? settings.model;
	const keepApplyPatch = includeApplyPatchForModel(modelId, settings.modelRoutedPatch);
	const filtered = listTools().filter((tool) => {
		if (!settings.enableFileReading && ['read_file', 'glob', 'grep', 'file_search', 'find_code', 'list_dir'].includes(tool.name)) {
			return false;
		}

		if (!settings.enableTerminal && ['run_command', 'run_tests', 'await_shell', 'run_scratch', 'run_plugin'].includes(tool.name)) {
			return false;
		}

		if (!settings.webSearchEnabled && tool.name === 'web_search') {
			return false;
		}

		if (!settings.webFetchEnabled && (tool.name === 'fetch_page' || tool.name === 'web_fetch')) {
			return false;
		}

		if (!settings.designScreenshotEnabled && tool.name === 'design_screenshot') {
			return false;
		}

		if (!settings.browserComputerUseEnabled && tool.name === 'browser_action') {
			return false;
		}

		if ((mode === 'plan' || mode === 'multitask' || mode === 'project') && isMutatingTool(tool.name)) {
			return false;
		}

		if (opts?.readonly && isMutatingTool(tool.name)) {
			return false;
		}

		const shellTool = ['run_command', 'run_tests', 'await_shell', 'run_scratch', 'run_plugin'].includes(tool.name);
		// Plan + planShellPolicy=ask: shell в списке; confirm принудительный в executeAgentTool
		const planShellAsk = mode === 'plan' && settings.planShellPolicy === 'ask' && shellTool;
		if (opts?.readonly && (shellTool || tool.name === 'open_browser')) {
			if (!planShellAsk) {
				return false;
			}
		}

		if (opts?.disableTask && tool.name === 'task') {
			return false;
		}

		// Маршрутизация patch: non-GPT без apply_patch (write/edit остаются)
		if (!keepApplyPatch && tool.name === 'apply_patch') {
			return false;
		}

		return true;
	});

	// primaryTools: только для primary-агента (не readonly / не субагент)
	const applyPrimary = opts?.primary !== false && !opts?.readonly && settings.primaryTools.length > 0;
	if (!applyPrimary) {
		return filtered.map(toLlmToolDefinition);
	}

	const allow = new Set(settings.primaryTools.map((name) => name.trim()).filter(Boolean));
	const primaryFiltered = filtered.filter((tool) => allow.has(tool.name));
	// пустой результат после фильтра - откат ко всем (запасной essential fallback)
	const result = primaryFiltered.length > 0 ? primaryFiltered : filtered;
	return result.map(toLlmToolDefinition);
}

function subjectFromArgs(name: string, rawArguments: string): string {
	try {
		const args = parseToolArguments(rawArguments);
		if (name === 'apply_diff' && typeof args.patch === 'string') {
			const paths = mutationPathsFromArgs(name, args);
			return paths[0] ?? name;
		}

		if (typeof args.path === 'string') {
			return args.path;
		}

		if (typeof args.command === 'string') {
			return args.command;
		}

		if (typeof args.url === 'string') {
			return args.url;
		}

		if (typeof args.query === 'string') {
			return args.query;
		}

		if (typeof args.name === 'string') {
			return args.name;
		}
	} catch {
		return extractPathFromPartialJson(rawArguments) ?? name;
	}

	return name;
}

function workspaceFoldersFs(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

export async function executeAgentTool(name: string, rawArguments: string, ctx: ExtendedToolContext = {}): Promise<ToolResult> {
	const tool = getToolByName(name);
	if (!tool) {
		return {
			ok: false,
			content: vscode.l10n.t('agent.unknownTool', name),
		};
	}

	const started = Date.now();
	const settings = getSettings();
	let action = toolActionType(name);
	const subject = subjectFromArgs(name, rawArguments);
	const ext = ctx as ExtendedToolContext;
	const chatMode = settings.chatMode;
	const pathLike = Boolean(extractPathFromPartialJson(rawArguments) || (() => {
		try {
			const args = parseToolArguments(rawArguments);
			if (typeof args.path === 'string') {
				return true;
			}
			
			if (name === 'apply_diff' && typeof args.patch === 'string') {
				return mutationPathsFromArgs(name, args).length > 0;
			}

			return false;
		} catch {
			return false;
		}
	})());

	// Plan / Multitask: мутации всегда запрещены (даже если tool как-то вызвали)
	if ((chatMode === 'plan' || chatMode === 'multitask') && isMutatingTool(name)) {
		const content = chatMode === 'plan'
			? 'Режим Plan - только чтение и план. Правки файлов запрещены; переключись в Agent (`plan_exit` / `/agent`).'
			: 'Режим Multitask - координатор без прямых правок. Делегируй через task или перейди в Agent.';
		logAgentTool({
			name,
			status: 'denied',
			ms: Date.now() - started,
			detail: content,
		});
		return {
			ok: false,
			denied: true,
			content,
		};
	}

	// Plan + deny: shell недоступен
	if (chatMode === 'plan' && action === 'shell' && settings.planShellPolicy === 'deny') {
		const content = 'Режим Plan (planShellPolicy=deny): shell недоступен. Переключись в Agent (`plan_exit` / `/agent`) или смени planShellPolicy на ask.';
		logAgentTool({
			name,
			status: 'denied',
			ms: Date.now() - started,
			detail: content,
		});
		return {
			ok: false,
			denied: true,
			content,
		};
	}

	// external_directory: путь вне workspace -> action `outside` или deny (запрет)
	// Исключение: cwd субагента в git worktree (может быть sibling вне workspace folders)
	if (pathLike && (action === 'edits' || action === 'delete' || name === 'read_file' || name === 'list_dir' || name === 'open_file' || name === 'create_dir' || name === 'apply_diff' || name === 'apply_patch' || name === 'apply_workspace_edit' || name === 'write_file' || name === 'edit_file' || name === 'delete_file' || name === 'edit_notebook' || name === 'run_scratch')) {
		const agentRoot = getAgentRoot();
		const insideAgentRoot = Boolean(agentRoot && subject && (pathIsInside(subject, agentRoot) || !subject.includes('/') && !subject.includes('\\')));
		const outside = !insideAgentRoot && isOutsideWorkspaceInput(subject, workspaceFoldersFs());
		if (outside) {
			if (!settings.allowExternalDirectory) {
				const content = `Отклонено: путь вне workspace (allowExternalDirectory=false): ${subject}`;
				logAgentTool({
					name,
					status: 'denied',
					ms: Date.now() - started,
					detail: content,
				});
				return {
					ok: false,
					denied: true,
					content,
				};
			}

			action = 'outside';
		}
	}

	// Паттерн Always для confirmAlwaysOrSkip (после remapping outside)
	ext.suggestAlwaysPattern = action ? suggestPattern(action, name, subject) : undefined;

	// Чувствительные пути (.env*): принудительный ask/deny на запись/удаление
	const sensitiveWrite = Boolean(action && (action === 'edits' || action === 'delete' || action === 'outside') && matchesSensitivePath(subject, settings.sensitivePathPatterns));

	// Режим plan + ask: shell всегда с confirm (не allow / autoApprove)
	const planShellForceAsk = chatMode === 'plan' && action === 'shell' && settings.planShellPolicy === 'ask';

	// permission.task / субагенты: чуть строже (не наследовать sessionAllow, не пропускать confirm автоматически)
	const nestedStrict = (ext.subagentDepth ?? 0) > 0;

	// Здесь центральный deny / session-allow; ask|review -> карточка ниже (до execute)
	let decision: PermissionDecision | undefined;
	if (action) {
		decision = evaluateApproval(action, subject, settings.approvalPolicy, nestedStrict ? undefined : ext.sessionAllow);
		if (sensitiveWrite && decision === 'allow') {
			decision = 'ask';
		}

		if (planShellForceAsk && (decision === 'allow' || decision === 'review')) {
			decision = 'ask';
		}

		if (decision === 'deny') {
			const content = `Отклонено политикой подтверждений (${action}): ${subject}`;
			logAgentTool({
				name,
				status: 'denied',
				ms: Date.now() - started,
				detail: content
			});
			return {
				ok: false,
				denied: true,
				content
			};
		}

		const gating = resolveToolConfirmGating({
			decision,
			action,
			autoApprove: settings.autoApprove,
			sensitiveWrite,
			planShellForceAsk,
			nestedStrictMutating: nestedStrict && isMutatingTool(name),
			allowRemainingEditsThisTurn: ext.allowRemainingEditsThisTurn,
		});
		ext.skipConfirm = gating.skipConfirm;
		ext.forceConfirm = gating.forceConfirm;
	} else {
		ext.forceConfirm = false;
	}

	const reviewEdit = needsReviewDiffConfirm(decision ?? 'allow', action);

	// Канон UX: ask/allow -> confirm на tool -> execute; review -> preview+Accept до записи; без post-apply Accept all
	if (action && (!ext.skipConfirm || ext.forceConfirm)) {
		let detail = formatToolConfirmDetail(subject, rawArguments, name);
		let title = vscode.l10n.t('agent.confirm.toolAsk', name);
		const remainingEdits = ext.remainingMutatingEdits ?? 0;
		const offerAllowRemaining = (action === 'edits' || action === 'delete')
			&& shouldOfferAllowRemainingEdits(remainingEdits);
		let confirmOpts: {
			applyLabel?: string;
			skipLabel?: string;
			hint?: string;
			allowRemaining?: boolean;
			remainingEdits?: number;
		} | undefined = offerAllowRemaining
			? {
				allowRemaining: true,
				remainingEdits,
			}
			: undefined;

		if (reviewEdit) {
			title = vscode.l10n.t('agent.confirm.reviewEdit', name);
			confirmOpts = {
				...confirmOpts,
				applyLabel: vscode.l10n.t('chat.hunk.accept'),
				skipLabel: vscode.l10n.t('chat.hunk.reject'),
				hint: vscode.l10n.t('agent.confirm.reviewHint'),
			};
			try {
				const args = parseToolArguments(rawArguments);
				const paths = editPathsFromToolArgs(name, args);
				const files = new Map<string, string>();
				for (const p of paths) {
					try {
						const resolved = await resolveWorkspacePath(p);
						if (await pathExists(resolved.uri)) {
							const doc = await vscode.workspace.openTextDocument(resolved.uri);
							const text = doc.getText();
							files.set(p, text);
							files.set(resolved.relative, text);
						}
					} catch {}
				}
				const entries = buildEditReviewEntriesFromArgs(name, args, files);
				if (entries?.length) {
					detail = formatEditReviewPreview(entries);
				}
			} catch {}
		}

		const denied = await confirmAlwaysOrSkip(
			ext,
			title,
			detail,
			confirmOpts,
		);
		if (denied) {
			logAgentTool({
				name,
				status: 'denied',
				ms: Date.now() - started,
				detail: denied.content,
			});
			return denied;
		}
		// Инструмент не должен показывать вторую карточку на том же edit
		ext.skipConfirm = true;
		ext.forceConfirm = false;
	}

	try {
		const args = parseToolArguments(rawArguments);
		if (isMutatingTool(name) && ctx.plan) {
			const blockedByPlan = ctx.plan.guard(mutationPathsFromArgs(name, args));
			if (blockedByPlan) {
				logAgentTool({
					name,
					status: 'denied',
					ms: Date.now() - started,
					detail: blockedByPlan.content,
				});
				return blockedByPlan;
			}
		}

		const result: ToolResult = await tool.execute(args, ctx);
		if (result.ok && isMutatingTool(name) && ctx.plan?.isApproved) {
			ctx.plan.markDoneByPaths(mutationPathsFromArgs(name, args));
			ctx.onPlanChanged?.();
		}
		
		if (result.content.length > settings.toolOutputMaxChars) {
			const over = result.content.length - settings.toolOutputMaxChars;
			result.content = `${result.content.slice(0, settings.toolOutputMaxChars)}\n\n[truncated ${over} chars]`;
		}

		logAgentTool({
			name,
			status: result.denied ? 'denied' : result.ok ? 'ok' : 'error',
			ms: Date.now() - started,
			detail: typeof args.command === 'string'
				? `${args.command} ${Array.isArray(args.args) ? args.args.join(' ') : ''}`.trim()
				: typeof args.path === 'string'
					? args.path
					: rawArguments,
		});
		return result;
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			logAgentTool({
				name,
				status: 'error',
				ms: Date.now() - started,
				detail: 'abort',
			});
			throw err;
		}

		logAgentTool({
			name,
			status: 'error',
			ms: Date.now() - started,
			detail: err instanceof Error ? err.message : String(err),
		});
		return {
			ok: false,
			path: extractPathFromPartialJson(rawArguments),
			content: err instanceof Error ? err.message : String(err),
		};
	}
}
