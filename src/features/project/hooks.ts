import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { AGENT_LIMITS, previewText } from '../agent/policy';
import { getEffectiveHooksInline, getEffectiveHooksPath } from '../../core/config/layers';
import { writeLog } from '../../core/log/logger';

const execFileAsync = promisify(execFile);

export type HookEvent = | 'beforeSubmit' | 'beforeShell' | 'session.diff' | 'session.compacting' | 'shell.env' | 'file.watcher';

export interface HookCommand {
	command: string;
	matchers?: HookMatcher[];
}

export type HookMatcher = string | {
	pattern?: string;
	event?: string;
	command?: string;
	text?: string;
	cwd?: string;
};

export interface ProjectHooks {
	beforeSubmit: HookCommand[];
	beforeShell: HookCommand[];
	sessionDiff: HookCommand[];
	sessionCompacting: HookCommand[];
	shellEnv: HookCommand[];
	fileWatcher: HookCommand[];
}

export interface HookRunResult {
	ok: boolean;
	vetoed: boolean;
	stderr?: string;
	stdout?: string;
	command?: string;
	exitCode?: number | string;
	// Смерженные env из stdout хуков shell.env
	env?: Record<string, string>;
}

const MAX_HOOK_OUTPUT = 4_000;
const HOOK_TIMEOUT_MS = 15_000;
let lastHooksError: string | undefined;
let lastReportedHooksError: string | undefined;

export function getLastHooksError(): string | undefined {
	return lastHooksError;
}

const EMPTY_HOOKS: ProjectHooks = {
	beforeSubmit: [],
	beforeShell: [],
	sessionDiff: [],
	sessionCompacting: [],
	shellEnv: [],
	fileWatcher: [],
};

function asHookList(raw: unknown): HookCommand[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const out: HookCommand[] = [];
	for (const item of raw) {
		if (typeof item === 'string' && item.trim()) {
			out.push({ command: item.trim() });
			continue;
		}

		if (item && typeof item === 'object' && typeof (item as { command?: unknown }).command === 'string') {
			const command = String((item as { command: string }).command).trim();
			if (command) {
				const rawMatchers = (item as { matchers?: unknown }).matchers;
				const matchers = Array.isArray(rawMatchers)
					? rawMatchers.filter((matcher): matcher is HookMatcher => (
						typeof matcher === 'string'
						|| Boolean(matcher && typeof matcher === 'object' && !Array.isArray(matcher))
					))
					: undefined;
				out.push({ command, ...(matchers ? { matchers } : {}) });
			}
		}
	}
	return out;
}

function hooksForEvent(hooks: ProjectHooks, event: HookEvent): HookCommand[] {
	switch (event) {
		case 'beforeSubmit':
			return hooks.beforeSubmit;
		case 'beforeShell':
			return hooks.beforeShell;
		case 'session.diff':
			return hooks.sessionDiff;
		case 'session.compacting':
			return hooks.sessionCompacting;
		case 'shell.env':
			return hooks.shellEnv;
		case 'file.watcher':
			return hooks.fileWatcher;
	}
}

// События notify: ненулевой exit не блокирует действие
function isNotifyOnly(event: HookEvent): boolean {
	return event === 'session.diff' || event === 'file.watcher';
}

// Загрузить hooks: hooksPath из слоёв конфига * иначе `.gen/hooks.json`, плюс inline `hooks` из JSON
export async function loadProjectHooks(): Promise<ProjectHooks> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const fromFile = folder
		? await readHooksFile(resolveHooksUri(folder))
		: { ...EMPTY_HOOKS };
	const inline = parseHooksRecord(getEffectiveHooksInline());
	// Встроенные hooks из слоёв конфигурации поверх файла (project/user уже объединены в getEffectiveHooksInline)
	return mergeHooks(fromFile, inline);
}

function resolveHooksUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	const configured = getEffectiveHooksPath();
	if (configured) {
		if (path.isAbsolute(configured)) {
			return vscode.Uri.file(configured);
		}

		return vscode.Uri.joinPath(folder.uri, configured);
	}

	return vscode.Uri.joinPath(folder.uri, '.gen', 'hooks.json');
}

async function readHooksFile(uri: vscode.Uri): Promise<ProjectHooks> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const rawText = new TextDecoder().decode(bytes);
		const raw = JSON.parse(rawText) as {
			hooks?: Record<string, unknown>;
			beforeSubmit?: unknown;
			beforeShell?: unknown;
		};
		const hooks = (raw.hooks ?? raw) as Record<string, unknown>;
		lastHooksError = undefined;
		lastReportedHooksError = undefined;
		return parseHooksRecord(hooks);
	} catch (err) {
		const code = (err as { code?: string | number }).code;
		const name = (err as { name?: string }).name;
		if (code === 'FileNotFound' || code === 'ENOENT' || name === 'EntryNotFound') {
			lastHooksError = undefined;
			return { ...EMPTY_HOOKS };
		}

		lastHooksError = `${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`;
		if (lastReportedHooksError !== lastHooksError) {
			lastReportedHooksError = lastHooksError;
			writeLog('agent', `[hooks] failed to load: ${lastHooksError}`);
		}

		return { ...EMPTY_HOOKS };
	}
}

function wildcardPatternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`, 'i');
}

export function matchesHookPattern(value: string, pattern: string): boolean {
	const trimmed = pattern.trim();
	if (!trimmed) {
		return false;
	}

	try {
		return wildcardPatternToRegExp(trimmed).test(value);
	} catch {
		return false;
	}
}

export function hookCommandMatches(
	hook: HookCommand,
	event: HookEvent,
	env: Record<string, string>,
	cwd = '',
): boolean {
	if (!hook.matchers || hook.matchers.length === 0) {
		return true;
	}

	const subject = event === 'beforeShell'
		? env.GEN_HOOK_COMMAND ?? ''
		: event === 'beforeSubmit'
			? env.GEN_HOOK_TEXT ?? ''
			: env.GEN_HOOK_PATH ?? env.GEN_HOOK_PATHS ?? '';
	return hook.matchers.some((matcher) => {
		if (typeof matcher === 'string') {
			return matchesHookPattern(subject, matcher);
		}

		const checks: Array<[string, string | undefined]> = [
			[event, matcher.event],
			[env.GEN_HOOK_COMMAND ?? '', matcher.command],
			[env.GEN_HOOK_TEXT ?? '', matcher.text],
			[cwd, matcher.cwd],
			[subject, matcher.pattern],
		];
		const active = checks.filter(([, pattern]) => typeof pattern === 'string');
		return active.length > 0 && active.every(([value, pattern]) => matchesHookPattern(value, pattern!));
	});
}

function parseHooksRecord(hooks: Record<string, unknown> | undefined): ProjectHooks {
	if (!hooks) {
		return { ...EMPTY_HOOKS };
	}
	return {
		beforeSubmit: asHookList(hooks.beforeSubmit),
		beforeShell: asHookList(hooks.beforeShell),
		sessionDiff: asHookList(hooks['session.diff']),
		sessionCompacting: asHookList(hooks['session.compacting']),
		shellEnv: asHookList(hooks['shell.env']),
		fileWatcher: asHookList(hooks['file.watcher']),
	};
}

// Списки из наложения (overlay) заменяют непустые; пустое наложение не затирает файл
function mergeHooks(base: ProjectHooks, overlay: ProjectHooks): ProjectHooks {
	return {
		beforeSubmit: overlay.beforeSubmit.length > 0 ? overlay.beforeSubmit : base.beforeSubmit,
		beforeShell: overlay.beforeShell.length > 0 ? overlay.beforeShell : base.beforeShell,
		sessionDiff: overlay.sessionDiff.length > 0 ? overlay.sessionDiff : base.sessionDiff,
		sessionCompacting: overlay.sessionCompacting.length > 0
			? overlay.sessionCompacting
			: base.sessionCompacting,
		shellEnv: overlay.shellEnv.length > 0 ? overlay.shellEnv : base.shellEnv,
		fileWatcher: overlay.fileWatcher.length > 0 ? overlay.fileWatcher : base.fileWatcher,
	};
}

async function runShellHook(
	command: string,
	cwd: string,
	envExtra: Record<string, string>,
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const isWin = process.platform === 'win32';
	const shell = isWin ? 'cmd.exe' : '/bin/sh';
	const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
	try {
		const { stdout, stderr } = await execFileAsync(shell, args, {
			cwd,
			timeout: HOOK_TIMEOUT_MS,
			maxBuffer: AGENT_LIMITS.maxCommandOutput,
			signal,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				...envExtra,
			},
		});
		return {
			ok: true,
			vetoed: false,
			stdout: previewText(String(stdout ?? ''), MAX_HOOK_OUTPUT),
			stderr: previewText(String(stderr ?? ''), MAX_HOOK_OUTPUT),
			command,
			exitCode: 0,
		};
	} catch (err) {
		const execErr = err as NodeJS.ErrnoException & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			killed?: boolean;
		};
		if (execErr.name === 'AbortError' || signal?.aborted) {
			const abortErr = new Error(vscode.l10n.t('agent.operationCancelled'));
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		const stderr = previewText(String(execErr.stderr ?? execErr.message ?? err), MAX_HOOK_OUTPUT);
		return {
			ok: false,
			vetoed: true,
			stdout: previewText(String(execErr.stdout ?? ''), MAX_HOOK_OUTPUT),
			stderr,
			command,
			exitCode: execErr.code,
		};
	}
}

export async function runHookEvent(
	event: HookEvent,
	envExtra: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const hooks = await loadProjectHooks();
	const list = hooksForEvent(hooks, event);
	if (list.length === 0) {
		return { ok: true, vetoed: false };
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	const cwd = folder?.uri.fsPath ?? process.cwd();
	const notifyOnly = isNotifyOnly(event);
	const hookEnv = {
		GEN_HOOK_EVENT: event,
		...envExtra,
	};

	for (const item of list) {
		if (!hookCommandMatches(item, event, hookEnv, cwd)) {
			continue;
		}

		const result = await runShellHook(item.command, cwd, hookEnv, signal);
		if (result.vetoed || !result.ok) {
			if (notifyOnly) {
				// мягкий сбой - только логируем, не блокируем
				writeLog(
					'agent',
					`[hooks] ${event} soft failure: ${item.command}${result.stderr ? ` - ${result.stderr}` : ''}`,
				);
				continue;
			}
			return {
				...result,
				vetoed: true,
				stderr: result.stderr?.trim()
					|| vscode.l10n.t('chat.hooks.veto', event, item.command),
			};
		}
	}

	return { 
		ok: true, 
		vetoed: false 
	};
}

// Выполнить подходящие hooks для диагностики, не позволяя ошибкам отменить реальное действие.
export async function dryRunHookEvent(
	event: HookEvent,
	envExtra: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const hooks = await loadProjectHooks();
	const folder = vscode.workspace.workspaceFolders?.[0];
	const cwd = folder?.uri.fsPath ?? process.cwd();
	const hookEnv = { GEN_HOOK_EVENT: event, ...envExtra };
	const results: HookRunResult[] = [];
	for (const item of hooksForEvent(hooks, event)) {
		if (hookCommandMatches(item, event, hookEnv, cwd)) {
			results.push(await runShellHook(item.command, cwd, hookEnv, signal));
		}
	}

	const failed = results.find((result) => !result.ok);
	return {
		ok: !failed,
		vetoed: false,
		exitCode: failed?.exitCode ?? 0,
		stdout: previewText(results.map((result) => result.stdout ?? '').filter(Boolean).join('\n'), MAX_HOOK_OUTPUT),
		stderr: previewText(results.map((result) => result.stderr ?? '').filter(Boolean).join('\n'), MAX_HOOK_OUTPUT),
		command: results.map((result) => result.command).filter(Boolean).join(' && ') || undefined,
	};
}

export async function runBeforeSubmitHook(text: string, signal?: AbortSignal): Promise<HookRunResult> {
	return runHookEvent('beforeSubmit', {
		GEN_HOOK_TEXT: text.slice(0, 4_000),
	}, signal);
}

export async function runBeforeShellHook(commandLine: string, signal?: AbortSignal): Promise<HookRunResult> {
	return runHookEvent('beforeShell', {
		GEN_HOOK_COMMAND: commandLine.slice(0, 2_000),
	}, signal);
}

// Уведомление session.diff после хода: пути через GEN_HOOK_PATHS
export async function runSessionDiffHook(paths: string[], turnId: string): Promise<HookRunResult> {
	return runHookEvent('session.diff', {
		GEN_HOOK_PATHS: paths.join('\n').slice(0, 8_000),
		GEN_HOOK_TURN_ID: turnId.slice(0, 200),
	});
}

// Перед compact: ненулевой exit блокирует уплотнение
export async function runSessionCompactingHook(signal?: AbortSignal): Promise<HookRunResult> {
	return runHookEvent('session.compacting', {}, signal);
}

/**
 * Разобрать env из stdout хука shell.env.
 * Форматы: JSON `{"env":{"K":"V"}}` / `{"K":"V"}`, либо строки `KEY=value`.
 */
export function parseEnvFromHookStdout(stdout: string): Record<string, string> {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return {};
	}

	// Чистый JSON (весь stdout)
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		const fromJson = envMapFromJson(parsed);
		if (fromJson) {
			return fromJson;
		}
	} catch {}

	// Последний JSON-объект в выводе (если был echo + JSON)
	const lastBrace = trimmed.lastIndexOf('{');
	if (lastBrace >= 0) {
		try {
			const parsed = JSON.parse(trimmed.slice(lastBrace)) as unknown;
			const fromJson = envMapFromJson(parsed);
			if (fromJson) {
				return fromJson;
			}
		} catch {}
	}

	const out: Record<string, string> = {};
	for (const line of trimmed.split(/\r?\n/)) {
		const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
		if (m) {
			out[m[1]!] = m[2]!;
		}
	}

	return out;
}

function envMapFromJson(parsed: unknown): Record<string, string> | undefined {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return undefined;
	}

	const obj = parsed as Record<string, unknown>;
	const source = (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env))
		? obj.env as Record<string, unknown>
		: obj;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		if (key === 'env' && obj.env && typeof obj.env === 'object') {
			continue;
		}

		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			out[key] = String(value);
		}
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Перед запуском run_command: добавить или изменить env либо запретить запуск.
 * Переменные окружения: GEN_HOOK_EVENT=shell.env, GEN_HOOK_COMMAND, GEN_HOOK_CWD.
 * stdout -> объединить карту env (JSON или KEY=value).
 */
export async function runShellEnvHook(
	commandLine: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const hooks = await loadProjectHooks();
	const list = hooks.shellEnv;
	if (list.length === 0) {
		return { 
			ok: true, 
			vetoed: false, 
			env: {} 
		};
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	const hookCwd = folder?.uri.fsPath ?? process.cwd();
	const merged: Record<string, string> = {};
	const hookEnv = {
		GEN_HOOK_EVENT: 'shell.env',
		GEN_HOOK_COMMAND: commandLine.slice(0, 2_000),
		GEN_HOOK_CWD: cwd.slice(0, 2_000),
	};

	for (const item of list) {
		if (!hookCommandMatches(item, 'shell.env', hookEnv, hookCwd)) {
			continue;
		}
		
		const result = await runShellHook(item.command, hookCwd, hookEnv, signal);

		if (result.vetoed || !result.ok) {
			return {
				...result,
				vetoed: true,
				env: {},
				stderr: result.stderr?.trim() || vscode.l10n.t('chat.hooks.veto', 'shell.env', item.command),
			};
		}

		Object.assign(merged, parseEnvFromHookStdout(result.stdout ?? ''));
	}

	return { 
		ok: true, 
		vetoed: false, 
		env: merged 
	};
}

export type FileWatcherEventKind = 'create' | 'change' | 'delete';

/**
 * Уведомление (мягкая ошибка): изменения в `.gen/**`.
 * Переменные окружения: GEN_HOOK_PATH, GEN_HOOK_FILE_EVENT, GEN_HOOK_PATHS, GEN_HOOK_FILE_EVENTS.
 */
export async function runFileWatcherHook(
	entries: Array<{ path: string; event: FileWatcherEventKind }>,
): Promise<HookRunResult> {
	if (entries.length === 0) {
		return { ok: true, vetoed: false };
	}

	const paths = entries.map((e) => e.path);
	const events = entries.map((e) => e.event);
	return runHookEvent('file.watcher', {
		GEN_HOOK_PATH: paths[0]!.slice(0, 2_000),
		GEN_HOOK_FILE_EVENT: events[0]!,
		GEN_HOOK_PATHS: paths.join('\n').slice(0, 8_000),
		GEN_HOOK_FILE_EVENTS: events.join('\n').slice(0, 4_000),
	});
}
