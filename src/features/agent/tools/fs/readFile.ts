import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getSettings } from '../../../../core/config/settings';
import { type IncomingImage, saveImageAttachments } from '../../../chat/attachments';
import { AGENT_LIMITS, looksBinary, previewText } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

const IMAGE_EXT_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

const PDF_VISION_HARD_MAX_PAGES = 6;

export function selectPdfPages(totalPages: number | undefined, requested: number[], maxPages: number): number[] {
	const cap = Math.max(1, Math.min(PDF_VISION_HARD_MAX_PAGES, Math.floor(maxPages)));
	const valid = [...new Set(requested.map(Math.floor).filter((page) => page >= 1 && (!totalPages || page <= totalPages)))];
	if (valid.length > 0) {
		return valid.slice(0, cap);
	}

	if (totalPages && totalPages > cap) {
		if (cap === 1) {
			return [1];
		}

		const firstCount = Math.ceil(cap / 2);
		const lastCount = cap - firstCount;
		return [
			...Array.from({ 
				length: firstCount 
			}, (_, i) => i + 1),
			...Array.from({ 
				length: lastCount 
			}, (_, i) => totalPages - lastCount + i + 1),
		];
	}

	return Array.from({
		length: Math.min(totalPages ?? cap, cap)
	}, (_, i) => i + 1);
}

function parseRequestedPages(args: Record<string, unknown>): number[] {
	const page = asOptionalInt(args, 'page');
	const pages = args.pages;
	const list = Array.isArray(pages)
		? pages.map(Number)
		: typeof pages === 'string'
			? pages.split(',').map((value) => Number(value.trim()))
			: [];
	return [...(page ? [page] : []), ...list].filter(Number.isFinite);
}

function runPdfInfoPages(fsPath: string, signal?: AbortSignal): Promise<number | undefined> {
	return new Promise((resolve) => {
		const child = spawn('pdfinfo', [fsPath], { 
			stdio: ['ignore', 'pipe', 'ignore'] 
		});
		let stdout = '';
		const onAbort = () => child.kill('SIGTERM');
		signal?.addEventListener('abort', onAbort, { once: true });
		child.stdout.on('data', (data) => { stdout += String(data); });
		child.on('error', () => resolve(undefined));
		child.on('close', () => {
			signal?.removeEventListener('abort', onAbort);
			const match = stdout.match(/^Pages:\s+(\d+)/mi);
			resolve(match ? Number(match[1]) : undefined);
		});
	});
}

function isPdfPath(relative: string): boolean {
	return relative.toLowerCase().endsWith('.pdf');
}

// MIME по расширению (.png/.jpg/.jpeg/.gif/.webp) - до looksBinary reject
function imageMimeFromPath(relative: string): string | undefined {
	const lower = relative.toLowerCase();
	const dot = lower.lastIndexOf('.');
	if (dot < 0) {
		return undefined;
	}

	return IMAGE_EXT_MIME[lower.slice(dot)];
}

function runPdftotextOnce(fsPath: string, page: number | undefined, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; missing: boolean; error: string }> {
	return new Promise((resolve) => {
		const pageArgs = page ? ['-f', String(page), '-l', String(page)] : [];
		const child = spawn('pdftotext', ['-layout', ...pageArgs, fsPath, '-'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		const onAbort = () => {
			child.kill('SIGTERM');
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		child.stdout.on('data', (d) => {
			stdout += String(d);
		});
		child.stderr.on('data', (d) => {
			stderr += String(d);
		});
		child.on('error', (err) => {
			signal?.removeEventListener('abort', onAbort);
			const msg = err instanceof Error ? err.message : String(err);
			const missing = (err as NodeJS.ErrnoException).code === 'ENOENT' || /ENOENT|not found/i.test(msg);
			resolve({
				ok: false,
				missing,
				error: msg,
			});
		});
		child.on('close', (code) => {
			signal?.removeEventListener('abort', onAbort);
			if (code === 0) {
				resolve({
					ok: true,
					text: stdout,
				});
				return;
			}
			resolve({
				ok: false,
				missing: false,
				error: stderr.trim() || `pdftotext exit ${code ?? '?'}`,
			});
		});
	});
}

async function runPdftotext(
	fsPath: string,
	pages: number[],
	signal?: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; missing: boolean; error: string }> {
	if (pages.length === 0) {
		return runPdftotextOnce(fsPath, undefined, signal);
	}

	const chunks: string[] = [];
	for (const page of [...new Set(pages.map(Math.floor).filter((value) => value >= 1))]) {
		const result = await runPdftotextOnce(fsPath, page, signal);
		if (!result.ok) {
			return result;
		}
		chunks.push(`--- PDF page ${page} ---\n${result.text.trim()}`);
	}

	return { 
		ok: true, 
		text: chunks.join('\n\n') 
	};
}

// Конвертация страниц PDF 1..maxPages в PNG через pdftoppm
async function runPdftoppmPages(
	fsPath: string,
	outPrefix: string,
	pages: number[],
	signal?: AbortSignal,
): Promise<{ ok: true; pngPaths: Array<{ path: string; page: number }> } | { ok: false; missing: boolean; error: string }> {
	const pngPaths: Array<{ path: string; page: number }> = [];
	for (const page of pages) {
		const result = await new Promise<{ ok: true; path: string } | { ok: false; missing: boolean; error: string }>((resolve) => {
		const prefix = `${outPrefix}-${page}`;
		const child = spawn(
			'pdftoppm',
			['-png', '-singlefile', '-f', String(page), '-l', String(page), '-r', '120', fsPath, prefix],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		);
		let stderr = '';
		const onAbort = () => {
			child.kill('SIGTERM');
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		child.stderr.on('data', (d) => {
			stderr += String(d);
		});
		child.on('error', (err) => {
			signal?.removeEventListener('abort', onAbort);
			const msg = err instanceof Error ? err.message : String(err);
			const missing = (err as NodeJS.ErrnoException).code === 'ENOENT' || /ENOENT|not found/i.test(msg);
			resolve({ ok: false, missing, error: msg });
		});
		child.on('close', (code) => {
			void (async () => {
				signal?.removeEventListener('abort', onAbort);
				if (code !== 0) {
					resolve({
						ok: false,
						missing: false,
						error: stderr.trim() || `pdftoppm exit ${code ?? '?'}`,
					});
					return;
				}
				const candidate = `${prefix}.png`;
				try {
					await fs.access(candidate);
				} catch {
					resolve({
						ok: false,
						missing: false,
						error: stderr.trim() || 'pdftoppm produced no PNG files',
					});
					return;
				}
				resolve({ 
					ok: true, 
					path: candidate 
				});
			})();
		});
		});
		if (!result.ok) {
			return result;
		}
		
		pngPaths.push({ 
			path: result.path, 
			page 
		});
	}
	return { 
		ok: true, 
		pngPaths 
	};
}

async function maybePdfVisionAttachment(
	pdfFsPath: string,
	relative: string,
	pages: number[],
	signal?: AbortSignal,
): Promise<{ attachments?: ToolResult['attachments']; note: string }> {
	const settings = getSettings();
	if (!settings.visionEnabled) {
		return {
			note: `visionEnabled=false - только текст (pdftotext). Включи vision для страниц PNG (до ${PDF_VISION_HARD_MAX_PAGES}).`,
		};
	}

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-pdf-'));
	const prefix = path.join(tmpDir, 'page');
	try {
		const rendered = await runPdftoppmPages(pdfFsPath, prefix, pages, signal);
		if (!rendered.ok) {
			if (rendered.missing) {
				return {
					note: 'pdftoppm недоступен - текст-only. Установи poppler-utils для multimodal PDF (страницы -> PNG).',
				};
			}
			return { note: `pdftoppm failed: ${rendered.error} - текст-only` };
		}

		const incoming: IncomingImage[] = [];
		const baseName = path.basename(relative, path.extname(relative)) || 'pdf';
		for (const renderedPage of rendered.pngPaths) {
			const raw = await fs.readFile(renderedPage.path);
			const base64 = raw.toString('base64');
			if (base64.length > settings.attachmentImageMaxBase64) {
				continue;
			}
			incoming.push({
				name: `${baseName}-page${renderedPage.page}.png`,
				mimeType: 'image/png',
				base64,
			});
		}
		if (incoming.length === 0) {
			return {
				note: 'PDF page PNGs too large for vision - текст-only',
			};
		}

		const saved = await saveImageAttachments(incoming);
		if (saved.length === 0) {
			return { note: 'PDF page PNG rendered but attachment save failed - текст-only' };
		}
		return {
			attachments: saved,
			note: `PDF multimodal: text + ${saved.length} page PNG(s) -> ${saved.map((s) => s.path).join(', ')}`,
		};
	} catch (err) {
		return {
			note: `PDF vision skip: ${err instanceof Error ? err.message : String(err)}`,
		};
	} finally {
		try {
			await fs.rm(tmpDir, { 
				recursive: true, 
				force: true 
			});
		} catch {}
	}
}

async function readPdfText(
	resolved: { uri: vscode.Uri; relative: string; fsPath?: string },
	requestedPages: number[],
	requestedMaxPages: number | undefined,
	signal?: AbortSignal,
): Promise<ToolResult> {
	const fsPath = resolved.uri.fsPath;
	const extracted = await runPdftotext(fsPath, requestedPages, signal);
	if (extracted.ok) {
		const text = extracted.text.trim();
		if (!text) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.pdfEmpty', resolved.relative),
			};
		}

		const settings = getSettings();
		const totalPages = await runPdfInfoPages(fsPath, signal);
		const maxPages = Math.min(requestedMaxPages ?? settings.pdfVisionMaxPages, settings.pdfVisionMaxPages, PDF_VISION_HARD_MAX_PAGES);
		const pages = selectPdfPages(totalPages, requestedPages, maxPages);
		const vision = await maybePdfVisionAttachment(fsPath, resolved.relative, pages, signal);
		const header = `${vscode.l10n.t('tool.pdfHeader', resolved.relative)}\n[${vision.note}]\n`;
		return {
			ok: true,
			content: previewText(`${header}${text}`, AGENT_LIMITS.maxReadBytes),
			attachments: vision.attachments,
			path: resolved.relative,
		};
	}

	if (extracted.missing) {
		return {
			ok: false,
			content: vscode.l10n.t('tool.pdfNeedPoppler', resolved.relative),
		};
	}

	return {
		ok: false,
		content: vscode.l10n.t('tool.pdfExtractFailed', resolved.relative, extracted.error),
	};
}

// Прочитать картинку * `.gen/attachments` + attachments для vision-цикла агента
async function readImageFile(
	resolved: {
		uri: vscode.Uri;
		relative: string;
	},
	mimeType: string,
): Promise<ToolResult> {
	const settings = getSettings();
	if (!settings.visionEnabled) {
		return {
			ok: false,
			content: vscode.l10n.t('tool.imageVisionDisabled', resolved.relative),
		};
	}

	let raw: Uint8Array;
	try {
		raw = await vscode.workspace.fs.readFile(resolved.uri);
	} catch {
		return {
			ok: false,
			content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
		};
	}

	const base64 = Buffer.from(raw).toString('base64');
	const maxB64 = settings.attachmentImageMaxBase64;
	if (base64.length > maxB64) {
		return {
			ok: false,
			content: vscode.l10n.t('tool.imageTooLarge', resolved.relative, base64.length, maxB64),
		};
	}

	const name = resolved.relative.split(/[/\\]/).pop() || 'image';
	const saved = await saveImageAttachments([
		{
			name,
			mimeType,
			base64,
		},
	]);
	if (saved.length === 0) {
		return {
			ok: false,
			content: vscode.l10n.t('tool.imageSaveFailed', resolved.relative),
		};
	}

	const att = saved[0]!;
	return {
		ok: true,
		content: vscode.l10n.t('tool.imageSaved', att.path),
		path: resolved.relative,
		attachments: saved,
	};
}

export const readFileTool: ToolDefinition = {
	name: 'read_file',
	description: 'Прочитать текстовый файл из workspace (PDF: text + selected page PNGs; page/pages/max_pages, vision cap max 6; long PDFs default to first+last pages).',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
			start_line: {
				type: 'integer',
				description: 'Первая строка (с 1)',
			},
			end_line: {
				type: 'integer',
				description: 'Последняя строка (включительно)',
			},
			page: { type: 'integer', description: 'PDF page number (1-based)' },
			pages: {
				type: 'array',
				items: { type: 'integer' },
				description: 'PDF page numbers (1-based)',
			},
			max_pages: { type: 'integer', description: 'PDF vision page cap (also limited by settings and hard max 6)' },
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));

		if (isPdfPath(resolved.relative)) {
			return readPdfText(resolved, parseRequestedPages(args), asOptionalInt(args, 'max_pages'), ctx.signal);
		}

		const imageMime = imageMimeFromPath(resolved.relative);
		if (imageMime) {
			return readImageFile(resolved, imageMime);
		}

		let raw: Uint8Array;
		try {
			raw = await vscode.workspace.fs.readFile(resolved.uri);
		} catch {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
			};
		}

		if (looksBinary(raw)) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.binaryFile', resolved.relative),
			};
		}

		if (raw.byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileTooLarge', raw.byteLength, AGENT_LIMITS.maxReadBytes),
			};
		}

		const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
		const lines = text.split(/\r?\n/);
		const start = Math.max(1, asOptionalInt(args, 'start_line') ?? 1);
		const end = Math.min(lines.length, asOptionalInt(args, 'end_line') ?? lines.length);
		if (start > end) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.badLineRange'),
			};
		}

		const numbered = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(6, ' ')}|${line}`);
		const body = numbered.join('\n');

		return {
			ok: true,
			content: previewText(
				`${vscode.l10n.t('tool.fileHeader', resolved.relative, start, end, lines.length)}\n${body}`,
				AGENT_LIMITS.maxReadBytes,
			),
		};
	},
};
