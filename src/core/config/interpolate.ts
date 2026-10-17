import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Лимит размера файла для `{file:...}` по умолчанию (64 КБ)
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;

export interface InterpolateConfigStringOpts {
	// База для относительных `{file:path}` (workspace / cwd)
	cwd?: string;
	// Максимальный размер содержимого файла в байтах (символах UTF-8 после чтения)
	maxFileBytes?: number;
}

/**
 * Подставляет плейсхолдеры в строках конфига:
 * `${env:NAME}` * process.env[NAME] или '' (без throw);
 * `{file:path}` * содержимое файла (utf8), относительно workspace/cwd, с лимитом размера.
 */
export function interpolateConfigString(
	input: string,
	opts?: InterpolateConfigStringOpts,
): string {
	if (!input.includes('${') && !input.includes('{')) {
		return input;
	}

	const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const baseCwd = opts?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

	let out = input.replace(/\$\{env:([^}]+)\}/g, (_m, name: string) => {
		return process.env[name.trim()] ?? '';
	});

	out = out.replace(/\{file:([^}]+)\}/g, (_m, filePath: string) => {
		const trimmed = filePath.trim();
		if (!trimmed) {
			return '';
		}

		try {
			const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseCwd, trimmed);
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
				return '';
			}

			const content = fs.readFileSync(resolved, 'utf8');
			if (Buffer.byteLength(content, 'utf8') <= maxFileBytes) {
				return content;
			}

			// Обрезаем по байтам, не по code units
			const buf = Buffer.from(content, 'utf8').subarray(0, maxFileBytes);
			return buf.toString('utf8');
		} catch {
			return '';
		}
	});

	return out;
}
