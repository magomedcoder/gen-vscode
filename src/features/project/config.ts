import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_GENIGNORE_PATTERNS, DEFAULT_SENSITIVE_PATH_PATTERNS, EXAMPLE_DENIED_COMMANDS } from '../../core/config/types';

export const GEN_DIR_RELATIVE = '.gen';
export const GEN_CONFIG_RELATIVE = '.gen/config.json';
export const GEN_IGNORE_RELATIVE = '.genignore';
export const GEN_CONFIG_VERSION = 1;

const GEN_IGNORE_CONTENT = `# .genignore - пути/папки, недоступные агенту Gen
# Синтаксис как у .gitignore. Не путать с .gen/config.json (команды / redact).
#
${DEFAULT_GENIGNORE_PATTERNS.join('\n')}
`;

/**
 * `.gen/` directories (scaffold) - создаются командой `gen.initProject` и `/init`.
 * Индекс кодовой базы в workspace storage и не требует `.gen/`.
 * `references.json` пишется по требованию (не здесь).
 */
export const GEN_SCAFFOLD_DIRS = ['agents', 'personas', 'commands', 'plugins', 'skills', 'tools', 'references', 'plans', 'scratch'] as const;

const HOOKS_TEMPLATE = `${JSON.stringify({
	'$schema': 'https://raw.githubusercontent.com/magomedcoder/gen-vscode/main/schemas/gen-hooks.schema.json',
	beforeSubmit: [],
	beforeShell: [],
}, null, 2)}\n`;

const SHELL_TEMPLATE = `${JSON.stringify({
	'$schema': 'https://raw.githubusercontent.com/magomedcoder/gen-vscode/main/schemas/gen-shell.schema.json',
	version: 1,
	profiles: {},
}, null, 2)}\n`;

// Краткое описание структуры `.gen/` (RU + EN); не перезаписываем существующее
const GEN_README_CONTENT = `# \`.gen/\` - Gen Agent

Project files for Gen / файлы проекта Gen.

| Dir | EN | RU |
| --- | --- | --- |
| \`agents/\` | Custom agents (\`*.md\`) | Кастомные агенты |
| \`personas/\` | Custom personas (\`*.md\`) | Кастомные персоны |
| \`commands/\` | Slash commands (\`*.md\`) | Slash-команды |
| \`plugins/\` | \`*/plugin.json\` (+ optional \`PLUGIN.md\`) | Локальные плагины |
| \`skills/\` | Skills (\`SKILL.md\`) | Skills |
| \`tools/\` | \`*.md\` or \`*/TOOL.md\` | Локальные tools |
| \`references/\` | Per-alias reference JSON | JSON ссылок по alias |
| \`plans/\` | Multi-file plans | Планы агента |
| \`scratch/\` | Ephemeral scripts (\`run_scratch\`) | Одноразовые скрипты |

Also under workspace root: \`.genignore\` (ignore paths/folders for the agent; gitignore syntax).

Inside \`.gen/\`: \`config.json\` (\`deniedCommands\`, \`sensitivePathPatterns\`, \`secretPatterns\`, other settings - not path ignore), \`hooks.json\`, \`shell.json\`, \`references.json\` (on demand), \`plan.md\`.

Path/folder ignore -> edit \`.genignore\` (not \`config.json\`).
Commands / redact patterns -> edit \`.gen/config.json\` by hand (not Settings UI).

Index / project map caches live in VSCode workspace storage (\`storageUri\`), not under \`.gen/\`.
`;

/**
 * Проектный `.gen/config.json`: маркер проектного слоя и необязательное наложение GenSettings.
 * Известные ключи объединяются в эффективной конфигурации (см. `src/config/layers.ts`, FILE_LAYER_KEYS).
 * Не нужен для фоновой индексации.
 */
export interface GenProjectConfig {
	version: number;
	createdAt: string;
	// Путь к hooks.json (относительно workspace или абсолютный)
	hooksPath?: string;
	// Встроенные hooks (как в hooks.json)
	hooks?: Record<string, unknown>;
	// Прочие известные ключи GenSettings
	[key: string]: unknown;
}

function folderFsPath(explicit?: string): string | undefined {
	return explicit ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Записать файл только если его ещё нет (не перезаписывать)
async function writeIfMissing(filePath: string, content: string): Promise<void> {
	try {
		await fs.access(filePath);
	} catch {
		await fs.writeFile(filePath, content, 'utf8');
	}
}

/**
 * Создать каталоги `.gen/{agents,commands,...}` + `.gitkeep` и краткий README.
 * Идемпотентно: существующие файлы не трогаем.
 */
export async function ensureGenScaffold(
	folderPath?: string,
	options: { seedTemplates?: boolean } = {},
): Promise<void> {
	const root = folderFsPath(folderPath);
	if (!root) {
		return;
	}

	const genRoot = path.join(root, GEN_DIR_RELATIVE);
	await fs.mkdir(genRoot, { recursive: true });
	await writeIfMissing(path.join(genRoot, 'README.md'), GEN_README_CONTENT);
	if (options.seedTemplates !== false) {
		await writeIfMissing(path.join(genRoot, 'hooks.json'), HOOKS_TEMPLATE);
		await writeIfMissing(path.join(genRoot, 'shell.json'), SHELL_TEMPLATE);
	}

	for (const dir of GEN_SCAFFOLD_DIRS) {
		const dirPath = path.join(genRoot, dir);
		await fs.mkdir(dirPath, { recursive: true });
		await writeIfMissing(path.join(dirPath, '.gitkeep'), '');
	}
}

// Есть ли `.gen/config.json` (проектное наложение, hooks, заготовка agents)
export async function isProjectEnabled(folderPath?: string): Promise<boolean> {
	const root = folderFsPath(folderPath);
	if (!root) {
		return false;
	}

	try {
		await fs.access(path.join(root, GEN_CONFIG_RELATIVE));
		return true;
	} catch {
		return false;
	}
}

export async function enableProject(folderPath?: string): Promise<vscode.WorkspaceFolder | undefined> {
	const folder = folderPath
		? vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === folderPath)
		: vscode.workspace.workspaceFolders?.[0];

	if (!folder) {
		return undefined;
	}

	const root = folder.uri.fsPath;
	await ensureGenScaffold(root);
	await writeIfMissing(path.join(root, GEN_IGNORE_RELATIVE), GEN_IGNORE_CONTENT);

	const configPath = path.join(root, GEN_CONFIG_RELATIVE);
	try {
		await fs.access(configPath);
	} catch {
		const config: GenProjectConfig = {
			version: GEN_CONFIG_VERSION,
			createdAt: new Date().toISOString(),
			// Команды / redact / sensitive write - не path-ignore (path-ignore = .genignore)
			sensitivePathPatterns: [...DEFAULT_SENSITIVE_PATH_PATTERNS],
			deniedCommands: [...EXAMPLE_DENIED_COMMANDS],
			secretPatterns: [],
		};
		const { saveConfigLayerJson } = await import('../../core/config/layers');
		await saveConfigLayerJson(configPath, config);
	}

	return folder;
}
