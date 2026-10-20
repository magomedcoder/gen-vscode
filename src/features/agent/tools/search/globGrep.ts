import * as vscode from 'vscode';
import { mapLimit } from '../../../../core/util/asyncPool';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

const FIND_EXCLUDE = '**/{.gen,node_modules,.git}/**';
// Параллельные openTextDocument в grep
const GREP_CONCURRENCY = 6;

function toGlob(pattern: string): string {
	const trimmed = pattern.trim() || '**/*';
	if (/[*?\[]/.test(trimmed)) {
		return trimmed;
	}

	if (/\.[A-Za-z0-9]+$/.test(trimmed)) {
		return trimmed;
	}

	return trimmed.replace(/\/?$/, '/') + '**';
}

export const globTool: ToolDefinition = {
	name: 'glob',
	description: 'Найти файлы по glob внутри workspace (без чтения содержимого). Учитывает .gitignore / .genignore.',
	parameters: {
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description: 'Glob, например **/*.ts'
			},
			max_results: {
				type: 'integer'
			},
		},
		required: ['pattern'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const pattern = toGlob(asString(args, 'pattern', '**/*'));
		const cap = Math.min(Math.max(1, asOptionalInt(args, 'max_results') ?? AGENT_LIMITS.maxSearchFiles), AGENT_LIMITS.maxSearchFiles);
		const uris = await vscode.workspace.findFiles(pattern, FIND_EXCLUDE, cap + 1);
		const files: string[] = [];
		for (const uri of uris.slice(0, cap)) {
			throwIfAborted(ctx.signal);
			try {
				files.push((await resolveWorkspacePath(uri.fsPath)).relative);
			} catch {
				continue;
			}
		}
		return {
			ok: true,
			content: JSON.stringify({ 
				pattern, 
				truncated: uris.length > cap,
				files 
			}, null, 2),
		};
	},
};

export const grepTool: ToolDefinition = {
	name: 'grep',
	description: 'Поиск текста/regex по содержимому файлов в workspace. Для списка путей используй glob.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Подстрока или простой паттерн'
			},
			glob: {
				type: 'string',
				description: 'Ограничить glob, по умолчанию **/*'
			},
			max_results: {
				type: 'integer'
			},
		},
		required: ['query'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const query = asString(args, 'query');
		if (!query) {
			return {
				ok: false,
				content: 'grep: нужен параметр query'
			};
		}

		const glob = toGlob(asString(args, 'glob', '**/*'));
		const cap = Math.min(Math.max(1, asOptionalInt(args, 'max_results') ?? AGENT_LIMITS.maxSearchMatches), AGENT_LIMITS.maxSearchMatches);
		const uris = await vscode.workspace.findFiles(glob, FIND_EXCLUDE, AGENT_LIMITS.maxSearchFiles);
		type GrepMatch = {
			path: string
			line: number
			text: string
		};
		const needle = query.toLowerCase();
		let found = 0;
		// Bounded concurrency для openTextDocument; результаты склеиваем в порядке uris (воркеры берут индексы по возрастанию -> префикс до остановки всегда полный, как при sequential)
		const perFile = await mapLimit(uris, GREP_CONCURRENCY, async (uri): Promise<GrepMatch[]> => {
			throwIfAborted(ctx.signal);
			const fileMatches: GrepMatch[] = [];
			try {
				const resolved = await resolveWorkspacePath(uri.fsPath);
				const doc = await vscode.workspace.openTextDocument(uri);
				const text = doc.getText();
				if (text.length > AGENT_LIMITS.maxReadBytes) {
					return fileMatches;
				}

				const lines = text.split(/\r?\n/);
				for (let i = 0; i < lines.length; i += 1) {
					if (fileMatches.length >= cap) {
						break;
					}

					if (lines[i]!.toLowerCase().includes(needle)) {
						fileMatches.push({
							path: resolved.relative,
							line: i + 1,
							text: lines[i]!.slice(0, 240)
						});
					}
				}
			} catch {
				return [];
			}

			found += fileMatches.length;
			return fileMatches;
		}, () => found >= cap);

		const matches: GrepMatch[] = [];
		for (const chunk of perFile) {
			if (!chunk) {
				continue;
			}

			for (const m of chunk) {
				if (matches.length >= cap) {
					break;
				}

				matches.push(m);
			}

			if (matches.length >= cap) {
				break;
			}
		}

		return {
			ok: true,
			content: JSON.stringify({ 
				query, 
				glob, 
				truncated: matches.length >= cap, 
				matches 
			}, null, 2),
		};
	},
};
