import * as path from 'node:path';
import * as vscode from 'vscode';
import { discoverLocalPlugins, resolveNpmPluginExecutable } from '../../../project/plugins';
import { asOptionalInt, asString, makeToolError } from '../../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { runShellCommand } from '../../shellExec';
import { formatCommandLine } from '../../commandPolicy';
import { confirmAlwaysOrSkip } from '../confirm';
import { pathIsInside } from '../../policy';
import { getSettings } from '../../../../core/config/settings';
import { recordActivity } from '../../../../core/stores/activityStore';

// Список локальных `.gen/tools` / `.gen/plugins` и npm-каталога (без require)
export const listPluginsTool: ToolDefinition = {
	name: 'list_plugins',
	description: 'Список локальных plugins, prompt-макросов `.gen/tools` и доверенного npm-каталога. `.gen/tools` - только инструкции для модели, не исполняемый host JS. npm запускается только через run_plugin.',
	parameters: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const items = await discoverLocalPlugins();
		return {
			ok: true,
			content: JSON.stringify({
				count: items.length,
				items: items.map((item) => ({
					kind: item.kind,
					name: item.name,
					description: item.description,
					path: item.path,
					hasBody: Boolean(item.body.trim()),
					runnable: Boolean(item.executable),
				})),
			}, null, 2),
		};
	},
};

// Загрузить инструкции локального plugin/tool по имени в контекст
export const pluginTool: ToolDefinition = {
	name: 'plugin',
	description: 'Загрузить описание plugin или prompt-макроса `.gen/tools` по имени. Содержимое - инструкции для модели, не исполняемый host JS; доверенный npm bin запускается через run_plugin.',
	parameters: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Имя plugin или tool',
			},
		},
		required: ['name'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const name = asString(args, 'name').trim().toLowerCase();
		if (!name) {
			return makeToolError('plugin: нужен параметр name', {
				code: 'missing_plugin_name', 
				category: 'validation', 
				retryable: false,
			});
		}

		const items = await discoverLocalPlugins();
		const hit = items.find((item) => item.name.toLowerCase() === name);
		if (!hit) {
			return makeToolError(`Неизвестный plugin/tool "${name}". Доступны: ${items.map((i) => i.name).join(', ') || '(нет)'}`, {
				code: 'plugin_not_found', 
				category: 'not_found', 
				retryable: false,
			});
		}

		const kindLabel = hit.kind === 'tool' ? 'Tool (prompt-macro)' : hit.kind === 'npm' ? 'npm' : 'Plugin';
		const macroNote = hit.kind === 'tool'
			? '\n[prompt-macro: instructions for the model only; no host JS execution]'
			: '';
		const body = hit.body.trim() || '(пустое тело - только манифест; открой соседний PLUGIN.md / TOOL.md через read_file)';
		const runNote = hit.executable
			? `\nRunnable: yes (run_plugin). command=${hit.executable.command}`
			: hit.kind === 'npm'
				? '\nRunnable: no (declare command/args or bin in gen/genAgent or .gen/npm-plugins.json)'
				: '';
		return {
			ok: true,
			content: `# ${kindLabel}: ${hit.name}${macroNote}\nПуть: ${hit.path}\nОписание: ${hit.description}${runNote}\n\n${body}`,
		};
	},
};

function extraArgsFromJson(raw: unknown): string[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	if (Array.isArray(raw)) {
		return raw.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean);
	}

	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean);
			}
		} catch {
			return [raw.trim()];
		}
	}

	return [];
}

/**
 * Запуск объявленной команды npm-плагина (только workspace/node_modules). Без require() в процессе расширения.
 * Риски/права shell (confirmAlwaysOrSkip + политика runShellCommand).
 */
export const runPluginTool: ToolDefinition = {
	name: 'run_plugin',
	description: 'Запустить только declared bin доверенного, точно pinned npm-плагина. Allowlist: `.gen/npm-plugins.json` или config.trustedPlugins; optional SHA-256 bin integrity. Произвольные PATH-команды и host JS запрещены.',
	parameters: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Имя npm-плагина из каталога',
			},
			args: {
				description: 'Доп. аргументы (массив строк или JSON-массив)',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Таймаут мс (по умолчанию как у shell tools)',
			},
		},
		required: ['name'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const name = asString(args, 'name').trim();
		if (!name) {
			return makeToolError('run_plugin: нужен параметр name', {
				code: 'missing_plugin_name', 
				category: 'validation', 
				retryable: false,
			});
		}

		const hit = await resolveNpmPluginExecutable(name);
		if (!hit?.executable) {
			const items = await discoverLocalPlugins();
			const runnable = items.filter((i) => i.kind === 'npm' && i.executable).map((i) => i.name);
			return makeToolError(`run_plugin: нет runnable npm-плагина "${name}". Доступны: ${runnable.join(', ') || '(нет)'}`, {
				code: 'plugin_not_runnable', 
				category: 'not_found', 
				retryable: false,
			});
		}

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return { 
				ok: false, 
				content: 'run_plugin: нет workspace' 
			};
		}

		const workspaceRoot = folder.uri.fsPath;
		const exe = hit.executable;
		if (!pathIsInside(exe.packageRoot, workspaceRoot)) {
			return { 
				ok: false, 
				content: 'run_plugin: packageRoot вне workspace' 
			};
		}

		const extra = extraArgsFromJson(args.args);
		for (const a of extra) {
			if (a.startsWith('-')) {
				continue;
			}

			if (a.includes('/') || a.includes('\\') || path.isAbsolute(a)) {
				const abs = path.isAbsolute(a) ? a : path.resolve(workspaceRoot, a);
				if (!pathIsInside(abs, workspaceRoot)) {
					return { 
						ok: false, 
						content: `run_plugin: аргумент вне workspace: ${a}` 
					};
				}
			}
		}

		const cmdArgs = [...exe.args, ...extra];
		const commandLine = formatCommandLine(exe.command, cmdArgs);
		const denied = await confirmAlwaysOrSkip(
			ctx,
			vscode.l10n.t('agent.confirm.runPlugin', hit.name),
			commandLine,
		);
		if (denied) {
			return denied;
		}

		const timeoutMs = asOptionalInt(args, 'timeout_ms');
		const settings = getSettings();
		const effectiveTimeoutMs = Math.min(
			settings.maxToolTimeoutMs,
			Math.max(1000, Math.floor(timeoutMs ?? settings.defaultToolTimeoutMs)),
		);
		const result = await runShellCommand({
			command: exe.command,
			args: cmdArgs,
			cwd: workspaceRoot,
			timeoutMs: timeoutMs ?? undefined,
			signal: ctx.signal,
		});
		recordActivity({
			kind: 'shell',
			toolName: 'run_plugin',
			label: result.ok
				? vscode.l10n.t('activity.plugin.runSucceeded', hit.name)
				: vscode.l10n.t('activity.plugin.runFailed', hit.name),
			path: vscode.workspace.asRelativePath(workspaceRoot, false) || '.',
			status: result.ok ? 'ok' : 'error',
			cwd: workspaceRoot,
			resolvedBin: exe.args[0] ?? exe.command,
			args: sanitizeAuditArgs(cmdArgs),
			exitCode: result.exitCode,
			timeoutMs: effectiveTimeoutMs,
			timedOut: result.timedOut,
		});
		return {
			ok: result.ok,
			content: result.content,
			path: vscode.workspace.asRelativePath(workspaceRoot, false) || '.',
		};
	},
};

function sanitizeAuditArgs(args: string[]): string[] {
	let redactNext = false;
	return args.map((arg) => {
		if (redactNext) {
			redactNext = false;
			return '[redacted]';
		}
		
		if (/^--?(?:token|password|passwd|secret|api[-_]?key)$/i.test(arg)) {
			redactNext = true;
			return arg;
		}

		if (/^--?(?:token|password|passwd|secret|api[-_]?key)=/i.test(arg)) {
			return `${arg.slice(0, arg.indexOf('=') + 1)}[redacted]`;
		}

		return arg.slice(0, 300);
	});
}
