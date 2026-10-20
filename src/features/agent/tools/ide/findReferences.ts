import * as path from 'node:path';
import * as vscode from 'vscode';
import { mapLimit } from '../../../../core/util/asyncPool';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { relativeFromUri, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

// Размер страницы references по умолчанию (ещё жёстко capped через AGENT_LIMITS.maxDiagnostics)
export const FIND_REFERENCES_DEFAULT_LIMIT = 40;
// Параллельные LSP reference/definition запросы по anchors
const FIND_REFERENCES_CONCURRENCY = 3;

export interface FindReferencesPaging {
	limit: number;
	offset: number;
}

export interface PagedResult<T> {
	items: T[];
	total: number;
	limit: number;
	offset: number;
	hasMore: boolean;
	nextOffset: number | null;
}

/**
 * Нормализовать limit/offset для find_references.
 * Принимает `limit` + `offset`, либо `page` (0-based) вместо offset.
 */
export function normalizeFindReferencesPaging(
	args: Record<string, unknown>,
	defaults: { defaultLimit?: number; maxLimit?: number } = {},
): FindReferencesPaging {
	const defaultLimit = defaults.defaultLimit ?? FIND_REFERENCES_DEFAULT_LIMIT;
	const maxLimit = defaults.maxLimit ?? AGENT_LIMITS.maxDiagnostics;

	const rawLimit = asOptionalInt(args, 'limit');
	const limit = Math.min(
		maxLimit,
		Math.max(1, rawLimit === undefined ? defaultLimit : rawLimit),
	);

	const rawOffset = asOptionalInt(args, 'offset');
	const rawPage = asOptionalInt(args, 'page');
	let offset = 0;
	if (rawOffset !== undefined && rawOffset >= 0) {
		offset = rawOffset;
	} else if (rawPage !== undefined && rawPage >= 0) {
		offset = rawPage * limit;
	}

	return { limit, offset };
}

export function pageItems<T>(items: readonly T[], paging: FindReferencesPaging): PagedResult<T> {
	const total = items.length;
	const { limit, offset } = paging;
	const safeOffset = Math.max(0, Math.min(offset, total));
	const sliced = items.slice(safeOffset, safeOffset + limit);
	const next = safeOffset + sliced.length;
	const hasMore = next < total;

	return {
		items: sliced,
		total,
		limit,
		offset: safeOffset,
		hasMore,
		nextOffset: hasMore ? next : null,
	};
}

// Сопоставить workspace folder по имени или fsPath (имя без регистра; путь - prefix/exact)
export function matchWorkspaceFolders(
	folders: readonly vscode.WorkspaceFolder[],
	folderOrRoot: string | undefined,
): vscode.WorkspaceFolder[] {
	const q = (folderOrRoot ?? '').trim();
	if (!q) {
		return [...folders];
	}

	const qLower = q.toLowerCase();
	const qNorm = path.resolve(q);
	const matched = folders.filter((f) => {
		if (f.name.toLowerCase() === qLower) {
			return true;
		}
		const fp = f.uri.fsPath;
		return fp === q || path.resolve(fp) === qNorm || fp.toLowerCase() === qLower;
	});

	return matched;
}

function locationKey(loc: vscode.Location | vscode.LocationLink): string {
	if (loc instanceof vscode.Location) {
		return `${loc.uri.toString()}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
	}

	const r = loc.targetSelectionRange ?? loc.targetRange;
	return `${loc.targetUri.toString()}:${r.start.line}:${r.start.character}:${r.end.line}:${r.end.character}`;
}

function dedupeLocations(items: Array<vscode.Location | vscode.LocationLink>): Array<vscode.Location | vscode.LocationLink> {
	const seen = new Set<string>();
	const out: Array<vscode.Location | vscode.LocationLink> = [];
	for (const item of items) {
		const key = locationKey(item);
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		out.push(item);
	}

	return out;
}

function locationPayload(loc: vscode.Location | vscode.LocationLink): Record<string, unknown> {
	if (loc instanceof vscode.Location) {
		return {
			uri: loc.uri.toString(),
			range: {
				start: {
					line: loc.range.start.line,
					character: loc.range.start.character,
				},
				end: {
					line: loc.range.end.line,
					character: loc.range.end.character,
				},
			},
		};
	}
	const target = loc.targetSelectionRange ?? loc.targetRange;
	return {
		uri: loc.targetUri.toString(),
		range: {
			start: {
				line: target.start.line,
				character: target.start.character,
			},
			end: {
				line: target.end.line,
				character: target.end.character,
			},
		},
	};
}

async function enrichLocations(
	items: Array<vscode.Location | vscode.LocationLink>,
): Promise<Array<Record<string, unknown>>> {
	const out: Array<Record<string, unknown>> = [];
	for (const item of items) {
		const base = locationPayload(item);
		try {
			const uri = item instanceof vscode.Location ? item.uri : item.targetUri;
			base.path = await relativeFromUri(uri);
		} catch {
			base.path = null;
		}
		out.push(base);
	}
	return out;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

// Относительный путь -> существующие URI в каждом workspace folder (multi-root)
async function resolvePathInFolders(
	relativePath: string,
	folders: readonly vscode.WorkspaceFolder[],
): Promise<Array<{ uri: vscode.Uri; folder: vscode.WorkspaceFolder; relative: string }>> {
	const trimmed = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
	if (!trimmed) {
		return [];
	}

	// Абсолютный / уже уникальный: один resolveWorkspacePath
	if (path.isAbsolute(trimmed) || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
		const resolved = await resolveWorkspacePath(trimmed);
		return [{
			uri: resolved.uri,
			folder: resolved.folder,
			relative: resolved.relative
		}];
	}

	const out: Array<{
		uri: vscode.Uri;
		folder: vscode.WorkspaceFolder;
		relative: string
	}> = [];
	for (const folder of folders) {
		const uri = vscode.Uri.joinPath(folder.uri, ...trimmed.split('/').filter(Boolean));
		if (await uriExists(uri)) {
			out.push({ uri, folder, relative: trimmed });
		}
	}

	// Запасной путь: резолв через первую папку (policy / symlink / ignore), если по existence ничего не нашли
	if (!out.length && folders.length) {
		try {
			const resolved = await resolveWorkspacePath(trimmed);
			if (folders.some((f) => f.uri.toString() === resolved.folder.uri.toString()) || folders.length === 1) {
				out.push({
					uri: resolved.uri,
					folder: resolved.folder,
					relative: resolved.relative
				});
			}
		} catch {}
	}

	return out;
}

function findSymbolPositionInSymbols(
	symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined,
	symbol: string,
): vscode.Position | undefined {
	const q = symbol.toLowerCase();
	let found: vscode.Position | undefined;

	const walk = (items: vscode.DocumentSymbol[]): void => {
		for (const s of items) {
			if (found) {
				return;
			}

			if (s.name.toLowerCase() === q || s.name.toLowerCase().includes(q)) {
				found = s.selectionRange.start;
				return;
			}

			if (s.children?.length) {
				walk(s.children);
			}
		}
	};

	for (const sym of symbols ?? []) {
		if (found) {
			break;
		}
		if (sym instanceof vscode.DocumentSymbol) {
			walk([sym]);
		} else if (sym.name.toLowerCase() === q || sym.name.toLowerCase().includes(q)) {
			found = sym.location.range.start;
		}
	}

	return found;
}

async function resolvePositionInDocument(
	doc: vscode.TextDocument,
	symbol: string,
	line: number | undefined,
	character: number | undefined,
): Promise<{ line: number; character: number } | { error: string }> {
	if (line !== undefined && character !== undefined && line >= 0 && character >= 0) {
		return { line, character };
	}

	if (!symbol) {
		return { error: 'find_references: нужен line+character (0-based) или symbol для резолва позиции' };
	}

	const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined>('vscode.executeDocumentSymbolProvider', doc.uri);

	let found = findSymbolPositionInSymbols(symbols, symbol);

	if (!found) {
		const text = doc.getText();
		const idx = text.indexOf(symbol);
		if (idx >= 0) {
			found = doc.positionAt(idx);
		}
	}

	if (!found) {
		return {
			error: `find_references: символ «${symbol}» не найден в ${doc.uri.fsPath}`
		};
	}

	return {
		line: found.line,
		character: found.character
	};
}

// Поиск символа по всему workspace (cross-lang, если LSP отдаёт WorkspaceSymbol)
async function resolveViaWorkspaceSymbol(
	symbol: string,
	folders: readonly vscode.WorkspaceFolder[],
): Promise<Array<{ uri: vscode.Uri; position: vscode.Position; name: string }>> {
	const hits = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
		'vscode.executeWorkspaceSymbolProvider',
		symbol,
	);

	const folderUris = new Set(folders.map((f) => f.uri.toString()));
	const q = symbol.toLowerCase();
	const out: Array<{ uri: vscode.Uri; position: vscode.Position; name: string }> = [];

	for (const hit of hits ?? []) {
		const uri = hit.location.uri;
		const containing = vscode.workspace.getWorkspaceFolder(uri);
		if (!containing || !folderUris.has(containing.uri.toString())) {
			continue;
		}

		const name = hit.name;
		if (name.toLowerCase() !== q && !name.toLowerCase().includes(q)) {
			continue;
		}
		out.push({
			uri,
			position: hit.location.range.start,
			name,
		});
	}

	// Сначала точные совпадения имени
	const exact = out.filter((h) => h.name.toLowerCase() === q);
	return exact.length ? exact : out;
}

async function collectRefsAndDefs(
	uri: vscode.Uri,
	pos: vscode.Position,
	includeDefinition: boolean,
	signal?: AbortSignal,
): Promise<{
	refs: Array<vscode.Location | vscode.LocationLink>;
	defs: Array<vscode.Location | vscode.LocationLink>;
}> {
	throwIfAborted(signal);
	const refs = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
		'vscode.executeReferenceProvider',
		uri,
		pos,
	);
	let defs: Array<vscode.Location | vscode.LocationLink> = [];
	if (includeDefinition) {
		throwIfAborted(signal);
		defs = (await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | undefined>('vscode.executeDefinitionProvider', uri, pos)) ?? [];
	}

	return {
		refs: refs ?? [],
		defs
	};
}

/**
 * Резолв имени символа в позицию definition через document/workspace symbols, затем references.
 * Multi-root: опциональный folder/root; без него - все workspace folders.
 * Пагинация: limit + offset (или page).
 */
export const findReferencesTool: ToolDefinition = {
	name: 'find_references',
	description: 'Кто вызывает / ссылается на символ: vscode.executeReferenceProvider (+ definition). path+line+character, path+symbol, или только symbol (workspace symbols). Multi-root: folder/root; paging: limit/offset.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Файл в workspace (относительно корня); при multi-root ищется во всех folder, если не задан folder/root',
			},
			folder: {
				type: 'string',
				description: 'Имя или путь workspace folder (alias: root); сужает multi-root поиск',
			},
			root: {
				type: 'string',
				description: 'Alias для folder - workspace root name/path',
			},
			line: {
				type: 'integer',
				description: 'Строка 0-based (если задана вместе с character)',
			},
			character: {
				type: 'integer',
				description: 'Колонка 0-based',
			},
			symbol: {
				type: 'string',
				description: 'Имя символа - document symbols (с path) или workspace symbols (без path)',
			},
			include_definition: {
				type: 'boolean',
				description: 'Также вернуть definition (по умолчанию true)',
			},
			limit: {
				type: 'integer',
				description: `Максимум references в ответе (по умолчанию ${FIND_REFERENCES_DEFAULT_LIMIT}, max ${AGENT_LIMITS.maxDiagnostics})`,
			},
			offset: {
				type: 'integer',
				description: 'Смещение для paging references (по умолчанию 0)',
			},
			page: {
				type: 'integer',
				description: 'Альтернатива offset: 0-based page * limit (игнорируется, если задан offset)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);

		const allFolders = vscode.workspace.workspaceFolders ?? [];
		if (!allFolders.length) {
			return {
				ok: false,
				content: 'find_references: нет открытого workspace'
			};
		}

		const folderArg = asString(args, 'folder', '').trim() || asString(args, 'root', '').trim() || undefined;
		const folders = matchWorkspaceFolders(allFolders, folderArg);
		if (!folders.length) {
			return {
				ok: false,
				content: `find_references: workspace folder «${folderArg}» не найден (доступны: ${allFolders.map((f) => f.name).join(', ')})`,
			};
		}

		const pathArg = asString(args, 'path', '').trim();
		let line = asOptionalInt(args, 'line');
		let character = asOptionalInt(args, 'character');
		const symbol = asString(args, 'symbol', '').trim();
		const includeDefinition = args.include_definition !== false;
		const paging = normalizeFindReferencesPaging(args);

		if (!pathArg && !symbol && (line === undefined || character === undefined)) {
			return {
				ok: false,
				content: 'find_references: нужен path и/или symbol (и line+character при известной позиции)',
			};
		}

		type Anchor = { uri: vscode.Uri; line: number; character: number; relative: string; folderName: string };
		const anchors: Anchor[] = [];
		const searchedFolders = folders.map((f) => f.name);

		if (pathArg) {
			const candidates = await resolvePathInFolders(pathArg, folders);
			if (!candidates.length) {
				return {
					ok: false,
					content: `find_references: путь «${pathArg}» не найден в folder(s): ${searchedFolders.join(', ')}`,
				};
			}

			for (const c of candidates) {
				throwIfAborted(ctx.signal);
				const doc = await vscode.workspace.openTextDocument(c.uri);
				const pos = await resolvePositionInDocument(doc, symbol, line, character);
				if ('error' in pos) {
					if (candidates.length === 1) {
						return {
							ok: false,
							content: pos.error
						};
					}

					continue;
				}
				anchors.push({
					uri: c.uri,
					line: pos.line,
					character: pos.character,
					relative: c.relative,
					folderName: c.folder.name,
				});
			}

			if (!anchors.length) {
				return {
					ok: false,
					content: symbol
						? `find_references: символ «${symbol}» не найден в «${pathArg}» (folders: ${searchedFolders.join(', ')})`
						: 'find_references: нужен line+character (0-based) или symbol для резолва позиции',
				};
			}
		} else {
			// symbol-only (или symbol + line/character без path - line без path бессмысленен)
			const wsHits = await resolveViaWorkspaceSymbol(symbol, folders);
			if (!wsHits.length) {
				return {
					ok: false,
					content: `find_references: символ «${symbol}» не найден через workspace symbols (folders: ${searchedFolders.join(', ')}); укажи path`,
				};
			}

			// Дедуп по uri+position; приоритет первым N уникальным файлам
			const seen = new Set<string>();
			for (const hit of wsHits) {
				const key = `${hit.uri.toString()}:${hit.position.line}:${hit.position.character}`;
				if (seen.has(key)) {
					continue;
				}

				seen.add(key);
				const folder = vscode.workspace.getWorkspaceFolder(hit.uri);
				let relative = hit.uri.fsPath;
				try {
					relative = await relativeFromUri(hit.uri);
				} catch {}

				anchors.push({
					uri: hit.uri,
					line: hit.position.line,
					character: hit.position.character,
					relative,
					folderName: folder?.name ?? '?',
				});
				if (anchors.length >= 8) {
					break;
				}
			}
		}

		const primary = anchors[0]!;
		line = primary.line;
		character = primary.character;

		let allRefs: Array<vscode.Location | vscode.LocationLink> = [];
		let allDefs: Array<vscode.Location | vscode.LocationLink> = [];

		// Ограниченный параллелизм (LSP не любит fan-out), порядок anchors сохраняем при concat
		const collected = await mapLimit(anchors, FIND_REFERENCES_CONCURRENCY, async (a) => {
			throwIfAborted(ctx.signal);
			return collectRefsAndDefs(
				a.uri,
				new vscode.Position(a.line, a.character),
				includeDefinition,
				ctx.signal,
			);
		});
		for (const item of collected) {
			if (item) {
				allRefs = allRefs.concat(item.refs);
				allDefs = allDefs.concat(item.defs);
			}
		}

		allRefs = dedupeLocations(allRefs);
		allDefs = dedupeLocations(allDefs);

		const pagedRefs = pageItems(allRefs, paging);
		const references = await enrichLocations(pagedRefs.items);
		// Definitions обычно мало - отдаём целиком, но с cap
		const defsPaged = pageItems(allDefs, {
			limit: AGENT_LIMITS.maxDiagnostics,
			offset: 0,
		});
		const definitions = await enrichLocations(defsPaged.items);

		const ambiguous =
			anchors.length > 1
				? anchors.map((a) => ({
						path: a.relative,
						folder: a.folderName,
						position: { line: a.line, character: a.character },
					}))
				: undefined;

		return {
			ok: true,
			path: primary.relative,
			content: JSON.stringify(
				{
					path: primary.relative,
					folder: primary.folderName,
					foldersSearched: searchedFolders,
					position: { line, character },
					symbol: symbol || null,
					anchors: ambiguous,
					definitionCount: allDefs.length,
					definitions,
					referenceCount: pagedRefs.total,
					references,
					limit: pagedRefs.limit,
					offset: pagedRefs.offset,
					hasMore: pagedRefs.hasMore,
					nextOffset: pagedRefs.nextOffset,
					note: 'LSP reference/definition providers (cross-lang при наличии language server); multi-root + limit/offset paging',
				},
				null,
				2,
			),
		};
	},
};
