import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { fetchHttpsText } from './fetchHttpsText';
import { formatGenRulesForPrompt, GENRULES_RELATIVE, MAX_GENRULES_CHARS, normalizeGenRulesText } from './genrules';

const RULE_FILES = [
	GENRULES_RELATIVE,
	'AGENTS.md',
];

const USER_AGENTS_RELATIVE = path.join('.config', 'gen', 'AGENTS.md');
const MAX_INSTRUCTION_URL_CHARS = 12_000;
const MAX_INSTRUCTION_URLS = 8;

// Кандидат правил для UI настроек (без чтения содержимого)
export interface RuleCandidate {
	label: string;
	path: string;
	exists: boolean;
}

export interface RuleHeadingConflict {
	heading: string;
	sources: string[];
}

// Подготовка предпросмотра в Settings: заголовки Markdown могут дублироваться в независимо объединённых источниках правил.
export function detectRuleHeadingConflicts(
	sources: Array<{ source: string; text: string }>,
): RuleHeadingConflict[] {
	const headings = new Map<string, { heading: string; sources: Set<string> }>();
	for (const item of sources) {
		for (const line of item.text.split(/\r?\n/)) {
			const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
			if (!match) {
				continue;
			}

			const heading = match[1]!.trim();
			const key = heading.toLocaleLowerCase();
			const entry = headings.get(key) ?? { heading, sources: new Set<string>() };
			entry.sources.add(item.source);
			headings.set(key, entry);
		}
	}
	
	return [...headings.values()]
		.filter((entry) => entry.sources.size > 1)
		.map((entry) => ({ 
			heading: entry.heading, 
			sources: [...entry.sources] 
		}));
}

export async function previewRulesMergeConflicts(): Promise<RuleHeadingConflict[]> {
	const sources: Array<{ source: string; text: string }> = [];
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder) {
		for (const rel of RULE_FILES) {
			const text = await readText(vscode.Uri.joinPath(folder.uri, rel));
			if (text) {
				sources.push({ source: rel, text });
			}
		}
	}

	const userText = await readUserAgentsMd();
	if (userText) {
		sources.push({ 
			source: '~/.config/gen/AGENTS.md', 
			text: userText 
		});
	}

	for (const raw of getSettings().instructionUrls.slice(0, MAX_INSTRUCTION_URLS)) {
		const result = await fetchHttpsText(raw, MAX_INSTRUCTION_URL_CHARS);
		if (result.ok) {
			sources.push({ 
				source: `remote:${result.url}`, 
				text: result.text 
			});
		}
	}

	return detectRuleHeadingConflicts(sources);
}

async function pathExistsUri(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function pathExistsFs(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

// Список путей правил, которые могут попасть в prompt (только stat, без чтения текста)
export async function listRulesCandidates(): Promise<RuleCandidate[]> {
	const out: RuleCandidate[] = [];
	const folder = vscode.workspace.workspaceFolders?.[0];

	if (folder) {
		for (const rel of RULE_FILES) {
			const uri = vscode.Uri.joinPath(folder.uri, rel);
			out.push({
				label: rel,
				path: uri.fsPath,
				exists: await pathExistsUri(uri),
			});
		}
	} else {
		for (const rel of RULE_FILES) {
			out.push({ 
				label: rel, 
				path: rel, 
				exists: false
			});
		}
	}

	const userPath = path.join(os.homedir(), USER_AGENTS_RELATIVE);
	out.push({
		label: '~/.config/gen/AGENTS.md',
		path: userPath,
		exists: await pathExistsFs(userPath),
	});

	const urls = getSettings().instructionUrls.slice(0, MAX_INSTRUCTION_URLS);
	for (const url of urls) {
		const trimmed = url.trim();
		if (!trimmed) {
			continue;
		}
		out.push({
			label: `remote:${trimmed}`,
			path: trimmed,
			exists: true,
		});
	}

	return out;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

async function readUserAgentsMd(): Promise<string | undefined> {
	const filePath = path.join(os.homedir(), USER_AGENTS_RELATIVE);
	try {
		return await fs.readFile(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

async function loadInstructionUrlsAppendix(): Promise<string[]> {
	const urls = getSettings().instructionUrls.slice(0, MAX_INSTRUCTION_URLS);
	if (urls.length === 0) {
		return [];
	}

	const chunks: string[] = [];
	for (const url of urls) {
		const result = await fetchHttpsText(url, MAX_INSTRUCTION_URL_CHARS);
		if (!result.ok) {
			continue;
		}

		const normalized = normalizeGenRulesText(result.text);
		if (normalized) {
			chunks.push(`### remote:${result.url}\n${normalized}`);
		}
	}
	return chunks;
}

// Собрать .genrules, AGENTS.md, user-level и instructionUrls в приложение к prompt
export async function loadProjectRulesAppendix(): Promise<string | undefined> {
	const chunks: string[] = [];
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder) {
		for (const rel of RULE_FILES) {
			const text = await readText(vscode.Uri.joinPath(folder.uri, rel));
			const normalized = text ? normalizeGenRulesText(text) : undefined;
			if (normalized) {
				chunks.push(`### ${rel}\n${normalized}`);
			}
		}
	}

	// Пользовательские правила - после проектных
	const userText = await readUserAgentsMd();
	const userNormalized = userText ? normalizeGenRulesText(userText) : undefined;
	if (userNormalized) {
		chunks.push(`### ~/.config/gen/AGENTS.md\n${userNormalized}`);
	}

	chunks.push(...(await loadInstructionUrlsAppendix()));

	if (chunks.length === 0) {
		return undefined;
	}

	let merged = chunks.join('\n\n');
	if (merged.length > MAX_GENRULES_CHARS * 2) {
		merged = `${merged.slice(0, MAX_GENRULES_CHARS * 2)}\n\n[Gen: rules truncated]`;
	}

	return formatGenRulesForPrompt(merged);
}
