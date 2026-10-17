import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';

function pathIsInside(child: string, parent: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Локальные plugins/tools и npm-каталог с осторожным выполнением в runtime.
 *
 * Конвенция:
 * - Инструменты:
 *   - `.gen/tools/<name>.md` - однофайловое описание (YAML frontmatter: name, description)
 *   - `.gen/tools/<name>/TOOL.md` - пакет в папке
 * - Плагины:
 *   - `.gen/plugins/<name>/plugin.json` - манифест (обязательная точка обнаружения) { "name"?, "description"?, "instructions"? }
 *   - если `instructions` пуст - тело берётся из соседнего `PLUGIN.md`
 * - npm-пакеты:
 *   - `package.json` с полем `gen` или `genAgent` (объект / строка имени; опц. args/bin)
 *   - `.gen/npm-plugins.json` - список разрешённых точных версий пакетов и необязательный SHA-256 бинарника
 *   - выполнение: только объявленный бинарник пакета в workspace/node_modules (инструмент `run_plugin`); без require() в хосте
 */

export type LocalPluginKind = 'tool' | 'plugin' | 'npm';

// Объявленный spawn для npm-плагина (пути должны резолвиться под workspace)
export interface NpmPluginExecutable {
	command: string;
	args: string[];
	// Абсолютный корень пакета для резолва относительных args (под workspace)
	packageRoot: string;
	// SHA-256 проверенного объявленного bin
	binDigest: string;
}

export interface LocalPluginInfo {
	kind: LocalPluginKind;
	name: string;
	description: string;
	// Путь к главному файлу (md или plugin.json) относительно workspace
	path: string;
	body: string;
	// Только kind=npm: объявленная команда для run_plugin
	executable?: NpmPluginExecutable;
}

const MAX_BODY_CHARS = 16_000;
const MAX_ITEMS = 60;

const TOOL_GLOBS = [
	'.gen/tools/*.md',
	'.gen/tools/*/TOOL.md',
];

const PLUGIN_GLOB = '.gen/plugins/*/plugin.json';

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
	if (!match) {
		return { body: raw.trim() };
	}

	const meta = match[1]!;
	const body = match[2]!.trim();
	const name = /^\s*name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const description = /^\s*description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	return { name, description, body };
}

function truncateBody(body: string): string {
	if (body.length <= MAX_BODY_CHARS) {
		return body;
	}

	return `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`;
}

function folderNameFromUri(uri: vscode.Uri): string {
	const parts = uri.path.split('/').filter(Boolean);
	return parts[parts.length - 2] ?? 'item';
}

function fileStem(uri: vscode.Uri): string {
	const base = uri.path.split('/').pop() ?? 'item';
	return base.replace(/\.md$/i, '');
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

async function readToolMd(uri: vscode.Uri, seen: Set<string>, out: LocalPluginInfo[]): Promise<void> {
	const raw = await readText(uri);
	if (raw === undefined) {
		return;
	}

	const parsed = parseFrontmatter(raw);
	const isToolFile = /\/TOOL\.md$/i.test(uri.path);
	const name = (parsed.name || (isToolFile ? folderNameFromUri(uri) : fileStem(uri))).trim();
	const key = name.toLowerCase();
	if (!name || seen.has(key)) {
		return;
	}

	seen.add(key);
	out.push({
		kind: 'tool',
		name,
		description: parsed.description || name,
		path: vscode.workspace.asRelativePath(uri),
		body: truncateBody(parsed.body),
	});
}

interface PluginManifest {
	name?: string;
	description?: string;
	instructions?: string;
}

function parsePluginJson(raw: string): PluginManifest | undefined {
	try {
		const data = JSON.parse(raw) as unknown;
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			return undefined;
		}

		const obj = data as Record<string, unknown>;
		return {
			name: typeof obj.name === 'string' ? obj.name.trim() : undefined,
			description: typeof obj.description === 'string' ? obj.description.trim() : undefined,
			instructions: typeof obj.instructions === 'string' ? obj.instructions : undefined,
		};
	} catch {
		return undefined;
	}
}

async function readPluginJson(uri: vscode.Uri, seen: Set<string>, out: LocalPluginInfo[]): Promise<void> {
	const raw = await readText(uri);
	if (raw === undefined) {
		return;
	}

	const manifest = parsePluginJson(raw);
	if (!manifest) {
		return;
	}

	const folder = folderNameFromUri(uri);
	const name = (manifest.name || folder).trim();
	const key = name.toLowerCase();
	if (!name || seen.has(key)) {
		return;
	}

	let body = (manifest.instructions ?? '').trim();
	if (!body) {
		const parts = uri.path.split('/');
		parts[parts.length - 1] = 'PLUGIN.md';
		const pluginMd = uri.with({ path: parts.join('/') });
		const mdRaw = await readText(pluginMd);
		if (mdRaw !== undefined) {
			const parsed = parseFrontmatter(mdRaw);
			body = parsed.body;
			if (!manifest.description && parsed.description) {
				manifest.description = parsed.description;
			}
		}
	}

	seen.add(key);
	out.push({
		kind: 'plugin',
		name,
		description: manifest.description || name,
		path: vscode.workspace.asRelativePath(uri),
		body: truncateBody(body),
	});
}

function pushNpmEntry(
	seen: Set<string>,
	out: LocalPluginInfo[],
	entry: {
		name: string;
		description?: string;
		path: string;
		body?: string;
		executable?: NpmPluginExecutable;
	},
): void {
	const name = entry.name.trim();
	const key = `npm:${name.toLowerCase()}`;
	if (!name || seen.has(key) || out.length >= MAX_ITEMS) {
		return;
	}

	seen.add(key);
	const canRun = Boolean(entry.executable);
	out.push({
		kind: 'npm',
		name,
		description: (entry.description || name).trim(),
		path: entry.path,
		body: truncateBody(
			entry.body?.trim()
			|| (canRun
				? `(npm plugin) run via tool run_plugin; no require() into extension host.`
				: '(npm plugin catalog only - exact version / declared bin / integrity check did not pass)'),
		),
		...(entry.executable ? { executable: entry.executable } : {}),
	});
}

interface ParsedGenPluginField {
	name: string;
	description?: string;
	args?: string[];
	bin?: string;
}

function parseGenPluginField(raw: unknown, pkgName: string): ParsedGenPluginField | undefined {
	if (typeof raw === 'string' && raw.trim()) {
		return { name: raw.trim(), description: `npm package ${pkgName}` };
	}

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}

	const obj = raw as Record<string, unknown>;
	const name = typeof obj.name === 'string' && obj.name.trim()
		? obj.name.trim()
		: pkgName.trim();
	if (!name) {
		return undefined;
	}

	const description = typeof obj.description === 'string' ? obj.description.trim() : undefined;
	const args = Array.isArray(obj.args)
		? obj.args.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
		: undefined;
	const bin = typeof obj.bin === 'string' && obj.bin.trim()
		? obj.bin.trim()
		: undefined;
	return {
		name,
		description: description || `npm package ${pkgName}`,
		...(args && args.length ? { args } : {}),
		...(bin ? { bin } : {}),
	};
}

function workspaceRootFs(folder: vscode.WorkspaceFolder): string {
	return folder.uri.fsPath;
}

function assertPathInsideWorkspace(absPath: string, workspaceRoot: string): string {
	const resolved = path.resolve(absPath);
	if (!pathIsInside(resolved, workspaceRoot)) {
		throw new Error(`path outside workspace: ${resolved}`);
	}

	return resolved;
}

async function resolveBinFromPackage(
	packageRoot: string,
	binName: string | undefined,
	workspaceRoot: string,
	expectedVersion: string,
	expectedIntegrity?: string,
): Promise<{ command: string; args: string[]; digest: string } | undefined> {
	const pkgRaw = await readText(vscode.Uri.file(path.join(packageRoot, 'package.json')));
	if (pkgRaw === undefined) {
		return undefined;
	}

	try {
		const data = JSON.parse(pkgRaw) as Record<string, unknown>;
		if (typeof data.version !== 'string' || data.version !== expectedVersion) {
			return undefined;
		}

		const binField = data.bin;
		let scriptRel: string | undefined;
		if (typeof binField === 'string' && binField.trim()) {
			scriptRel = binField.trim();
		} else if (binField && typeof binField === 'object' && !Array.isArray(binField)) {
			const map = binField as Record<string, unknown>;
			const preferred = binName?.trim();
			if (preferred && typeof map[preferred] === 'string') {
				scriptRel = String(map[preferred]).trim();
			} else {
				const first = Object.values(map).find((v): v is string => typeof v === 'string' && v.trim().length > 0);
				scriptRel = first?.trim();
			}
		}
		if (!scriptRel) {
			return undefined;
		}

		const scriptAbs = assertPathInsideWorkspace(path.resolve(packageRoot, scriptRel), workspaceRoot);
		const script = await vscode.workspace.fs.readFile(vscode.Uri.file(scriptAbs));
		const digest = createHash('sha256').update(script).digest('hex');
		if (expectedIntegrity && digest !== normalizeSha256(expectedIntegrity)) {
			return undefined;
		}

		return { 
			command: 'node', 
			args: [scriptAbs], 
			digest 
		};
	} catch {
		return undefined;
	}
}

interface TrustedPlugin {
	packageName: string;
	version: string;
	integrity?: string;
}

function normalizeSha256(raw: string): string {
	return raw.trim().toLowerCase().replace(/^sha256[=:-]/, '');
}

function parseTrustedPlugin(raw: string): TrustedPlugin | undefined {
	const trimmed = raw.trim();
	const hashAt = trimmed.indexOf('#sha256=');
	const spec = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
	const integrity = hashAt >= 0 ? trimmed.slice(hashAt + 1) : undefined;
	const versionAt = spec.lastIndexOf('@');
	if (versionAt <= 0 || versionAt === spec.length - 1) {
		return undefined;
	}

	const packageName = spec.slice(0, versionAt);
	const version = spec.slice(versionAt + 1);
	if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(packageName)) {
		return undefined;
	}

	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
		return undefined;
	}

	if (integrity && !/^sha256=[a-fA-F0-9]{64}$/.test(integrity)) {
		return undefined;
	}

	return { packageName, version, ...(integrity ? { integrity } : {}) };
}

function trustedFromConfig(packageName: string): TrustedPlugin | undefined {
	return getSettings().trustedPlugins
		.map(parseTrustedPlugin)
		.find((entry) => entry?.packageName === packageName);
}

/**
 * Собрать spawn-спеку executable. Относительные args резолвятся под packageRoot; все пути к файлам - внутри workspace.
 * Command фиксирован на Node runtime; первый arg приходит только из declared package bin.
 */
export function buildNpmPluginExecutable(params: {
	workspaceRoot: string;
	packageRoot: string;
	command?: string;
	args?: string[];
	binDigest?: string;
}): NpmPluginExecutable {
	const workspaceRoot = path.resolve(params.workspaceRoot);
	const packageRoot = assertPathInsideWorkspace(params.packageRoot, workspaceRoot);
	const commandRaw = (params.command ?? 'node').trim();
	if (commandRaw !== 'node') {
		throw new Error('npm plugins may execute only a declared package bin with the Node runtime');
	}

	const command = 'node';

	const args = (params.args ?? []).map((arg) => {
		const a = arg.trim();
		if (!a) {
			return a;
		}

		// Резолв относительных file-like args относительно корня пакета; флаги без изменений
		if (a.startsWith('-')) {
			return a;
		}

		if (a.includes('/') || a.includes('\\') || /\.\w{1,10}$/.test(a) || path.isAbsolute(a)) {
			const abs = path.isAbsolute(a) ? a : path.resolve(packageRoot, a);
			return assertPathInsideWorkspace(abs, workspaceRoot);
		}
		return a;
	});

	return { 
		command, 
		args, 
		packageRoot, 
		binDigest: params.binDigest ?? '' 
	};
}

async function discoverNpmPluginsFromPackageJson(
	folder: vscode.WorkspaceFolder,
	seen: Set<string>,
	out: LocalPluginInfo[],
): Promise<void> {
	const workspaceRoot = workspaceRootFs(folder);
	const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json');
	const raw = await readText(pkgUri);
	if (raw === undefined) {
		return;
	}

	try {
		const data = JSON.parse(raw) as Record<string, unknown>;
		const pkgName = typeof data.name === 'string' ? data.name : 'package';
		const field = data.gen ?? data.genAgent;
		const parsed = parseGenPluginField(field, pkgName);
		if (!parsed) {
			return;
		}

		const trusted = trustedFromConfig(pkgName);
		if (!trusted) {
			return;
		}

		let executable: NpmPluginExecutable | undefined;
		try {
			const fromBin = await resolveBinFromPackage(
				workspaceRoot,
				parsed.bin,
				workspaceRoot,
				trusted.version,
				trusted.integrity,
			);
			if (fromBin) {
				executable = buildNpmPluginExecutable({
					workspaceRoot,
					packageRoot: workspaceRoot,
					command: fromBin.command,
					args: [...fromBin.args, ...(parsed.args ?? [])],
					binDigest: fromBin.digest,
				});
			}
		} catch {
			executable = undefined;
		}

		pushNpmEntry(seen, out, {
			name: parsed.name,
			description: parsed.description,
			path: 'package.json',
			body: executable
				? `Объявлено в package.json (${data.gen ? 'gen' : 'genAgent'}), разрешено trustedPlugins. Запуск: tool run_plugin.`
				: `Объявлено в package.json, но declared bin/version/integrity не прошли проверку.`,
			executable,
		});
	} catch {}
}

async function discoverNpmPluginsList(
	folder: vscode.WorkspaceFolder,
	seen: Set<string>,
	out: LocalPluginInfo[],
): Promise<void> {
	const workspaceRoot = workspaceRootFs(folder);
	const listUri = vscode.Uri.joinPath(folder.uri, '.gen', 'npm-plugins.json');
	const raw = await readText(listUri);
	if (raw === undefined) {
		return;
	}

	try {
		const data = JSON.parse(raw) as unknown;
		const items = Array.isArray(data)
			? data
			: data && typeof data === 'object' && Array.isArray((data as { plugins?: unknown }).plugins)
				? (data as { plugins: unknown[] }).plugins
				: [];
		for (const item of items) {
			if (typeof item === 'string' && item.trim()) {
				const trusted = parseTrustedPlugin(item);
				if (!trusted) {
					continue;
				}

				const packageRoot = path.join(workspaceRoot, 'node_modules', trusted.packageName);
				let executable: NpmPluginExecutable | undefined;
				try {
					const fromBin = await resolveBinFromPackage(
						packageRoot,
						undefined,
						workspaceRoot,
						trusted.version,
						trusted.integrity,
					);
					if (fromBin) {
						executable = buildNpmPluginExecutable({
							workspaceRoot,
							packageRoot,
							command: fromBin.command,
							args: fromBin.args,
							binDigest: fromBin.digest,
						});
					}
				} catch {
					executable = undefined;
				}
				pushNpmEntry(seen, out, {
					name: trusted.packageName,
					path: '.gen/npm-plugins.json',
					executable,
				});
				continue;
			}

			if (!item || typeof item !== 'object' || Array.isArray(item)) {
				continue;
			}

			const row = item as Record<string, unknown>;
			const name = typeof row.name === 'string' ? row.name.trim() : '';
			if (!name) {
				continue;
			}

			const packageName = typeof row.package === 'string' && row.package.trim()
				? row.package.trim()
				: name;
			const version = typeof row.version === 'string' ? row.version.trim() : '';
			const integrity = typeof row.integrity === 'string' ? row.integrity.trim() : undefined;
			if (!parseTrustedPlugin(`${packageName}@${version}${integrity ? `#sha256=${normalizeSha256(integrity)}` : ''}`)) {
				continue;
			}
			
			const description = typeof row.description === 'string'
				? row.description.trim()
				: `package ${packageName}`;
			const packageRoot = path.join(workspaceRoot, 'node_modules', packageName);
			const args = Array.isArray(row.args)
				? row.args.filter((a): a is string => typeof a === 'string')
				: undefined;
			const bin = typeof row.bin === 'string' ? row.bin.trim() : undefined;

			let executable: NpmPluginExecutable | undefined;
			try {
				const fromBin = await resolveBinFromPackage(
					packageRoot,
					bin,
					workspaceRoot,
					version,
					integrity,
				);
				if (fromBin) {
					executable = buildNpmPluginExecutable({
						workspaceRoot,
						packageRoot,
						command: fromBin.command,
						args: [...fromBin.args, ...(args ?? [])],
						binDigest: fromBin.digest,
					});
				}
			} catch {
				executable = undefined;
			}

			pushNpmEntry(seen, out, {
				name,
				description,
				path: '.gen/npm-plugins.json',
				executable,
			});
		}
	} catch {}
}

// Резолв executable npm-плагина по имени из каталога (для run_plugin)
export async function resolveNpmPluginExecutable(name: string): Promise<LocalPluginInfo | undefined> {
	const items = await discoverLocalPlugins();
	const key = name.trim().toLowerCase();
	return items.find((item) => item.kind === 'npm' && item.name.toLowerCase() === key && item.executable);
}

// Обнаружить локальные tools (`.gen/tools`) и plugins (`.gen/plugins`) + npm catalog
export async function discoverLocalPlugins(): Promise<LocalPluginInfo[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const out: LocalPluginInfo[] = [];
	const seen = new Set<string>();

	for (const glob of TOOL_GLOBS) {
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, glob),
			undefined,
			MAX_ITEMS,
		);
		for (const uri of uris) {
			// не подхватывать TOOL.md через `*.md` в корне tools (нет: *.md только один уровень)
			await readToolMd(uri, seen, out);
			if (out.length >= MAX_ITEMS) {
				return out.sort(comparePlugins);
			}
		}
	}

	const pluginUris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, PLUGIN_GLOB),
		undefined,
		MAX_ITEMS,
	);
	for (const uri of pluginUris) {
		await readPluginJson(uri, seen, out);
		if (out.length >= MAX_ITEMS) {
			return out.sort(comparePlugins);
		}
	}

	await discoverNpmPluginsFromPackageJson(folder, seen, out);
	if (out.length < MAX_ITEMS) {
		await discoverNpmPluginsList(folder, seen, out);
	}

	return out.sort(comparePlugins);
}

function comparePlugins(a: LocalPluginInfo, b: LocalPluginInfo): number {
	const order = (k: LocalPluginKind) => (k === 'tool' ? 0 : k === 'plugin' ? 1 : 2);
	if (a.kind !== b.kind) {
		return order(a.kind) - order(b.kind);
	}

	return a.name.localeCompare(b.name, 'ru');
}

// Каталог для system prompt (RU)
export function formatPluginsCatalog(items: LocalPluginInfo[]): string | undefined {
	if (items.length === 0) {
		return undefined;
	}

	const lines = items.map((item) => {
		const label = item.kind === 'tool' ? 'tool' : item.kind === 'plugin' ? 'plugin' : 'npm';
		const runHint = item.kind === 'npm' && item.executable ? ' [run_plugin]' : '';
		return `- [${label}] ${item.name}: ${item.description} (${item.path})${runHint}`;
	});
	return [
		'Локальные plugins/tools (описание; JS не require в host).',
		'npm из allowlist с exact version и declared bin: tool run_plugin (spawn под workspace, с подтверждением shell).',
		'`.gen/tools` - prompt-макросы (инструкции модели), не исполняемый host JS.',
		'Иначе загрузи инструкции через tool plugin по имени или read_file:',
		...lines,
	].join('\n');
}
