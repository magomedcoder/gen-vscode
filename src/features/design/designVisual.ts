/**
 * Design Mode (shipped) - визуальный bridge, не заглушка.
 *
 * Честные лимиты: не полный CDP click-to-code. Bridge получает URL/selector,
 * повторяет эвристики design_inspect и открывает лучший workspace-кандидат.
 */
import * as vscode from 'vscode';
import { setLastDesignSelection } from './designSession';

export interface DesignClickPayload {
	url: string;
	selector?: string;
	snippet?: string;
	x?: number;
	y?: number;
	sourceHint?: string;
}

export interface DesignClickResult {
	ok: boolean;
	handled: boolean;
	message: string;
	path?: string;
	line?: number;
}

export const DESIGN_CLICK_PROTOCOL = 'gen.design.click' as const;

// Заметка про инъекцию Simple Browser / preview (host-доки для будущей проводки)
export const DESIGN_SIMPLE_BROWSER_NOTE =
	'Design click bridge resolves URL + selector through the design_inspect path: ' +
	'data-component/data-source/sourceMappingURL hints first, then class/id workspace grep. ' +
	'It is best-effort and does not require full Simple Browser CDP. ' +
	'In Simple Browser: copy the preview URL from the address bar and run command gen.design.pickFromClipboard (optional CSS selector). ' +
	'For JS-rendered pages use tool design_screenshot (optional Playwright + designScreenshotEnabled).';

export interface DesignSourceHint {
	value: string;
	kind: 'source' | 'component' | 'sourceMap';
}

export function extractDesignSourceHints(html: string): DesignSourceHint[] {
	const out: DesignSourceHint[] = [];
	const add = (value: string | undefined, kind: DesignSourceHint['kind']) => {
		const clean = value?.trim().replace(/^file:\/\//, '').replace(/[?#].*$/, '');
		if (clean && !out.some((item) => item.value === clean)) {
			out.push({ 
				value: clean, 
				kind 
			});
		}
	};

	for (const match of html.matchAll(/\b(?:data-gen-src|data-source|data-source-file)\s*=\s*["']([^"']+)["']/gi)) {
		add(match[1], 'source');
	}

	for (const match of html.matchAll(/\bdata-component\s*=\s*["']([^"']+)["']/gi)) {
		add(match[1], 'component');
	}

	const mapMatch = html.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/i)
		|| html.match(/\/\*[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*\*\//i)
		|| html.match(/sourceMappingURL=([^\s"']+)/i);
	add(mapMatch?.[1]?.replace(/["'>].*$/, ''), 'sourceMap');

	return out;
}

/**
 * Аннотировать полученный HTML комментарием + data-атрибутом, если есть source map hint.
 * JS не исполняет; безопасно для контекста агента.
 */
export function annotateHtmlWithSourceHints(html: string, pageUrl: string): {
	html: string;
	sourceMapHint?: string;
	note: string;
} {
	const sourceMapHint = extractDesignSourceHints(html).find((hint) => hint.kind === 'sourceMap')?.value;
	const comment = sourceMapHint
		? `<!-- gen-design: url=${pageUrl} sourceMappingURL=${sourceMapHint} -->`
		: `<!-- gen-design: url=${pageUrl}; no sourceMappingURL in response - design_inspect uses class/id grep -->`;

	let annotated = html;
	if (/<html\b/i.test(annotated)) {
		annotated = annotated.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
			if (/\bdata-gen-src\b/i.test(attrs)) {
				return `<html${attrs}>`;
			}
			const hint = sourceMapHint ?? pageUrl;
			return `<html${attrs} data-gen-src="${hint.replace(/"/g, '&quot;')}">`;
		});
	}

	if (!annotated.includes('gen-design:')) {
		annotated = `${comment}\n${annotated}`;
	}

	return {
		html: annotated,
		sourceMapHint,
		note: DESIGN_SIMPLE_BROWSER_NOTE,
	};
}

// Извлечь outerHTML-подобный фрагмент первого элемента по простому CSS-селектору (id/class/tag)
export function extractSelectorOuterHtml(html: string, selector: string, maxChars = 4_000): { matched: boolean; outerHtml?: string; matchedBy?: string } {
	const sel = selector.trim();
	if (!sel) {
		return { matched: false };
	}

	// селектор #id
	if (sel.startsWith('#') && /^#[A-Za-z_][\w-]*$/.test(sel)) {
		const id = sel.slice(1);
		const re = new RegExp(
			`<([a-zA-Z][\\w-]*)([^>]*\\sid\\s*=\\s*["']${id}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`,
			'i',
		);
		const m = re.exec(html);
		if (m) {
			const outer = m[0].slice(0, maxChars);
			return { 
				matched: true, 
				outerHtml: outer, 
				matchedBy: `id=${id}` 
			};
		}
		// самозакрывающийся тег / без детей
		const re2 = new RegExp(
			`<([a-zA-Z][\\w-]*)([^>]*\\sid\\s*=\\s*["']${id}["'][^>]*)\\/?>`,
			'i',
		);
		const m2 = re2.exec(html);
		if (m2) {
			return { 
				matched: true, 
				outerHtml: m2[0].slice(0, maxChars), 
				matchedBy: `id=${id}` 
			};
		}
	}

	// .class (первый class-токен)
	if (sel.startsWith('.') && /^\.[A-Za-z_][\w-]*$/.test(sel)) {
		const cls = sel.slice(1);
		const re = new RegExp(
			`<([a-zA-Z][\\w-]*)([^>]*\\sclass\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*)>([\\s\\S]*?)<\\/\\1>`,
			'i',
		);
		const m = re.exec(html);
		if (m) {
			return { 
				matched: true, 
				outerHtml: m[0].slice(0, maxChars), 
				matchedBy: `class=${cls}` 
			};
		}
	}

	// тег
	if (/^[a-zA-Z][\w-]*$/.test(sel)) {
		const re = new RegExp(`<(${sel})(\\s[^>]*)?>([\\s\\S]*?)<\\/${sel}>`, 'i');
		const m = re.exec(html);
		if (m) {
			return {
				matched: true, 
				outerHtml: m[0].slice(0, maxChars),
				matchedBy: `tag=${sel}` 
			};
		}
	}

	return { matched: false };
}

// Токены из селектора для grep по workspace (имена class / id)
export function selectorSearchTokens(selector: string): string[] {
	const tokens: string[] = [];
	const id = /#([A-Za-z_][\w-]*)/g;
	const cls = /\.([A-Za-z_][\w-]*)/g;
	let m: RegExpExecArray | null;
	while ((m = id.exec(selector))) {
		tokens.push(m[1]!);
	}

	while ((m = cls.exec(selector))) {
		tokens.push(m[1]!);
	}

	if (tokens.length === 0 && /^[A-Za-z_][\w-]*$/.test(selector.trim())) {
		tokens.push(selector.trim());
	}

	return [...new Set(tokens)];
}

function candidateNames(payload: DesignClickPayload): string[] {
	const hints = extractDesignSourceHints(`${payload.sourceHint ?? ''}\n${payload.snippet ?? ''}`);
	const names = hints.flatMap((hint) => {
		if (hint.kind === 'component' && !/[./\\]/.test(hint.value)) {
			return [`${hint.value}.tsx`, `${hint.value}.jsx`, `${hint.value}.vue`, `${hint.value}.svelte`];
		}

		return [hint.value.split(/[/\\]/).pop()!];
	});

	return [...new Set(names.filter(Boolean))];
}

export async function handleDesignClick(payload: DesignClickPayload): Promise<DesignClickResult> {
	const selector = payload.selector?.trim() ?? '';
	if (!payload.url?.trim() || !selector) {
		return { 
			ok: false, 
			handled: false, 
			message: vscode.l10n.t('design.click.requiresUrlSelector')
		};
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return { 
			ok: false, 
			handled: false, 
			message: vscode.l10n.t('design.click.noWorkspace')
		};
	}

	const sourceNames = candidateNames(payload);
	const tokens = selectorSearchTokens(selector);
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,css,scss,html,vue,svelte}'),
		'**/{node_modules,.git,.gen,dist,out}/**',
		120,
	);

	const ordered = [...files].sort((a, b) => {
		const aExact = sourceNames.some((name) => a.path.endsWith(`/${name}`));
		const bExact = sourceNames.some((name) => b.path.endsWith(`/${name}`));
		return Number(bExact) - Number(aExact);
	});

	for (const uri of ordered) {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const lines = doc.getText().split(/\r?\n/);
			let line = -1;
			for (const token of [...sourceNames.map((name) => name.replace(/\.[^.]+$/, '')), ...tokens]) {
				line = lines.findIndex((entry) => entry.includes(token));
				if (line >= 0) {
					break;
				}
			}

			const exactHint = sourceNames.some((name) => uri.path.endsWith(`/${name}`));
			if (line < 0 && !exactHint) {
				continue;
			}

			const position = new vscode.Position(Math.max(0, line), 0);
			const editor = await vscode.window.showTextDocument(doc, { preview: true });
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
			const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			await setLastDesignSelection({ url: payload.url, selector, sourcePath: relative, line: position.line + 1, inspectedAt: Date.now() });
			return { 
				ok: true, 
				handled: true, 
				path: relative, 
				line: position.line + 1, 
				message: vscode.l10n.t('design.click.opened', relative, position.line + 1)
			};
		} catch {}
	}

	await setLastDesignSelection({ url: payload.url, selector, inspectedAt: Date.now() });
	return { 
		ok: false, 
		handled: true, 
		message: vscode.l10n.t('design.click.noMatch', selector)
	};
}
