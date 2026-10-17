import * as vscode from 'vscode';
import { detectTestCommand } from '../../detectTestCommand';
import { asOptionalInt, asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveCommandCwd, throwIfAborted } from '../../workspacePath';
import { runShellCommand, formatPartialShellPreview } from '../../shellExec';
import { confirmAlwaysOrSkip } from '../confirm';
import { getShellProfileEnv } from '../../../project/shellProfiles';
import { formatCommandLine } from '../../commandPolicy';
import { applyTestFilters, parseTestFailures } from './runTestsCore';

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		: [];
}

export const runTestsTool: ToolDefinition = {
	name: 'run_tests',
	description: 'Запустить тесты проекта (npm/yarn/pnpm test, go test, cargo test, pytest и т.п.). Всегда требует подтверждения.',
	parameters: {
		type: 'object',
		properties: {
			cwd: {
				type: 'string',
				description: 'Каталог проекта относительно workspace (по умолчанию корень)',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Таймаут в миллисекундах (по умолчанию 120000, максимум 300000)',
			},
			profile: {
				type: 'string',
				description: 'Имя профиля из `.gen/shell.json`',
			},
			paths: {
				type: 'array',
				items: { type: 'string' },
				description: 'Связанные тестовые файлы, например relatedTests из test_impact',
			},
			test_paths: {
				type: 'array',
				items: { type: 'string' },
				description: 'Alias для paths',
			},
			filter: {
				type: 'string',
				description: 'Имя теста / runner-specific test filter',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveCommandCwd(asString(args, 'cwd', '.'));
		const cwd = resolved.cwd;
		const detected = await detectTestCommand(cwd);
		if (!detected) {
			return makeToolError(
				vscode.l10n.t('tool.testsNotDetected'),
				{
					code: 'tests_not_detected',
					category: 'not_found',
					path: resolved.relative,
					retryable: false,
				},
			);
		}

		const paths = [...stringArray(args.paths), ...stringArray(args.test_paths)];
		const testArgs = applyTestFilters(detected, {
			paths: [...new Set(paths)],
			filter: asString(args, 'filter', ''),
		});
		const commandLine = formatCommandLine(detected.command, testArgs);
		const denied = await confirmAlwaysOrSkip(ctx, vscode.l10n.t('agent.confirm.runTests', resolved.relative || '.'), commandLine);
		if (denied) {
			return {
				...denied,
				path: resolved.relative,
			};
		}

		const profileEnv = await getShellProfileEnv({
			profileName: asString(args, 'profile', ''),
		});
		if (profileEnv.error) {
			return makeToolError(
				`shell profile: ${profileEnv.error}`,
				{
					code: 'shell_profile_invalid',
					category: 'validation',
					path: resolved.relative,
					retryable: false,
				},
			);
		}

		const result = await runShellCommand({
			command: detected.command,
			args: testArgs,
			cwd,
			timeoutMs: asOptionalInt(args, 'timeout_ms') ?? 120_000,
			signal: ctx.signal,
			env: profileEnv.env,
			onPartialOutput: ctx.onPartialOutput
				? (raw) => {
					ctx.onPartialOutput!(`${detected.label}\n${formatPartialShellPreview({ commandLine, cwd, raw })}`);
				}
				: undefined,
		});

		return {
			ok: result.ok,
			path: resolved.relative,
			content: [
				detected.label,
				result.content,
				'--- ranked_test_failures_json ---',
				JSON.stringify(parseTestFailures(result.content), null, 2),
			].join('\n'),
		};
	},
};
