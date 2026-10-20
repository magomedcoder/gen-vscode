import * as vscode from 'vscode';
import type { SubagentDef } from '../agent/subagents';

const AGENTS_GLOB = '.gen/agents/*.md';
const MAX_BODY_CHARS = 12_000;

export interface BuiltinAgentPreset {
	id: string;
	name: string;
	description: string;
	readonly: boolean;
	mode?: string;
	body: string;
}

export interface DiscoveryDiagnostic {
	path: string;
	message: string;
}

export interface GeneratedAgentSpec {
	mode: string;
	readonly: boolean;
	tools: string[];
	body: string;
}

export const BUILTIN_PRESETS: BuiltinAgentPreset[] = [
	{
		id: 'docs-researcher',
		name: 'docs-researcher',
		description: vscode.l10n.t('settings.agents.preset.docsResearcher.description'),
		readonly: true,
		mode: 'ask',
		body: [
			'# docs-researcher',
			'',
			'Ты исследователь документации. Цель - найти и кратко изложить факты из внешних docs.',
			'',
			'## Инструкции',
			'',
			'- Используй web_search, fetch_page, search_docs и read-only tools.',
			'- Не правь файлы и не запускай мутирующие команды.',
			'- Цитируй URL и ключевые фрагменты; в конце - сжатый отчёт.',
		].join('\n'),
	},
	{
		id: 'code-reviewer',
		name: 'code-reviewer',
		description: vscode.l10n.t('settings.agents.preset.codeReviewer.description'),
		readonly: true,
		mode: 'ask',
		body: [
			'# code-reviewer',
			'',
			'Ты code-reviewer. Ищи баги, риски безопасности, регрессии и пробелы в тестах.',
			'',
			'## Инструкции',
			'',
			'- Читай релевантные файлы (read/grep/glob/codebase_search).',
			'- Не вноси правки - только отчёт с приоритетами (blocker / major / nit).',
			'- Указывай пути и краткие обоснования.',
		].join('\n'),
	},
];

const RESERVED_AGENT_IDS = new Set(['explore', 'general', 'scout']);
let discoveryDiagnostics: DiscoveryDiagnostic[] = [];

export function getAgentDiscoveryDiagnostics(): DiscoveryDiagnostic[] {
	return discoveryDiagnostics.map((item) => ({ ...item }));
}

function parseFrontmatter(raw: string): {
	name?: string;
	description?: string;
	mode?: string;
	model?: string;
	readonly?: boolean;
	tools?: string[];
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
	if (!match) {
		if (raw.trimStart().startsWith('---')) {
			throw new Error(vscode.l10n.t('settings.discovery.malformedFrontmatter'));
		}
		return { 
			body: raw.trim() 
		};
	}

	const meta = match[1]!;
	const body = match[2]!.trim();
	const name = /^\s*name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const description = /^\s*description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const mode = /^\s*mode:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const model = /^\s*model:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const readonlyRaw = /^\s*readonly:\s*(.+)$/m.exec(meta)?.[1]?.trim().toLowerCase();
	const readonly = readonlyRaw === 'true' || readonlyRaw === 'yes' || readonlyRaw === '1';
	const tools = /^\s*tools:\s*(.+)$/m.exec(meta)?.[1]
		?.split(',')
		.map((tool) => tool.trim())
		.filter(Boolean);
	return { 
		name, 
		description, 
		mode, 
		model, 
		readonly, 
		tools,
		body 
	};
}

function slugifyAgentName(name: string): string {
	return name.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 48) || 'agent';
}

export function isReservedAgentId(name: string): boolean {
	return RESERVED_AGENT_IDS.has(slugifyAgentName(name));
}

export function inferGeneratedAgentSpec(description: string, input?: {
	name?: string;
	mode?: string;
	readonly?: boolean;
}): GeneratedAgentSpec {
	const text = `${input?.name ?? ''} ${description}`.toLowerCase();
	const planning = /\b(plan|planning|architect|design)\b|план|архитект/.test(text);
	const docs = /\b(docs?|documentation|research|web|api reference)\b|документ|исслед|справк/.test(text);
	const review = /\b(review|audit|inspect|analy[sz]e|diagnos|explain)\b|ревью|аудит|анализ|диагност|объясн/.test(text);
	const testing = /\b(test|qa|verification|validate)\b|тест|провер/.test(text);
	const mutating = /\b(fix|implement|build|write|edit|refactor|migrate|create|update)\b|исправ|реализ|созда|обнов|рефактор|мигрир/.test(text);
	const readonly = input?.readonly ?? (!mutating && (planning || docs || review));
	const mode = input?.mode?.trim() || (planning && readonly ? 'plan' : readonly ? 'ask' : 'agent');
	const inferredTools = docs
		? ['web_search', 'fetch_page', 'search_docs', 'read_file', 'grep', 'glob']
		: review
			? ['read_file', 'grep', 'glob', 'find_code', 'project_map', 'git_diff']
			: planning
				? ['read_file', 'grep', 'glob', 'find_code', 'project_map', 'propose_plan']
				: testing
					? ['read_file', 'grep', 'glob', 'run_tests', 'run_command', 'apply_patch']
					: ['read_file', 'grep', 'glob', 'apply_patch', 'run_command', 'run_tests'];
	const tools = readonly
		? inferredTools.filter((tool) => !['apply_patch', 'run_command', 'run_tests'].includes(tool))
		: [...new Set([...inferredTools, 'apply_patch', 'run_command', 'run_tests'])];
	const displayName = input?.name?.trim() || 'agent';
	const constraints = readonly
		? [
			'- Work read-only: never edit files or run commands that mutate the workspace.',
			'- Gather evidence before drawing conclusions.',
		]
		: [
			'- Make focused changes that directly satisfy the task.',
			'- Inspect relevant code before editing and verify the result with focused checks.',
		];
	const specialty = docs
		? '- Cite source URLs and distinguish verified facts from assumptions.'
		: review
			? '- Prioritize concrete defects, regressions, security risks, and missing tests.'
			: planning
				? '- Produce an actionable, ordered plan with affected files and validation steps.'
				: testing
					? '- Reproduce failures, identify the root cause, and run the narrowest useful tests.'
					: '- Preserve existing conventions and avoid unrelated cleanup.';

	return {
		mode,
		readonly,
		tools,
		body: [
			`# ${displayName}`,
			'',
			`You are the ${displayName} agent. ${description.trim()}`,
			'',
			'## Operating instructions',
			'',
			...constraints,
			specialty,
			`- Prefer these tools when relevant: ${tools.join(', ')}.`,
			'- Return a concise result with changed paths, evidence, checks run, and unresolved risks.',
		].join('\n'),
	};
}

function presetToSubagent(preset: BuiltinAgentPreset): SubagentDef {
	return {
		id: preset.id,
		name: preset.name,
		description: preset.description,
		readonly: preset.readonly,
		maxIterations: 16,
		prompt: [
			`Ты builtin-агент «${preset.name}».`,
			preset.body,
		].join('\n\n'),
	};
}

export function getBuiltinPreset(id: string): BuiltinAgentPreset | undefined {
	const needle = id.trim().toLowerCase();
	return BUILTIN_PRESETS.find((p) => p.id === needle || p.name.toLowerCase() === needle);
}

export function resolveBuiltinPresetSubagent(id: string): SubagentDef | undefined {
	const preset = getBuiltinPreset(id);
	return preset ? presetToSubagent(preset) : undefined;
}

// Разобрать markdown кастомного агента из `.gen/agents/`
export async function discoverCustomAgents(): Promise<SubagentDef[]> {
	discoveryDiagnostics = [];
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, AGENTS_GLOB), undefined, 40);
	const out: SubagentDef[] = [];
	const seen = new Set<string>();
	const diagnostics: DiscoveryDiagnostic[] = [];

	for (const uri of uris) {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = new TextDecoder().decode(bytes);
			const parsed = parseFrontmatter(raw);
			const fileBase = (uri.path.split('/').pop() ?? 'agent').replace(/\.md$/i, '');
			const name = (parsed.name || fileBase).trim();
			const id = slugifyAgentName(name);
			if (seen.has(id)) {
				diagnostics.push({
					path: vscode.workspace.asRelativePath(uri),
					message: vscode.l10n.t('settings.agents.error.duplicateId', id),
				});
				continue;
			}

			if (RESERVED_AGENT_IDS.has(id)) {
				diagnostics.push({
					path: vscode.workspace.asRelativePath(uri),
					message: vscode.l10n.t('settings.agents.error.reservedId', id),
				});
				continue;
			}

			seen.add(id);
			const body = parsed.body.length > MAX_BODY_CHARS
				? `${parsed.body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`
				: parsed.body;
			const modeHint = parsed.mode ? ` Режим: ${parsed.mode}.` : '';
			const modelHint = parsed.model ? ` Модель (подсказка): ${parsed.model}.` : '';
			const toolsHint = parsed.tools?.length ? ` Предпочтительные tools: ${parsed.tools.join(', ')}.` : '';
			out.push({
				id,
				name,
				description: parsed.description || name,
				readonly: parsed.readonly === true,
				maxIterations: 16,
				prompt: [
					`Ты кастомный субагент «${name}».${modeHint}${modelHint}${toolsHint}`,
					body || 'Выполни порученную подзадачу и верни краткий отчёт.',
				].join('\n\n'),
			});
		} catch (err) {
			diagnostics.push({
				path: vscode.workspace.asRelativePath(uri),
				message: err instanceof Error ? err.message : String(err),
			});
			continue;
		}
	}

	discoveryDiagnostics = diagnostics;
	return out;
}

// Создать `.gen/agents/{name}.md` из описания или builtin preset
export async function generateAgentFile(params: {
	name: string;
	description: string;
	mode?: string;
	readonly?: boolean;
}): Promise<{ 
	relativePath: string
	created: boolean
}> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error(vscode.l10n.t('settings.agents.error.noWorkspace'));
	}

	const preset = getBuiltinPreset(params.name);
	const id = slugifyAgentName(preset?.name ?? params.name);
	if (RESERVED_AGENT_IDS.has(id)) {
		throw new Error(vscode.l10n.t('settings.agents.error.reservedWrite', id));
	}
	
	const dir = vscode.Uri.joinPath(folder.uri, '.gen', 'agents');
	try {
		await vscode.workspace.fs.stat(dir);
	} catch {
		await vscode.workspace.fs.createDirectory(dir);
	}

	const uri = vscode.Uri.joinPath(dir, `${id}.md`);
	let created = true;
	try {
		await vscode.workspace.fs.stat(uri);
		created = false;
	} catch {
		created = true;
	}

	const description = (params.description.trim() || preset?.description || params.name.trim()).trim();
	const displayName = (preset?.name ?? params.name).trim() || id;
	const inferred = inferGeneratedAgentSpec(description, {
		name: displayName,
		mode: params.mode ?? preset?.mode,
		readonly: params.readonly ?? preset?.readonly,
	});
	const mode = inferred.mode;
	const readonly = inferred.readonly;
	const tools = inferred.tools;
	const bodySection = preset?.body?.trim()
		? preset.body.trim()
		: inferred.body;

	const markdown = [
		'---',
		`name: ${displayName}`,
		`description: ${description}`,
		`mode: ${mode}`,
		`readonly: ${readonly}`,
		`tools: ${tools.join(', ')}`,
		'---',
		'',
		bodySection.startsWith('#') ? bodySection : `${bodySection}\n`,
	].join('\n');

	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown.endsWith('\n') ? markdown : `${markdown}\n`));
	return {
		relativePath: vscode.workspace.asRelativePath(uri),
		created,
	};
}

// Клонировать builtin preset в `.gen/agents/{name}.md`
export async function cloneBuiltinPreset(id: string): Promise<{
	relativePath: string;
	created: boolean;
}> {
	const preset = getBuiltinPreset(id);
	if (!preset) {
		throw new Error(vscode.l10n.t('settings.agents.error.unknownPreset', id));
	}

	return generateAgentFile({
		name: preset.name,
		description: preset.description,
		mode: preset.mode,
		readonly: preset.readonly,
	});
}
