import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const GEN_DIR_RELATIVE = '.gen';
export const GEN_CONFIG_RELATIVE = '.gen/config.json';
export const GEN_CONFIG_VERSION = 1;

/**
 * Каталоги MVP под `.gen/` - создаются командой `gen.initProject` и `/init`.
 * Индекс кодовой базы в workspace storage и не требует `.gen/`.
 * `references.json` пишется по требованию (не здесь).
 */
export const GEN_SCAFFOLD_DIRS = ['agents', 'commands', 'plugins', 'skills', 'tools', 'references', 'plans', 'scratch'] as const;

// Краткое описание layout `.gen/` (RU + EN); не перезаписываем, если уже есть
const GEN_README_CONTENT = `# \`.gen/\` - Gen Agent

Project files for Gen / файлы проекта Gen.

| Dir | EN | RU |
| --- | --- | --- |
| \`agents/\` | Custom agents (\`*.md\`) | Кастомные агенты |
| \`commands/\` | Slash commands (\`*.md\`) | Slash-команды |
| \`plugins/\` | \`*/plugin.json\` (+ optional \`PLUGIN.md\`) | Локальные плагины |
| \`skills/\` | Skills (\`SKILL.md\`) | Skills |
| \`tools/\` | \`*.md\` or \`*/TOOL.md\` | Локальные tools |
| \`references/\` | Per-alias reference JSON | JSON ссылок по alias |
| \`plans/\` | Multi-file plans | Планы агента |
| \`scratch/\` | Ephemeral scripts (\`run_scratch\`) | Одноразовые скрипты |

Also: \`config.json\` (opt-in), \`hooks.json\`, \`shell.json\` (env profiles), \`references.json\` (on demand), \`plan.md\`.

Index / project map caches live in VS Code workspace storage (\`storageUri\`), not under \`.gen/\`.
`;

/**
 * Project `.gen/config.json`: маркер наличия project-слоя + опциональный overlay GenSettings.
 * Известные ключи мержатся в effective config (см. `src/config/layers.ts`, FILE_LAYER_KEYS).
 * Не нужен для фоновой индексации.
 */
export interface GenProjectConfig {
	version: number;
	createdAt: string;
	// Путь к hooks.json (относительно workspace или абсолютный)
	hooksPath?: string;
	// Inline-хуки (как в hooks.json)
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
export async function ensureGenScaffold(folderPath?: string): Promise<void> {
	const root = folderFsPath(folderPath);
	if (!root) {
		return;
	}

	const genRoot = path.join(root, GEN_DIR_RELATIVE);
	await fs.mkdir(genRoot, { recursive: true });
	await writeIfMissing(path.join(genRoot, 'README.md'), GEN_README_CONTENT);

	for (const dir of GEN_SCAFFOLD_DIRS) {
		const dirPath = path.join(genRoot, dir);
		await fs.mkdir(dirPath, { recursive: true });
		await writeIfMissing(path.join(dirPath, '.gitkeep'), '');
	}
}

// Есть ли `.gen/config.json` (project overlay / hooks / agents scaffold)
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

	const configPath = path.join(root, GEN_CONFIG_RELATIVE);
	try {
		await fs.access(configPath);
	} catch {
		const config: GenProjectConfig = {
			version: GEN_CONFIG_VERSION,
			createdAt: new Date().toISOString(),
		};
		await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	}

	return folder;
}
