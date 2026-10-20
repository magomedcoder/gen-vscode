import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../../../../core/config/settings';
import { asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, confirmOrSkip, shouldConfirmWrites } from '../confirm';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ACTIONS = ['launch', 'click', 'type', 'scroll', 'screenshot', 'close'] as const;
type BrowserAction = (typeof ACTIONS)[number];

// Сессия Playwright без жёстких типов (optional dep; типы зависят от установки)
type CuSession = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	browser: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	context: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	page: any;
	consoleLogs: string[];
	cdp: boolean;
};

let session: CuSession | undefined;

async function loadPlaywright(): Promise<typeof import('playwright') | undefined> {
	try {
		return await import('playwright');
	} catch {
		return undefined;
	}
}

function normalizeUrl(raw: string): URL | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
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

async function ensureConfirm(ctx: ToolContext, href: string, local: boolean): Promise<ToolResult | undefined> {
	if (!local && getSettings().blockNonLocalUrls) {
		return { ok: false, denied: true, content: `browser_action blocked non-local URL: ${href}` };
	}

	if (!local) {
		return confirmAlwaysOrSkip(ctx, vscode.l10n.t('agent.confirm.browserCuRemote', href), href);
	}

	if (shouldConfirmWrites()) {
		return confirmOrSkip(ctx, vscode.l10n.t('agent.confirm.browserCu', href), href);
	}

	return undefined;
}

async function ensureScreenshotDir(): Promise<{ absPath: string; relativePath: string }> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error(vscode.l10n.t('policy.noWorkspace'));
	}

	const rel = path.posix.join('.gen', 'cache', 'design-screenshots');
	const absPath = path.join(folder.uri.fsPath, rel);
	await fs.mkdir(absPath, { recursive: true });
	return { absPath, relativePath: rel.replace(/\\/g, '/') };
}

async function closeSession(): Promise<void> {
	const s = session;
	session = undefined;
	if (!s) {
		return;
	}

	try {
		await s.context.close();
	} catch {}

	if (!s.cdp) {
		try {
			await s.browser.close();
		} catch {}
	}
}

export const browserActionTool: ToolDefinition = {
	name: 'browser_action',
	description: 'Computer-use браузер (Playwright): launch / click / type / scroll / screenshot / close. Нужен browserComputerUseEnabled + playwright. Screenshot возвращает PNG path + console logs.',
	parameters: {
		type: 'object',
		properties: {
			action: { 
				type: 'string', 
				enum: [...ACTIONS] 
			},
			url: { 
				type: 'string', 
				description: 'Для launch' 
			},
			selector: { 
				type: 'string', 
				description: 'CSS для click/type' 
			},
			text: { 
				type: 'string', 
				description: 'Текст для type' 
			},
			direction: { 
				type: 'string', 
				enum: ['up', 'down'], 
				description: 'Для scroll' 
			},
			amount: { 
				type: 'number', 
				description: 'Пиксели scroll (default 600)' 
			},
		},
		required: ['action'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const settings = getSettings();
		if (!settings.browserComputerUseEnabled) {
			return makeToolError(
				'browser_action отключён: включите browserComputerUseEnabled (Безопасность).',
				{ 
					code: 'feature_disabled', 
					category: 'permission', 
					retryable: false 
				},
			);
		}

		const action = asString(args, 'action').trim().toLowerCase() as BrowserAction;
		if (!ACTIONS.includes(action)) {
			return makeToolError(`Unknown action: ${action}`, {
				code: 'invalid_args',
				category: 'validation',
				retryable: false,
			});
		}

		if (action === 'close') {
			await closeSession();
			return { ok: true, content: 'browser_action: closed' };
		}

		const pw = await loadPlaywright();
		if (!pw) {
			return makeToolError(
				'Playwright не установлен: `yarn add -D playwright` затем `npx playwright install chromium`.',
				{ 
					code: 'dependency_missing', 
					category: 'internal', 
					retryable: false 
				},
			);
		}

		if (action === 'launch') {
			const parsed = normalizeUrl(asString(args, 'url'));
			if (!parsed) {
				return makeToolError(vscode.l10n.t('tool.browserBadUrl'), {
					code: 'invalid_url',
					category: 'validation',
					retryable: false,
				});
			}

			const href = parsed.toString();
			const denied = await ensureConfirm(ctx, href, isLocalUrl(parsed));
			if (denied) {
				return denied;
			}

			await closeSession();
			const consoleLogs: string[] = [];
			const viewport = {
				width: Math.max(320, settings.browserViewportWidth || 1280),
				height: Math.max(240, settings.browserViewportHeight || 720),
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const chromium = pw.chromium as any;
			let browser: CuSession['browser'];
			let cdp = false;
			const cdpEndpoint = settings.browserCdpEndpoint.trim();
			if (cdpEndpoint) {
				browser = await chromium.connectOverCDP(cdpEndpoint);
				cdp = true;
			} else {
				const launchOpts: Record<string, unknown> = { headless: true };
				if (settings.browserChromePath.trim()) {
					launchOpts.executablePath = settings.browserChromePath.trim();
				}

				browser = await chromium.launch(launchOpts);
			}

			const context = browser.contexts?.()?.[0] ?? (await browser.newContext({ viewport }));
			const page = context.pages?.()?.[0] ?? (await context.newPage());
			page.on('console', (msg: { type: () => string; text: () => string }) => {
				consoleLogs.push(`[${msg.type()}] ${msg.text()}`.slice(0, 500));
				if (consoleLogs.length > 80) {
					consoleLogs.shift();
				}
			});
			await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
			session = { browser, context, page, consoleLogs, cdp };
			return {
				ok: true,
				content: `browser_action launch ok\nurl: ${href}\nviewport: ${viewport.width}x${viewport.height}\ncdp: ${cdp}`,
			};
		}

		if (!session) {
			return makeToolError('Нет активной сессии: сначала browser_action launch.', {
				code: 'no_session',
				category: 'validation',
				retryable: false,
			});
		}

		const { page, consoleLogs } = session;
		throwIfAborted(ctx.signal);

		if (action === 'click') {
			const selector = asString(args, 'selector').trim();
			if (!selector) {
				return makeToolError('selector required for click', {
					code: 'invalid_args',
					category: 'validation',
					retryable: false,
				});
			}

			await page.click(selector, { timeout: 15_000 });
			return { 
				ok: true, 
				content: `browser_action click ok\nselector: ${selector}` 
			};
		}

		if (action === 'type') {
			const selector = asString(args, 'selector').trim();
			const text = asString(args, 'text');
			if (!selector) {
				return makeToolError('selector required for type', {
					code: 'invalid_args',
					category: 'validation',
					retryable: false,
				});
			}

			await page.fill(selector, text);
			return { ok: true, content: `browser_action type ok\nselector: ${selector}\nchars: ${text.length}` };
		}

		if (action === 'scroll') {
			const dir = asString(args, 'direction').trim().toLowerCase() === 'up' ? -1 : 1;
			const amount = typeof args.amount === 'number' && args.amount > 0 ? Math.floor(args.amount) : 600;
			await page.mouse.wheel(0, dir * amount);
			return { ok: true, content: `browser_action scroll ok\ndeltaY: ${dir * amount}` };
		}

		const { absPath, relativePath } = await ensureScreenshotDir();
		const file = path.join(absPath, `cu-${Date.now()}.png`);
		await page.screenshot({ path: file, fullPage: false });
		const logs = consoleLogs.slice(-20).join('\n') || '(no console)';
		return {
			ok: true,
			content: `browser_action screenshot ok\npath: ${relativePath}/${path.basename(file)}\n\n## console\n${logs}`,
		};
	},
};
