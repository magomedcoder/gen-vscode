import * as vscode from 'vscode';
import { formatMentionPathArg, type MentionKind } from './mentions';
import { getSessionPeek } from './sessionStore';
import { loadReferenceDefs } from '../project/references';

export interface MentionSuggestion {
	kind: MentionKind;
	label: string;
	insert: string;
	detail?: string;
	/**
	 * true - шаблон вида (@file / @folder...): вставить в draft и показать следующий шаг (файлы, папки...).
	 * false/undefined - готовое значение: сразу chip.
	 */
	needsPick?: boolean;
}

// После выбора этих kinds нужен второй шаг (путь / имя / query)
const KIND_NEEDS_PICK = new Set<MentionKind>([
	'file',
	'folder',
	'codebase',
	'symbols',
	'docs',
	'agent',
	'alias',
	'ref',
	'git',
	'link',
	'url',
	'past',
]);

function kindTemplates(): Array<{
	kind: MentionKind;
	label: string;
	insert: string;
	detail: string;
	needsPick: boolean;
}> {
	return [
		{
			kind: 'file',
			label: '@file',
			insert: '@file ',
			detail: vscode.l10n.t('chat.mention.detail.file'),
			needsPick: true,
		},
		{
			kind: 'folder',
			label: '@folder',
			insert: '@folder ',
			detail: vscode.l10n.t('chat.mention.detail.folder'),
			needsPick: true,
		},
		{
			kind: 'codebase',
			label: '@codebase',
			insert: '@codebase ',
			detail: vscode.l10n.t('chat.mention.detail.codebase'),
			needsPick: true,
		},
		{
			kind: 'map',
			label: '@map',
			insert: '@map',
			detail: vscode.l10n.t('chat.mention.detail.map'),
			needsPick: false,
		},
		{
			kind: 'symbols',
			label: '@symbols',
			insert: '@symbols ',
			detail: vscode.l10n.t('chat.mention.detail.symbols'),
			needsPick: true,
		},
		{
			kind: 'code',
			label: '@code',
			insert: '@code',
			detail: vscode.l10n.t('chat.mention.detail.code'),
			needsPick: false,
		},
		{
			kind: 'docs',
			label: '@Docs',
			insert: '@Docs ',
			detail: vscode.l10n.t('chat.mention.detail.docs'),
			needsPick: true,
		},
		{
			kind: 'agent',
			label: '@agent',
			insert: '@agent ',
			detail: vscode.l10n.t('chat.mention.detail.agent'),
			needsPick: true,
		},
		{
			kind: 'alias',
			label: '@alias',
			insert: '@alias ',
			detail: vscode.l10n.t('chat.mention.detail.alias'),
			needsPick: true,
		},
		{
			kind: 'ref',
			label: '@ref',
			insert: '@ref:',
			detail: vscode.l10n.t('chat.mention.detail.ref'),
			needsPick: true,
		},
		{
			kind: 'git',
			label: '@git',
			insert: '@git ',
			detail: vscode.l10n.t('chat.mention.detail.git'),
			needsPick: true,
		},
		{
			kind: 'branch_diff',
			label: '@branch_diff',
			insert: '@branch_diff',
			detail: vscode.l10n.t('chat.mention.detail.branchDiff'),
			needsPick: false,
		},
		{
			kind: 'git_changes',
			label: '@git-changes',
			insert: '@git-changes',
			detail: vscode.l10n.t('chat.mention.detail.gitChanges'),
			needsPick: false,
		},
		{
			kind: 'problems',
			label: '@problems',
			insert: '@problems',
			detail: vscode.l10n.t('chat.mention.detail.problems'),
			needsPick: false,
		},
		{
			kind: 'rules',
			label: '@rules',
			insert: '@rules',
			detail: vscode.l10n.t('chat.mention.detail.rules'),
			needsPick: false,
		},
		{
			kind: 'link',
			label: '@link',
			insert: '@link ',
			detail: vscode.l10n.t('chat.mention.detail.link'),
			needsPick: true,
		},
		{
			kind: 'url',
			label: '@url',
			insert: '@url ',
			detail: vscode.l10n.t('chat.mention.detail.url'),
			needsPick: true,
		},
		{
			kind: 'terminals',
			label: '@terminals',
			insert: '@terminals',
			detail: vscode.l10n.t('chat.mention.detail.terminals'),
			needsPick: false,
		},
		{
			kind: 'past',
			label: '@past',
			insert: '@past ',
			detail: vscode.l10n.t('chat.mention.detail.past'),
			needsPick: true,
		},
	];
}

const KIND_ARG_RE = /^(file|folder|codebase|symbols|git-changes|git|branch_diff|problems|rules|link|url|docs|doc|agent|past|alias|ref|map)(?:\s+|:)(.*)$/i;

async function suggestReferenceAliases(prefix: string): Promise<MentionSuggestion[]> {
	const isRef = prefix.startsWith('ref');
	const kind: MentionKind = isRef ? 'ref' : 'alias';
	const nameQuery = prefix.replace(/^(alias|ref)\s+/, '')
		.replace(/^(alias|ref):/, '')
		.trim();
	const defs = await loadReferenceDefs();
	const out: MentionSuggestion[] = [];

	for (const def of defs) {
		if (nameQuery && !def.alias.toLowerCase().includes(nameQuery.toLowerCase())) {
			continue;
		}

		const detail = def.description
			?? (def.git ? `git ${def.git}` : def.path)
			?? vscode.l10n.t('chat.mention.kind.alias');
		out.push({
			kind: 'alias',
			label: `@alias ${def.alias}`,
			insert: `@alias ${def.alias} `,
			detail,
			needsPick: false,
		});
		if (out.length >= 12) {
			break;
		}
	}

	return out.length
		? out
		: [{
			kind,
			label: isRef ? '@ref' : '@alias',
			insert: isRef ? '@ref:' : '@alias ',
			detail: vscode.l10n.t(isRef ? 'chat.mention.detail.ref' : 'chat.mention.detail.alias'),
			needsPick: true,
		}];
}

async function suggestPathMentions(kind: 'file' | 'folder', pathQuery: string): Promise<MentionSuggestion[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const glob = pathQuery ? `**/*${pathQuery.replace(/[^\w./-]/g, '')}*` : '**/*';
	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, glob),
		'**/{.gen,node_modules,.git}/**',
		kind === 'folder' ? 80 : 40,
	);

	const seen = new Set<string>();
	const out: MentionSuggestion[] = [];

	for (const uri of uris) {
		const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		if (!relative || seen.has(relative)) {
			continue;
		}

		seen.add(relative);
		if (kind === 'folder') {
			const parts = relative.split('/');
			// Предложить все префиксы пути как папки
			for (let i = 1; i < parts.length; i += 1) {
				const dir = parts.slice(0, i).join('/');
				if (!dir || seen.has(`dir:${dir}`)) {
					continue;
				}

				if (pathQuery && !dir.toLowerCase().includes(pathQuery.toLowerCase())) {
					continue;
				}

				seen.add(`dir:${dir}`);
				out.push({
					kind: 'folder',
					label: dir,
					insert: `@folder ${formatMentionPathArg(dir)} `,
					detail: vscode.l10n.t('chat.mention.kind.folder'),
					needsPick: false,
				});

				if (out.length >= 12) {
					return out;
				}
			}
		} else {
			out.push({
				kind: 'file',
				label: relative,
				insert: `@file ${formatMentionPathArg(relative)} `,
				detail: vscode.l10n.t('chat.mention.kind.file'),
				needsPick: false,
			});
			
			if (out.length >= 12) {
				break;
			}
		}
	}

	return out;
}

export async function suggestMentions(query: string): Promise<MentionSuggestion[]> {
	// Не trim() целиком - пробел после kind (`file `) означает «выбрать значение»
	const raw = query.replace(/^@/, '');
	const lower = raw.toLowerCase();
	const kindArg = KIND_ARG_RE.exec(lower);

	// Ещё только выбор вида: `@` / `@fi` / `@file` без пробела/аргумента
	if (!kindArg) {
		const prefix = lower.trim();
		if (prefix.includes('/') || prefix.includes('.')) {
			// Похоже на путь без kind - предложить @file
			return suggestPathMentions('file', prefix);
		}

		const hits = kindTemplates().filter((k) => (
			!prefix
			|| k.kind.startsWith(prefix)
			|| k.kind.includes(prefix)
			|| k.label.toLowerCase().includes(prefix)
			|| (prefix === 'doc' && k.kind === 'docs')
			|| (prefix.startsWith('git') && (k.kind === 'git' || k.kind === 'git_changes'))
		));

		if (hits.length) {
			return hits.map((k) => ({
				kind: k.kind,
				label: k.label,
				insert: k.insert,
				detail: k.detail,
				needsPick: k.needsPick,
			}));
		}

		return [];
	}

	const kindToken = kindArg[1]!.toLowerCase();
	const arg = (kindArg[2] ?? '').trim();

	if (kindToken === 'git' || kindToken === 'git-changes') {
		if (kindToken === 'git-changes') {
			return [{
				kind: 'git_changes',
				label: '@git-changes',
				insert: '@git-changes',
				detail: vscode.l10n.t('chat.mention.detail.gitChanges'),
				needsPick: false,
			}];
		}
		return [{
			kind: 'git',
			label: arg ? `@git ${arg}` : '@git HEAD',
			insert: arg ? `@git ${arg} ` : '@git HEAD ',
			detail: vscode.l10n.t('chat.mention.detail.gitShow'),
			needsPick: false,
		}];
	}

	if (kindToken === 'past') {
		const store = getSessionPeek();
		const sessions = store?.listSessions({ startedOnly: true }) ?? [];
		const currentId = store?.getCurrentSessionId();
		const out: MentionSuggestion[] = [];

		for (const s of sessions) {
			if (s.id === currentId) {
				continue;
			}
			if (arg) {
				const n = arg.toLowerCase();
				if (!s.title.toLowerCase().includes(n) && !s.id.toLowerCase().includes(n)) {
					continue;
				}
			}
			const needsQuotes = /\s/.test(s.title) || /@/.test(s.title);
			const titleArg = needsQuotes ? `\`${s.title}\`` : s.title;
			out.push({
				kind: 'past',
				label: `@past ${s.title}`,
				insert: `@past ${titleArg} `,
				detail: vscode.l10n.t('chat.mention.kind.past'),
				needsPick: false,
			});
			if (out.length >= 12) {
				break;
			}
		}

		return out.length
			? out
			: [{
				kind: 'past',
				label: '@past',
				insert: '@past ',
				detail: vscode.l10n.t('chat.mention.detail.past'),
				needsPick: true,
			}];
	}

	if (kindToken === 'alias' || kindToken === 'ref') {
		return suggestReferenceAliases(`${kindToken} ${arg}`);
	}

	if (kindToken === 'agent') {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [{
				kind: 'agent',
				label: '@agent',
				insert: '@agent ',
				detail: vscode.l10n.t('chat.mention.detail.agent'),
				needsPick: true,
			}];
		}

		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, '.gen/agents/*.md'),
			undefined,
			30,
		);
		const out: MentionSuggestion[] = [];
		for (const uri of uris) {
			const base = (uri.path.split('/').pop() ?? '').replace(/\.md$/i, '');
			if (arg && !base.toLowerCase().includes(arg.toLowerCase())) {
				continue;
			}
			out.push({
				kind: 'agent',
				label: `@agent ${base}`,
				insert: `@agent ${base} `,
				detail: vscode.l10n.t('chat.mention.kind.agent'),
				needsPick: false,
			});
			if (out.length >= 12) {
				break;
			}
		}
		return out.length
			? out
			: [{
				kind: 'agent',
				label: '@agent',
				insert: '@agent ',
				detail: vscode.l10n.t('chat.mention.detail.agent'),
				needsPick: true,
			}];
	}

	if (kindToken === 'docs' || kindToken === 'doc') {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [{
				kind: 'docs',
				label: '@Docs',
				insert: '@Docs ',
				detail: vscode.l10n.t('chat.mention.detail.docs'),
				needsPick: true,
			}];
		}

		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(
				folder,
				arg ? `**/*${arg.replace(/[^\w./-]/g, '')}*.md` : '{docs,Documentation,doc}/**/*.md',
			),
			'**/{.gen,node_modules,.git}/**',
			20,
		);
		const out: MentionSuggestion[] = uris.slice(0, 12).map((uri) => {
			const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			return {
				kind: 'docs' as const,
				label: relative,
				insert: `@Docs ${relative} `,
				detail: vscode.l10n.t('chat.mention.kind.docs'),
				needsPick: false,
			};
		});
		return out.length
			? out
			: [{
				kind: 'docs',
				label: '@Docs',
				insert: '@Docs ',
				detail: vscode.l10n.t('chat.mention.detail.docs'),
				needsPick: true,
			}];
	}

	if (kindToken === 'file') {
		return suggestPathMentions('file', arg);
	}

	if (kindToken === 'folder') {
		return suggestPathMentions('folder', arg);
	}

	if (kindToken === 'codebase' || kindToken === 'symbols') {
		const kind: MentionKind = kindToken === 'symbols' ? 'symbols' : 'codebase';
		if (!arg) {
			return [{
				kind,
				label: kind === 'symbols' ? '@symbols' : '@codebase',
				insert: kind === 'symbols' ? '@symbols' : '@codebase',
				detail: vscode.l10n.t(kind === 'symbols' ? 'chat.mention.detail.symbols' : 'chat.mention.detail.codebase'),
				needsPick: false,
			}];
		}
		return [{
			kind,
			label: `@${kind} ${arg}`,
			insert: `@${kind} ${arg} `,
			detail: vscode.l10n.t(kind === 'symbols' ? 'chat.mention.detail.symbols' : 'chat.mention.detail.codebase'),
			needsPick: false,
		}];
	}

	if (kindToken === 'link' || kindToken === 'url') {
		const kind: MentionKind = kindToken === 'url' ? 'url' : 'link';
		if (!arg) {
			// Ждём ввод URL в поле - пустой список
			return [];
		}
		return [{
			kind,
			label: `@${kind} ${arg}`,
			insert: `@${kind} ${arg} `,
			detail: vscode.l10n.t(kind === 'url' ? 'chat.mention.detail.url' : 'chat.mention.detail.link'),
			needsPick: false,
		}];
	}

	// map / branch_diff / problems / rules - без аргумента
	const bare = kindTemplates().find((k) => k.kind === kindToken || (kindToken === 'doc' && k.kind === 'docs'));
	if (bare && !KIND_NEEDS_PICK.has(bare.kind)) {
		return [{
			kind: bare.kind,
			label: bare.label,
			insert: bare.insert,
			detail: bare.detail,
			needsPick: false,
		}];
	}

	return [];
}
