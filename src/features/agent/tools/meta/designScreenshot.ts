import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../../../../core/config/settings';
import { DESIGN_SIMPLE_BROWSER_NOTE } from '../../../design/designVisual';
import { asBoolean, asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip, confirmOrSkip, shouldConfirmWrites } from '../confirm';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const PLAYWRIGHT_INSTALL_HINT = 'Установите optional dependency: `yarn add -D playwright` (или `npm i -D playwright`), затем `npx playwright install chromium`.';

// Динамический import optional dep - Chromium не бандлится в VSIX
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

export type DesignScreenshotWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

const WAIT_UNTIL_VALUES: DesignScreenshotWaitUntil[] = ['load', 'domcontentloaded', 'networkidle', 'commit'];

// Разбор wait_until из аргументов tool; по умолчанию networkidle
export function parseDesignScreenshotWaitUntil(raw: unknown): DesignScreenshotWaitUntil {
	if (typeof raw !== 'string') {
		return 'networkidle';
	}

	const normalized = raw.trim().toLowerCase() as DesignScreenshotWaitUntil;
	return WAIT_UNTIL_VALUES.includes(normalized) ? normalized : 'networkidle';
}

function clampTimeoutMs(raw: unknown): number {
	const settings = getSettings();
	const fallback = Math.min(settings.defaultToolTimeoutMs, 120_000);
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		return fallback;
	}

	return Math.min(Math.max(Math.floor(n), 1000), settings.maxToolTimeoutMs);
}

async function ensureScreenshotDir(): Promise<{ absPath: string; relativePath: string }> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new PathPolicyError();
	}

	const rel = path.posix.join('.gen', 'cache', 'design-screenshots');
	const absPath = path.join(folder.uri.fsPath, rel);
	await fs.mkdir(absPath, { recursive: true });
	return { absPath, relativePath: rel.replace(/\\/g, '/') };
}

// Навигация с wait_until; для networkidle (default) - fallback на domcontentloaded при таймауте
async function navigateForScreenshot(
	page: {
		goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
	},
	href: string,
	waitUntil: DesignScreenshotWaitUntil,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	try {
		await page.goto(href, { waitUntil, timeout: timeoutMs });
	} catch (err) {
		if (waitUntil !== 'networkidle') {
			throw err;
		}

		// SPA / long-polling: networkidle часто не наступает - domcontentloaded достаточно
		throwIfAborted(signal);
		await page.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
	}
}

// Ошибка «нет workspace» - та же семантика, что у resolveWorkspacePath
class PathPolicyError extends Error {
	constructor() {
		super(vscode.l10n.t('policy.noWorkspace'));
		this.name = 'PathPolicyError';
	}
}

// Headless Chromium через Playwright: полный JS-rendered DOM (в отличие от fetch_page).
export const designScreenshotTool: ToolDefinition = {
	name: 'design_screenshot',
	description: 'Сделать PNG-скриншот страницы через headless Chromium (Playwright). Нужен JS-rendered UI. Включите designScreenshotEnabled и установите playwright + chromium. Localhost без лишнего confirm; внешние URL - с подтверждением.',
	parameters: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'URL страницы (предпочтительно localhost preview)',
			},
			full_page: {
				type: 'boolean',
				description: 'Скриншот всей прокручиваемой страницы (по умолчанию - viewport)',
			},
			selector: {
				type: 'string',
				description: 'Опционально: CSS selector элемента для скриншота (ожидание visible перед capture)',
			},
			wait_until: {
				type: 'string',
				enum: WAIT_UNTIL_VALUES,
				description:
					'Событие готовности страницы перед скриншотом (Playwright goto). По умолчанию networkidle; при таймауте - fallback на domcontentloaded.',
			},
			timeout_ms: {
				type: 'number',
				description: 'Таймаут навигации и ожидания (мс)',
			},
		},
		required: ['url'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);

		if (!getSettings().designScreenshotEnabled) {
			return makeToolError(
				'design_screenshot отключён: включите designScreenshotEnabled в настройках Gen (Безопасность / web).',
				{
					code: 'feature_disabled',
					category: 'permission',
					retryable: false,
				},
			);
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
			return {
				ok: false,
				denied: true,
				content: `design_screenshot blocked non-local URL: ${href}`,
			};
		}

		if (!local) {
			const denied = await confirmAlwaysOrSkip(
				ctx,
				vscode.l10n.t('agent.confirm.fetchPageRemote', href),
				href,
			);
			if (denied) {
				return denied;
			}
		} else if (shouldConfirmWrites()) {
			const denied = await confirmOrSkip(
				ctx,
				vscode.l10n.t('agent.confirm.fetchPage', href),
				href,
			);
			if (denied) {
				return denied;
			}
		}

		const playwright = await loadPlaywright();
		if (!playwright) {
			return makeToolError(`design_screenshot: playwright не установлен. ${PLAYWRIGHT_INSTALL_HINT}`, {
				code: 'playwright_missing',
				category: 'internal',
				retryable: false,
			});
		}

		const timeoutMs = clampTimeoutMs(args.timeout_ms);
		const fullPage = asBoolean(args, 'full_page', false);
		const selector = asString(args, 'selector').trim();
		const waitUntil = parseDesignScreenshotWaitUntil(args.wait_until);

		let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | undefined;
		try {
			throwIfAborted(ctx.signal);
			browser = await playwright.chromium.launch({ headless: true });
			const page = await browser.newPage();
			await navigateForScreenshot(page, href, waitUntil, timeoutMs, ctx.signal);

			throwIfAborted(ctx.signal);

			let png: Buffer;
			if (selector) {
				const locator = page.locator(selector).first();
				await locator.waitFor({ state: 'visible', timeout: timeoutMs });
				png = await locator.screenshot({ type: 'png', timeout: timeoutMs });
			} else {
				png = await page.screenshot({ type: 'png', fullPage, timeout: timeoutMs });
			}

			const { absPath, relativePath } = await ensureScreenshotDir();
			const fileName = `${Date.now()}.png`;
			const fileAbs = path.join(absPath, fileName);
			await fs.writeFile(fileAbs, png);
			const relFile = `${relativePath}/${fileName}`.replace(/\\/g, '/');

			return {
				ok: true,
				path: relFile,
				content: JSON.stringify(
					{
						url: href,
						path: relFile,
						bytes: png.byteLength,
						fullPage: selector ? false : fullPage,
						selector: selector || null,
						wait_until: waitUntil,
						note: `${DESIGN_SIMPLE_BROWSER_NOTE} Для JS-rendered capture используй design_screenshot.`,
					},
					null,
					2,
				),
			};
		} catch (err) {
			if (err instanceof PathPolicyError) {
				return makeToolError(err.message, {
					code: 'no_workspace',
					category: 'validation',
					retryable: false,
				});
			}

			const msg = err instanceof Error ? err.message : String(err);
			if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
				return makeToolError(`design_screenshot: Chromium не установлен. ${PLAYWRIGHT_INSTALL_HINT}`, {
					code: 'chromium_missing',
					category: 'internal',
					retryable: false,
				});
			}

			return makeToolError(`design_screenshot failed: ${msg}`, {
				code: 'screenshot_failed',
				category: 'network',
				retryable: true,
			});
		} finally {
			await browser?.close().catch(() => {});
		}
	},
};
