import * as vscode from 'vscode';
import { getSettings } from '../../../../core/config/settings';
import { recordActivity } from '../../../../core/stores/activityStore';
import { previewText } from '../../policy';
import { asOptionalInt, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';

import { throwIfAborted } from '../../workspacePath';
import { listIndexableFiles, readIndexableText } from '../../../index/scanner';
import { parseWithTreeSitter } from '../../../index/treeSitter';
import { buildImportGraph, findImportCycles, findOrphanFiles, importSpecsFromTreeSitterSpans, isGraphPath, isMostlyReExportFile, matchesIgnorePatterns, repoHealthCacheKey } from './repoHealthCore';

const DEFAULT_MAX_FILES = 800;

type CachedReport = {
	key: string;
	at: number;
	report: Record<string, unknown>;
};

const reportCache = new Map<string, CachedReport>();
const CACHE_TTL_MS = 60_000;

// Циклы импортов TS/JS (+ Python/Go relative) + orphans -> JSON.
export const repoHealthTool: ToolDefinition = {
	name: 'repo_health',
	description: 'Скан TS/JS/Python/Go: циклы импортов и orphan-файлы. JS/TS: Tree-sitter spans + regex; меньше FP на barrel re-export. JSON-отчёт. Учитывает watcherIgnore + ignore[].',
	parameters: {
		type: 'object',
		properties: {
			max_files: {
				type: 'integer',
				description: `Макс. файлов для анализа (по умолчанию ${DEFAULT_MAX_FILES})`,
			},
			ignore: {
				type: 'array',
				items: { type: 'string' },
				description: 'Доп. gitignore-подобные паттерны (поверх settings.watcherIgnore)',
			},
			no_cache: {
				type: 'boolean',
				description: 'Пропустить in-memory кэш (TTL 60s)',
			},
			write_report: {
				type: 'boolean',
				description: 'Write the full report to .gen/reports/repo-health-*.json',
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
				content: 'repo_health: нет workspace folder',
			};
		}

		const maxFiles = Math.min(2_000, Math.max(50, asOptionalInt(args, 'max_files') ?? DEFAULT_MAX_FILES));
		const extraIgnore = Array.isArray(args.ignore)
			? args.ignore.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
			: [];
		const ignorePatterns = [...getSettings().watcherIgnore, ...extraIgnore];

		const scanned = await listIndexableFiles(folder);
		const graphAll = scanned
			.map((f) => f.relative)
			.filter((rel) => isGraphPath(rel))
			.filter((rel) => !matchesIgnorePatterns(rel, ignorePatterns));
		const graphFiles = scanned
			.filter((f) => isGraphPath(f.relative) && !matchesIgnorePatterns(f.relative, ignorePatterns))
			.slice(0, maxFiles);

		const cacheKey = `${folder.uri.fsPath}:${repoHealthCacheKey(
			graphFiles.map((f) => f.relative),
			ignorePatterns,
		)}:${maxFiles}`;
		const noCache = args.no_cache === true;
		if (!noCache) {
			const hit = reportCache.get(cacheKey);
			if (hit && Date.now() - hit.at < CACHE_TTL_MS && args.write_report !== true) {
				recordActivity({
					kind: 'tool',
					toolName: 'repo_health',
					label: vscode.l10n.t(
						'activity.repoHealth.summaryCached',
						String(hit.report.cycleCount ?? 0),
						String(hit.report.orphanCount ?? 0),
					),
					status: 'ok',
				});
				return {
					ok: true,
					content: previewText(
						JSON.stringify({ ...hit.report, cached: true }, null, 2),
						12_000,
					),
				};
			}
		}

		const sources: Array<{ path: string; source: string; treeSitterImportSpecs?: string[] }> = [];
		const barrelReExports = new Set<string>();
		let treeSitterUsed = 0;

		for (const file of graphFiles) {
			throwIfAborted(ctx.signal);
			const text = await readIndexableText(file.uri);
			if (text === undefined) {
				continue;
			}

			let treeSitterImportSpecs: string[] | undefined;
			if (/\.(?:[cm]?[jt]s|tsx|jsx)$/i.test(file.relative)) {
				try {
					const parsed = await parseWithTreeSitter(file.relative, text);
					if (parsed?.spans?.length) {
						treeSitterImportSpecs = importSpecsFromTreeSitterSpans(text, parsed.spans);
						treeSitterUsed += 1;
					}
				} catch {}
				
				if (isMostlyReExportFile(text)) {
					barrelReExports.add(file.relative);
				}
			}

			sources.push({
				path: file.relative,
				source: text,
				treeSitterImportSpecs,
			});
		}

		const graph = buildImportGraph(sources);
		const cycles = findImportCycles(graph, { skipBarrelReExports: barrelReExports });
		const orphans = findOrphanFiles(graph, { ignorePatterns });

		const report = {
			scanned: sources.length,
			scannedJs: sources.filter((s) => /\.(?:[cm]?[jt]s|tsx|jsx)$/i.test(s.path)).length,
			scannedPython: sources.filter((s) => /\.py$/i.test(s.path)).length,
			scannedGo: sources.filter((s) => /\.go$/i.test(s.path)).length,
			capped: graphAll.length > maxFiles,
			ignoredPatterns: ignorePatterns.slice(0, 40),
			treeSitterFiles: treeSitterUsed,
			barrelReExportsSkipped: barrelReExports.size,
			cycleCount: cycles.length,
			cycles: cycles.slice(0, 20).map((c) => c.join(' -> ')),
			orphanCount: orphans.length,
			orphans: orphans.slice(0, 80),
			cached: false,
			note: 'JS/TS: Tree-sitter spans + regex; Python/Go: relative imports; barrel re-export cycles suppressed; entrypoints/tests/stories/generated excluded from orphans',
		};

		reportCache.set(cacheKey, {
			key: cacheKey,
			at: Date.now(),
			report,
		});

		let reportPath: string | undefined;
		if (args.write_report === true) {
			const reportsDir = vscode.Uri.joinPath(folder.uri, '.gen', 'reports');
			await vscode.workspace.fs.createDirectory(reportsDir);
			reportPath = `.gen/reports/repo-health-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
			await vscode.workspace.fs.writeFile(
				vscode.Uri.joinPath(folder.uri, reportPath),
				new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`),
			);
			ctx.trackMutation?.(vscode.Uri.joinPath(folder.uri, reportPath));
		}
		
		recordActivity({
			kind: 'tool',
			toolName: 'repo_health',
			label: vscode.l10n.t('activity.repoHealth.summary', cycles.length, orphans.length),
			path: reportPath,
			status: 'ok',
		});

		return {
			ok: true,
			path: reportPath,
			content: previewText(JSON.stringify({ ...report, reportPath }, null, 2), 12_000),
		};
	},
};
