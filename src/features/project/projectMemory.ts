import * as vscode from 'vscode';

export const MEMORY_RELATIVE = '.gen/memory.md';
export const MAX_MEMORY_CHARS = 6_000;
export const MAX_MEMORY_OFFER_LINES = 5;

export const MEMORY_TEMPLATE = `# Project memory

Durable decisions and preferences for Gen (workspace only; not chat history, not cloud Memories).

## Decisions

-

## Preferences

-

## Do not

-
`;

export function normalizeMemoryText(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	// Шаблон только с плейсхолдерами «-» не тащим в prompt
	const substantive = trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && line !== '-' && !/^#{1,6}\s/.test(line) && !/^Durable decisions/i.test(line));
	if (substantive.length === 0) {
		return undefined;
	}

	if (trimmed.length <= MAX_MEMORY_CHARS) {
		return trimmed;
	}

	return `${trimmed.slice(0, MAX_MEMORY_CHARS)}\n\n[Gen: ${MEMORY_RELATIVE} truncated to ${MAX_MEMORY_CHARS} chars]`;
}

export function formatMemoryForPrompt(text: string): string {
	return `### ${MEMORY_RELATIVE}\n${text}`;
}

async function readMemoryRaw(): Promise<string | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, MEMORY_RELATIVE));
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

// Appendix для system prompt (Agent + Ask)
export async function loadProjectMemoryAppendix(): Promise<string | undefined> {
	const raw = await readMemoryRaw();
	const normalized = raw ? normalizeMemoryText(raw) : undefined;
	return normalized ? formatMemoryForPrompt(normalized) : undefined;
}

function bulletize(line: string): string {
	const trimmed = line.trim().replace(/^[-*•]\s+/, '').trim();
	if (!trimmed) {
		return '';
	}

	return trimmed.startsWith('-') ? trimmed : `- ${trimmed}`;
}

// Из compact summary вытащить 3-5 кандидатов "что зафиксировать" (Prefer ## Decisions, затем ## Preferences / ## Next step).
export function extractMemoryCandidatesFromSummary(
	summary: string,
	maxLines = MAX_MEMORY_OFFER_LINES,
): string[] {
	const sections = parseMarkdownSections(summary);
	const preferred = [
		...sectionLines(sections, 'decisions'),
		...sectionLines(sections, 'preferences'),
		...sectionLines(sections, 'next step'),
		...sectionLines(sections, 'next'),
	];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of preferred) {
		const bullet = bulletize(raw);
		if (!bullet) {
			continue;
		}

		const key = bullet.toLocaleLowerCase();
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		out.push(bullet);
		if (out.length >= maxLines) {
			break;
		}
	}

	return out;
}

function parseMarkdownSections(text: string): Map<string, string[]> {
	const map = new Map<string, string[]>();
	let current = '';
	for (const line of text.split(/\r?\n/)) {
		const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			current = heading[1]!.trim().toLocaleLowerCase();
			if (!map.has(current)) {
				map.set(current, []);
			}
			continue;
		}

		if (!current) {
			continue;
		}

		const trimmed = line.trim();
		if (!trimmed || trimmed === '-' || trimmed === '*') {
			continue;
		}

		map.get(current)!.push(trimmed);
	}

	return map;
}

function sectionLines(sections: Map<string, string[]>, name: string): string[] {
	return sections.get(name) ?? [];
}

// Дописать строки в секцию ## Decisions (создаёт файл из шаблона при отсутствии)
export async function appendMemoryLines(lines: readonly string[]): Promise<{ relativePath: string; appended: number }> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error(vscode.l10n.t('policy.noWorkspace'));
	}

	const cleaned = lines.map(bulletize).filter(Boolean);
	if (cleaned.length === 0) {
		return { relativePath: MEMORY_RELATIVE, appended: 0 };
	}

	const uri = vscode.Uri.joinPath(folder.uri, MEMORY_RELATIVE);
	let existing = '';
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		existing = MEMORY_TEMPLATE;
	}

	const next = mergeMemoryAppend(existing, cleaned);
	const parent = vscode.Uri.joinPath(uri, '..');
	try {
		await vscode.workspace.fs.stat(parent);
	} catch {
		await vscode.workspace.fs.createDirectory(parent);
	}

	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next));
	return { relativePath: MEMORY_RELATIVE, appended: cleaned.length };
}

// Вставить bullets под ## Decisions (для тестов и append)
export function mergeMemoryAppend(existing: string, bullets: readonly string[]): string {
	const text = existing.replace(/\s+$/, '');
	const block = bullets.join('\n');
	const decisionsRe = /(^|\n)(##\s+Decisions\s*\n)/i;
	const match = decisionsRe.exec(text);
	if (!match || match.index === undefined) {
		return `${text}\n\n## Decisions\n\n${block}\n`;
	}

	const insertAt = match.index + match[0].length;
	const before = text.slice(0, insertAt);
	const after = text.slice(insertAt);
	// Убрать ведущий плейсхолдер «-» сразу под заголовком
	const afterClean = after.replace(/^\s*-\s*\n/, '\n');
	return `${before}\n${block}${afterClean.startsWith('\n') ? afterClean : `\n${afterClean}`}\n`;
}

export async function openProjectMemory(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showWarningMessage(vscode.l10n.t('policy.noWorkspace'));
		return;
	}

	const uri = vscode.Uri.joinPath(folder.uri, MEMORY_RELATIVE);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(MEMORY_TEMPLATE));
	}

	await vscode.window.showTextDocument(uri, { preview: false });
}
