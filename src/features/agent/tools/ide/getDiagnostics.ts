import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { collectDiagnosticsForUris } from './diagnosticsSnapshot';

export const getDiagnosticsTool: ToolDefinition = {
	name: 'get_diagnostics',
	description: 'Диагностики редактора (ошибки TypeScript, ESLint и т.д.) для файла или всего workspace.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Файл. Если не задан - по всему workspace (с лимитом).',
			},
			max_results: {
				type: 'integer',
				description: 'Максимум записей',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const cap = Math.min(
			Math.max(1, asOptionalInt(args, 'max_results') ?? AGENT_LIMITS.maxDiagnostics),
			AGENT_LIMITS.maxDiagnostics,
		);
		const pathArg = asString(args, 'path');

		let uris: vscode.Uri[];
		if (pathArg) {
			const resolved = await resolveWorkspacePath(pathArg);
			uris = [resolved.uri];
		} else {
			uris = vscode.languages.getDiagnostics().map(([uri]) => uri);
		}

		const snap = await collectDiagnosticsForUris(uris, {
			max: cap,
			severities: [
				vscode.DiagnosticSeverity.Error,
				vscode.DiagnosticSeverity.Warning,
				vscode.DiagnosticSeverity.Information,
				vscode.DiagnosticSeverity.Hint,
			],
		});

		return {
			ok: true,
			content: JSON.stringify({
				truncated: snap.truncated,
				count: snap.count,
				total: snap.total,
				diagnostics: snap.diagnostics,
			}, null, 2),
		};
	},
};
