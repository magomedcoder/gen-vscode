import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getGenRulesManager } from '../../../project/genrules';
import { asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';

function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export const reportBugTool: ToolDefinition = {
	name: 'report_bug',
	description: 'Записать баг-репорт в `.gen/bug-reports/` (markdown) для пользователя/команды.',
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string' },
			body: { 
				type: 'string', 
				description: 'Описание, шаги, ожидаемое/фактическое' 
			},
		},
		required: ['title', 'body'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const root = workspaceRoot();
		if (!root) {
			return makeToolError(vscode.l10n.t('policy.noWorkspace'), {
				code: 'no_workspace',
				category: 'validation',
				retryable: false,
			});
		}

		const title = asString(args, 'title').trim() || 'bug';
		const body = asString(args, 'body').trim();
		const dir = path.join(root, '.gen', 'bug-reports');
		await fs.mkdir(dir, { recursive: true });
		const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bug';
		const file = path.join(dir, `${Date.now()}-${slug}.md`);
		const content = `# ${title}\n\n${body}\n`;
		await fs.writeFile(file, content, 'utf8');
		const rel = path.relative(root, file).replace(/\\/g, '/');
		return { ok: true, content: `report_bug wrote ${rel}` };
	},
};

export const newRuleTool: ToolDefinition = {
	name: 'new_rule',
	description: 'Добавить правило в `.genrules` (создаёт файл при отсутствии).',
	parameters: {
		type: 'object',
		properties: {
			rule: { 
				type: 'string', 
				description: 'Текст правила (одна или несколько строк)' 
			},
		},
		required: ['rule'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const root = workspaceRoot();
		if (!root) {
			return makeToolError(vscode.l10n.t('policy.noWorkspace'), {
				code: 'no_workspace',
				category: 'validation',
				retryable: false,
			});
		}

		const rule = asString(args, 'rule').trim();
		if (!rule) {
			return makeToolError('rule is empty', {
				code: 'invalid_args',
				category: 'validation',
				retryable: false,
			});
		}

		const file = path.join(root, '.genrules');
		let existing = '';
		try {
			existing = await fs.readFile(file, 'utf8');
		} catch {
			existing = '';
		}

		const block = rule.startsWith('-') || rule.startsWith('*') ? rule : `- ${rule}`;
		const next = existing.trim() ? `${existing.trimEnd()}\n${block}\n` : `${block}\n`;
		await fs.writeFile(file, next, 'utf8');
		void getGenRulesManager()?.reload();

		return { 
			ok: true, 
			content: `new_rule appended to .genrules (${block.split('\n').length} line(s))` 
		};
	},
};
