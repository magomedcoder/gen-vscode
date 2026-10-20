/**
 * Pure helpers для paste/drop путей в Composer (без vscode).
 * Host-resolve абсолютных URI - в resolveComposerAttach.ts.
 */

export function quoteMentionPathArg(path: string): string {
	const p = path.trim();
	if (!/[\s@]/.test(p)) {
		return p;
	}

	if (!p.includes('"')) {
		return `"${p}"`;
	}

	if (!p.includes("'")) {
		return `'${p}'`;
	}

	return `\`${p.replace(/`/g, '')}\``;
}

// Алиас для mentions / suggest - квотировать путь с пробелами
export const formatMentionPathArg = quoteMentionPathArg;

export function normalizePastedPath(raw: string): string {
	let path = raw.trim();
	if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")) || (path.startsWith('`') && path.endsWith('`'))) {
		path = path.slice(1, -1).trim();
	}

	if (/^file:\/\//i.test(path)) {
		try {
			path = decodeURIComponent(path.replace(/^file:\/\//i, ''));
			// file:///C:/... на Windows
			if (/^\/[A-Za-z]:\//.test(path)) {
				path = path.slice(1);
			}
		} catch {
			path = path.replace(/^file:\/\//i, '');
		}
	}

	return path.replace(/\\/g, '/');
}

// Нужен host, чтобы сделать путь относительным workspace / отличить folder
export function needsHostPathResolve(path: string): boolean {
	const p = path.trim();
	if (!p) {
		return false;
	}

	if (/^(file:|vscode-file:|vscode-resource:)/i.test(p)) {
		return true;
	}

	if (/^[A-Za-z]:\//.test(p)) {
		return true;
	}

	// Unix absolute (не relative ./ ../)
	if (p.startsWith('/') && !p.startsWith('//')) {
		return true;
	}

	return false;
}

/**
 * Эвристика: одна строка без переносов, похожа на путь к файлу.
 * Ctrl+Shift+V в Composer обходит конвертацию в chip.
 */
export function looksLikeFilePath(text: string): string | undefined {
	if (!text || /[\r\n]/.test(text)) {
		return undefined;
	}

	const path = normalizePastedPath(text);
	if (!path) {
		return undefined;
	}

	if (/^(https?:|mailto:|data:)/i.test(path)) {
		return undefined;
	}

	const hasSep = /[/\\]/.test(path)
		|| /^[A-Za-z]:\//.test(path)
		|| path.startsWith('~/')
		|| path.startsWith('./')
		|| path.startsWith('../');

	const hasExt = /\.[A-Za-z0-9]{1,12}$/.test(path);

	if (!/^[\w./:@~+\-\s]+$/.test(path) && !/^[A-Za-z]:\/[\w./@~+\-\s]*$/.test(path)) {
		return undefined;
	}

	if (hasExt || hasSep) {
		return path;
	}

	return undefined;
}

// Разобрать text/uri-list (и построчный text/plain со списком URI)
export function parseUriList(raw: string): string[] {
	const out: string[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) {
			continue;
		}

		out.push(t);
	}

	return out;
}

/**
 * Извлечь URI/пути из DataTransfer-подобных type->data.
 * Поддержка: text/uri-list, resourceurls (VS Code), text/plain.
 */
export function extractPathsFromTransferData(getData: (type: string) => string): string[] {
	const found: string[] = [];
	const push = (value: string) => {
		const v = value.trim();
		if (v && !found.includes(v)) {
			found.push(v);
		}
	};

	const uriList = getData('text/uri-list');
	if (uriList) {
		for (const u of parseUriList(uriList)) {
			push(u);
		}
	}

	// VS Code Explorer -> webview
	for (const type of ['resourceurls', 'application/vnd.code.uris']) {
		const raw = getData(type);
		if (!raw) {
			continue;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (typeof item === 'string') {
						push(item);
					} else if (item && typeof item === 'object' && typeof (item as { external?: string }).external === 'string') {
						push((item as { external: string }).external);
					}
				}
			}
		} catch {}
	}

	const plain = getData('text/plain');
	if (plain) {
		if (!/[\r\n]/.test(plain.trim())) {
			const asPath = looksLikeFilePath(plain);
			if (asPath) {
				push(asPath);
			} else if (/^(file:|vscode-file:)/i.test(plain.trim())) {
				push(plain.trim());
			}
		} else {
			// Несколько строк URI
			const lines = parseUriList(plain);
			if (lines.length > 1 && lines.every((l) => /^(file:|vscode-file:|\/|[A-Za-z]:)/i.test(l) || looksLikeFilePath(l))) {
				for (const l of lines) {
					push(l);
				}
			}
		}
	}

	return found;
}

export function chipLabelFromPath(path: string): string {
	return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export function buildFileChipInsert(path: string, kind: 'file' | 'folder' = 'file'): string {
	return `@${kind} ${quoteMentionPathArg(path)}`;
}
