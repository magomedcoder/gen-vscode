import * as vscode from 'vscode';
import { applySearchReplace } from '../../patch';
import { asBoolean, asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

function cellLanguageMeta(cellLanguage: string): { kind: vscode.NotebookCellKind; languageId: string } {
	const lang = cellLanguage.trim().toLowerCase() || 'python';
	if (lang === 'markdown' || lang === 'md') {
		return {
			kind: vscode.NotebookCellKind.Markup,
			languageId: 'markdown',
		};
	}

	if (lang === 'raw') {
		return {
			kind: vscode.NotebookCellKind.Markup,
			languageId: 'raw',
		};
	}

	return {
		kind: vscode.NotebookCellKind.Code,
		languageId: lang,
	};
}

function cellSource(cell: vscode.NotebookCell): string {
	return cell.document.getText();
}

async function editViaNotebookApi(
	uri: vscode.Uri,
	cellIdx: number,
	isNewCell: boolean,
	cellLanguage: string,
	oldString: string,
	newString: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
	const notebook = await vscode.workspace.openNotebookDocument(uri);
	const meta = cellLanguageMeta(cellLanguage);
	const edit = new vscode.WorkspaceEdit();

	if (isNewCell) {
		if (cellIdx < 0 || cellIdx > notebook.cellCount) {
			return {
				ok: false,
				message: `edit_notebook: cell_idx=${cellIdx} вне диапазона вставки 0..${notebook.cellCount}`,
			};
		}

		const cellData = new vscode.NotebookCellData(meta.kind, newString, meta.languageId);
		edit.set(uri, [vscode.NotebookEdit.insertCells(cellIdx, [cellData])]);
		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			return {
				ok: false,
				message: 'edit_notebook: не удалось вставить ячейку',
			};
		}

		return {
			ok: true,
			message: `Ячейка вставлена по индексу ${cellIdx} (язык: ${meta.languageId})`,
		};
	}

	if (cellIdx < 0 || cellIdx >= notebook.cellCount) {
		return {
			ok: false,
			message: `edit_notebook: cell_idx=${cellIdx} вне диапазона 0..${notebook.cellCount - 1}`,
		};
	}

	const cell = notebook.cellAt(cellIdx);
	const original = cellSource(cell);
	let next: {
		text: string;
		count: number
	};
	try {
		next = applySearchReplace(original, oldString, newString, false);
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}

	const languageId = cellLanguage.trim() ? meta.languageId : cell.document.languageId;
	const kind = cellLanguage.trim() ? meta.kind : cell.kind;
	const cellData = new vscode.NotebookCellData(kind, next.text, languageId);
	edit.set(uri, [vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(cellIdx, cellIdx + 1), [cellData])]);
	const applied = await vscode.workspace.applyEdit(edit);
	if (!applied) {
		return {
			ok: false,
			message: 'edit_notebook: не удалось заменить ячейку',
		};
	}

	return {
		ok: true,
		message: `Ячейка ${cellIdx} обновлена (${next.count} замен)`,
	};
}

type IpynbCell = {
	cell_type?: string;
	source?: string | string[];
	metadata?: Record<string, unknown>;
	outputs?: unknown[];
	execution_count?: number | null;
};

function sourceToString(source: string | string[] | undefined): string {
	if (source === undefined) {
		return '';
	}

	return Array.isArray(source) ? source.join('') : String(source);
}

function stringToSourceLines(text: string): string[] {
	if (!text) {
		return [];
	}

	const lines = text.split(/(?<=\n)/);
	return lines.length > 0 ? lines : [text];
}

async function editViaFsJson(
	uri: vscode.Uri,
	cellIdx: number,
	isNewCell: boolean,
	cellLanguage: string,
	oldString: string,
	newString: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
	const raw = await vscode.workspace.fs.readFile(uri);
	let nb: { 
		cells?: IpynbCell[]
		[key: string]: unknown
	};
	try {
		nb = JSON.parse(Buffer.from(raw).toString('utf8')) as { 
			cells?: IpynbCell[] 
		};
	} catch {
		return {
			ok: false,
			message: 'edit_notebook: некорректный JSON .ipynb',
		};
	}

	if (!Array.isArray(nb.cells)) {
		nb.cells = [];
	}

	const lang = cellLanguage.trim().toLowerCase() || 'python';
	const isMarkdown = lang === 'markdown' || lang === 'md';

	if (isNewCell) {
		if (cellIdx < 0 || cellIdx > nb.cells.length) {
			return {
				ok: false,
				message: `edit_notebook: cell_idx=${cellIdx} вне диапазона вставки 0..${nb.cells.length}`,
			};
		}

		const cell: IpynbCell = {
			cell_type: isMarkdown ? 'markdown' : lang === 'raw' ? 'raw' : 'code',
			metadata: lang && !isMarkdown && lang !== 'raw' ? { 
				language_info: { 
					name: lang 
				} 
			} : {},
			source: stringToSourceLines(newString),
		};
		if (cell.cell_type === 'code') {
			cell.outputs = [];
			cell.execution_count = null;
		}

		nb.cells.splice(cellIdx, 0, cell);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(nb, null, 1)}\n`, 'utf8'));
		return {
			ok: true,
			message: `Ячейка вставлена по индексу ${cellIdx} (через JSON)`,
		};
	}

	if (cellIdx < 0 || cellIdx >= nb.cells.length) {
		return {
			ok: false,
			message: `edit_notebook: cell_idx=${cellIdx} вне диапазона 0..${nb.cells.length - 1}`,
		};
	}

	const cell = nb.cells[cellIdx]!;
	const original = sourceToString(cell.source);
	let next: { 
		text: string; 
		count: number 
	};
	try {
		next = applySearchReplace(original, oldString, newString, false);
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}

	cell.source = stringToSourceLines(next.text);
	if (cellLanguage.trim()) {
		cell.cell_type = isMarkdown ? 'markdown' : lang === 'raw' ? 'raw' : 'code';
	}

	await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(nb, null, 1)}\n`, 'utf8'));
	return {
		ok: true,
		message: `Ячейка ${cellIdx} обновлена (${next.count} замен, через JSON)`,
	};
}

export const editNotebookTool: ToolDefinition = {
	name: 'edit_notebook',
	description: 'Править ячейку Jupyter (.ipynb): заменить old_string на new_string в ячейке cell_idx или вставить новую ячейку (is_new_cell=true). cell_idx с 0.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к .ipynb',
			},
			cell_idx: {
				type: 'integer',
				description: 'Индекс ячейки с 0 (для вставки - позиция вставки)',
			},
			is_new_cell: {
				type: 'boolean',
				description: 'true - вставить новую ячейку с new_string; false - править существующую',
			},
			cell_language: {
				type: 'string',
				description: 'Язык ячейки: python, markdown, javascript, raw и т.п.',
			},
			old_string: {
				type: 'string',
				description: 'Уникальный фрагмент в ячейке (для правки; при is_new_cell можно пустой)',
			},
			new_string: {
				type: 'string',
				description: 'Новый фрагмент / содержимое новой ячейки',
			},
		},
		required: ['path', 'cell_idx', 'is_new_cell', 'cell_language', 'old_string', 'new_string'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const cellIdx = asOptionalInt(args, 'cell_idx');
		const isNewCell = asBoolean(args, 'is_new_cell');
		const cellLanguage = asString(args, 'cell_language');
		const oldString = asString(args, 'old_string');
		const newString = asString(args, 'new_string');

		if (cellIdx === undefined || cellIdx < 0) {
			return {
				ok: false,
				content: 'edit_notebook: нужен неотрицательный cell_idx',
			};
		}

		if (!cellLanguage.trim()) {
			return {
				ok: false,
				content: 'edit_notebook: нужен cell_language',
			};
		}

		if (!isNewCell && !oldString) {
			return {
				ok: false,
				content: 'edit_notebook: для правки нужен непустой old_string',
			};
		}

		if (!(await pathExists(resolved.uri))) {
			return {
				ok: false,
				path: resolved.relative,
				content: `Файл не найден: ${resolved.relative}`,
			};
		}

		// Confirm только в executeAgentTool - без второй карточки Always/Apply

		throwIfAborted(ctx.signal);

		let outcome: { 
			ok: true
			message: string 
		} | { 
			ok: false
			message: string 
		};
		try {
			outcome = await editViaNotebookApi(resolved.uri, cellIdx, isNewCell, cellLanguage, oldString, newString);
		} catch (err) {
			try {
				outcome = await editViaFsJson(resolved.uri, cellIdx, isNewCell, cellLanguage, oldString, newString);
			} catch (fsErr) {
				return {
					ok: false,
					path: resolved.relative,
					content: `edit_notebook: ${err instanceof Error ? err.message : String(err)}; fallback: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`,
				};
			}
		}

		if (!outcome.ok) {
			// API вернул ошибку (не исключение) - попробуем запасной JSON для .ipynb
			if (resolved.relative.toLowerCase().endsWith('.ipynb')) {
				try {
					outcome = await editViaFsJson(resolved.uri, cellIdx, isNewCell, cellLanguage, oldString, newString);
				} catch {
					return {
						ok: false,
						path: resolved.relative,
						content: outcome.message,
					};
				}
			} else {
				return {
					ok: false,
					path: resolved.relative,
					content: outcome.message,
				};
			}
		}

		if (!outcome.ok) {
			return {
				ok: false,
				path: resolved.relative,
				content: outcome.message,
			};
		}

		ctx.trackMutation?.(resolved.uri);
		if (ctx.revealFile) {
			await ctx.revealFile(resolved.uri);
		}

		return {
			ok: true,
			path: resolved.relative,
			content: `${outcome.message}: ${resolved.relative}`,
		};
	},
};
