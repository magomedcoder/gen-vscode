import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
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

function truncateUtf8(content: string, maxFileBytes: number): string {
	if (Buffer.byteLength(content, 'utf8') <= maxFileBytes) {
		return content;
	}

	// Обрезаем по байтам, не по code units
	return Buffer.from(content, 'utf8').subarray(0, maxFileBytes).toString('utf8');
}

function resolveFileRefPath(filePath: string, baseCwd: string): string | undefined {
	const trimmed = filePath.trim();
	if (!trimmed) {
		return undefined;
	}

	return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseCwd, trimmed);
}

// Кэш содержимого `{file:}` для async-пути: валидируется stat (mtime+size), не читает файл повторно
type FileRefCacheEntry = {
	mtimeMs: number;
	size: number;
	value: string
};
const FILE_REF_CACHE_MAX = 32;
const fileRefCache = new Map<string, FileRefCacheEntry>();

async function readFileRefAsync(resolved: string, maxFileBytes: number): Promise<string> {
	try {
		const st = await fsp.stat(resolved);
		if (!st.isFile()) {
			return '';
		}

		const key = `${resolved}\0${maxFileBytes}`;
		const hit = fileRefCache.get(key);
		if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
			return hit.value;
		}

		const value = truncateUtf8(await fsp.readFile(resolved, 'utf8'), maxFileBytes);
		if (fileRefCache.size >= FILE_REF_CACHE_MAX) {
			const oldest = fileRefCache.keys().next().value;
			if (oldest !== undefined) {
				fileRefCache.delete(oldest);
			}
		}

		fileRefCache.set(key, { 
			mtimeMs: st.mtimeMs, 
			size: st.size, 
			value 
		});
		return value;
	} catch {
		return '';
	}
}

// Тесты / смена файлов вне stat-гранулярности
export function clearInterpolateFileCache(): void {
	fileRefCache.clear();
}

/**
 * Async-версия interpolateConfigString: `{file:}` читается через fs/promises + кэш (stat mtime/size).
 * Для горячих async путей (secrets / HTTP); sync-версия остаётся для sync-контекстов и тестов.
 */
export async function interpolateConfigStringAsync(
	input: string,
	opts?: InterpolateConfigStringOpts,
): Promise<string> {
	if (!input.includes('${') && !input.includes('{')) {
		return input;
	}

	const maxFileBytes = opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const baseCwd = opts?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	const withEnv = input.replace(/\$\{env:([^}]+)\}/g, (_m, name: string) => process.env[name.trim()] ?? '');
	const refs = [...withEnv.matchAll(/\{file:([^}]+)\}/g)];
	if (refs.length === 0) {
		return withEnv;
	}

	const values = await Promise.all(refs.map(async (m) => {
		const resolved = resolveFileRefPath(m[1]!, baseCwd);
		return resolved ? readFileRefAsync(resolved, maxFileBytes) : '';
	}));
	
	let i = 0;
	return withEnv.replace(/\{file:([^}]+)\}/g, () => values[i++] ?? '');
}

/**
 * Подставляет плейсхолдеры в строках конфига (sync; для async-контекстов см. interpolateConfigStringAsync):
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
