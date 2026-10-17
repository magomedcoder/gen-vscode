import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { getSettings } from '../../../../core/config/settings';
import { AGENT_LIMITS, previewText } from '../../policy';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { listIndexableFiles, readIndexableText } from '../../../index/scanner';
import { loadOutlineIndex } from '../../../index/tsOutline';
import { buildImportGraph, isGraphPath } from './repoHealthCore';
import { boostByCoverageMap, boostByImportGraph, boostByOutlineSymbols, filterIgnoredPaths, pathsFromGitPorcelain, rankRelatedTests } from './testImpactCore';

const execFileAsync = promisify(execFile);

async function loadCoverageMap(folderFs: string): Promise<Record<string, string[]> | undefined> {
	const candidates = [
		path.join(folderFs, '.gen', 'coverage-map.json'),
		path.join(folderFs, 'coverage', 'test-impact-map.json'),
	];
	for (const file of candidates) {
		try {
			const raw = await fs.readFile(file, 'utf8');
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			if (!parsed || typeof parsed !== 'object') {
				continue;
			}

			const out: Record<string, string[]> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (Array.isArray(v)) {
					out[k.replace(/\\/g, '/')] = v.filter((x): x is string => typeof x === 'string');
				}
			}

			if (Object.keys(out).length > 0) {
				return out;
			}
		} catch {
			continue;
		}
	}

	return undefined;
}

// По путям или git dirty - предложить связанные *test* / __tests__ файлы
export const testImpactTool: ToolDefinition = {
	name: 'test_impact',
	description: 'По списку путей или git dirty предложить связанные тесты (имя/путь + import-граф + outline symbols + optional .gen/coverage-map.json). Не запускает тесты. Учитывает watcherIgnore + ignore[].',
	parameters: {
		type: 'object',
		properties: {
			paths: {
				type: 'array',
				items: { type: 'string' },
				description: 'Изменённые/интересующие пути (если пусто - git status --porcelain)',
			},
			use_git_dirty: {
				type: 'boolean',
				description: 'Взять dirty из git (по умолчанию true, если paths пуст)',
			},
			ignore: {
				type: 'array',
				items: { type: 'string' },
				description: 'Доп. gitignore-подобные паттерны (поверх settings.watcherIgnore)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return {
				ok: false,
				content: 'test_impact: нет workspace folder',
			};
		}

		const explicit = Array.isArray(args.paths)
			? args.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
			: [];

		let changed = explicit.map((p) => p.replace(/\\/g, '/'));
		let source: 'paths' | 'git' = 'paths';

		const useGit = args.use_git_dirty === true || (changed.length === 0 && args.use_git_dirty !== false);
		if (changed.length === 0 && useGit) {
			try {
				const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-uall'], {
					cwd: folder.uri.fsPath,
					timeout: 8_000,
					maxBuffer: AGENT_LIMITS.maxGitOutput,
					signal: ctx.signal,
				});
				changed = pathsFromGitPorcelain(stdout);
				source = 'git';
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					ok: false,
					content: /not a git repository/i.test(msg)
						? 'test_impact: не git-репозиторий; передай paths явно'
						: `test_impact: git: ${msg}`,
				};
			}
		}

		const extraIgnore = Array.isArray(args.ignore)
			? args.ignore.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
			: [];
		const ignorePatterns = [...getSettings().watcherIgnore, ...extraIgnore];
		changed = filterIgnoredPaths(changed, ignorePatterns);

		if (changed.length === 0) {
			return {
				ok: true,
				content: JSON.stringify({
					source,
					changed: [],
					relatedTests: [],
					hits: [],
					note: 'Нет изменённых путей (после ignore)',
				}, null, 2),
			};
		}

		const allFiles = filterIgnoredPaths(
			(await listIndexableFiles(folder)).map((f) => f.relative),
			ignorePatterns,
		);
		let hits = rankRelatedTests(changed, allFiles);

		// Повышение по графу импортов (ограниченный поиск вокруг изменений и тестов)
		const interest = new Set([
			...changed.filter(isGraphPath),
			...allFiles.filter(isTestPathSafe).filter(isGraphPath).slice(0, 200),
		]);
		const graphSources: Array<{ 
			path: string; 
			source: string 
		}> = [];

		for (const rel of interest) {
			throwIfAborted(ctx.signal);
			try {
				const uri = vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
				const text = await readIndexableText(uri);
				if (text !== undefined) {
					graphSources.push({ 
						path: rel, 
						source: text 
					});
				}
			} catch {
				continue;
			}
		}
		if (graphSources.length > 0) {
			const graph = buildImportGraph(graphSources);
			hits = boostByImportGraph(hits, changed, graph);
		}

		// Символы структуры для изменённых файлов
		try {
			const outline = await loadOutlineIndex(folder.uri.fsPath);
			if (outline?.entries?.length) {
				const names = outline.entries
					.filter((e) => changed.includes(e.path.replace(/\\/g, '/')))
					.map((e) => e.name)
					.filter(Boolean);
				if (names.length > 0) {
					hits = boostByOutlineSymbols(hits, names, allFiles);
				}
			}
		} catch {}

		const coverage = await loadCoverageMap(folder.uri.fsPath);
		hits = boostByCoverageMap(hits, changed, coverage);

		return {
			ok: true,
			content: previewText(
				JSON.stringify(
					{
						source,
						changed: changed.slice(0, 80),
						ignoredPatterns: ignorePatterns.slice(0, 40),
						relatedTests: hits.map((h) => h.path),
						hits: hits.map((h) => ({
							path: h.path,
							reason: h.reason,
							score: h.score,
						})),
						coverageMap: Boolean(coverage),
						hint: hits.length
							? 'Передай relatedTests в run_tests как paths (или test_paths)'
							: 'Связанные тесты не найдены эвристикой',
					},
					null,
					2,
				),
				12_000,
			),
		};
	},
};

function isTestPathSafe(rel: string): boolean {
	const p = rel.replace(/\\/g, '/');
	return (/(?:^|\/)__tests__\//.test(p) || /\.(?:test|spec)\.[^.]+$/.test(p) || /(?:^|\/)tests?\//.test(p));
}
