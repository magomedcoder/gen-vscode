import * as vscode from 'vscode';
import { getSettings } from '../../../../core/config/settings';
import { asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, confirmOrSkip, shouldConfirmWrites } from '../confirm';
import { htmlToMarkdown } from './htmlToMarkdown';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeUrl(raw: string): URL | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
		const url = new URL(withScheme);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}

		return url;
	} catch {
		return undefined;
	}
}

function isLocalUrl(url: URL): boolean {
	const host = url.hostname.toLowerCase();
	return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

// URL -> markdown (Design HTML остаётся у fetch_page)
export const webFetchTool: ToolDefinition = {
	name: 'web_fetch',
	description: 'Скачать страницу по URL и вернуть упрощённый markdown (не raw HTML). Для Design/source maps используйте fetch_page. Localhost без лишнего confirm; внешние URL - с подтверждением.',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: 'http(s) URL' },
			max_chars: { type: 'number', description: 'Лимит символов markdown (default 24000)' },
		},
		required: ['url'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		if (!getSettings().webFetchEnabled) {
			return makeToolError('web_fetch отключён: включите webFetchEnabled.', {
				code: 'feature_disabled',
				category: 'permission',
				retryable: false,
			});
		}

		const parsed = normalizeUrl(asString(args, 'url'));
		if (!parsed) {
			return makeToolError(vscode.l10n.t('tool.browserBadUrl'), {
				code: 'invalid_url',
				category: 'validation',
				retryable: false,
			});
		}

		const href = parsed.toString();
		const local = isLocalUrl(parsed);
		if (!local && getSettings().blockNonLocalUrls) {
			return { ok: false, denied: true, content: `web_fetch blocked non-local URL: ${href}` };
		}

		if (!local) {
			const denied = await confirmAlwaysOrSkip(
				ctx,
				vscode.l10n.t('agent.confirm.webFetchRemote', href),
				href,
			);
			if (denied) {
				return denied;
			}
		} else if (shouldConfirmWrites()) {
			const denied = await confirmOrSkip(ctx, vscode.l10n.t('agent.confirm.webFetch', href), href);
			if (denied) {
				return denied;
			}
		}

		const maxChars = typeof args.max_chars === 'number' && args.max_chars > 0
			? Math.min(Math.floor(args.max_chars), 100_000)
			: 24_000;

		const controller = new AbortController();
		const onAbort = () => controller.abort();
		ctx.signal?.addEventListener('abort', onAbort, { once: true });
		const timer = setTimeout(() => controller.abort(), 20_000);

		try {
			const res = await fetch(href, {
				signal: controller.signal,
				headers: { Accept: 'text/html,text/plain,*/*' },
			});
			const raw = await res.text();
			const ct = res.headers.get('content-type') ?? '';
			const md = /html/i.test(ct) || /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 500))
				? htmlToMarkdown(raw, maxChars)
				: raw.slice(0, maxChars);
			return {
				ok: true,
				content: `# web_fetch ${href}\nstatus: ${res.status}\n\n${md}`,
			};
		} catch (err) {
			return makeToolError(err instanceof Error ? err.message : String(err), {
				code: 'fetch_failed',
				category: 'network',
				retryable: true,
			});
		} finally {
			clearTimeout(timer);
			ctx.signal?.removeEventListener('abort', onAbort);
		}
	},
};
