import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import type { ChatContentPart } from '../../core/llm/types';
import { resizeImageHost } from './imageResize';

export interface IncomingImage {
	name: string;
	mimeType: string;
	base64: string;
}

export interface ImageAttachment {
	// Относительный путь в workspace, например `.gen/attachments/...`
	path: string;
	mimeType: string;
}

function sanitizeFileName(name: string): string {
	const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'image';
	return base.slice(0, 80);
}

function extForMime(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes('png')) {
		return 'png';
	}

	if (m.includes('jpeg') || m.includes('jpg')) {
		return 'jpg';
	}

	if (m.includes('gif')) {
		return 'gif';
	}

	if (m.includes('webp')) {
		return 'webp';
	}

	return 'png';
}

export interface SaveImageAttachmentsResult {
	attachments: ImageAttachment[];
	notes: string[];
}

// Сохранить картинки в `.gen/attachments/` и вернуть метаданные
export async function saveImageAttachments(images: readonly IncomingImage[]): Promise<SaveImageAttachmentsResult> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || images.length === 0) {
		return { attachments: [], notes: [] };
	}

	const dir = vscode.Uri.joinPath(folder.uri, '.gen', 'attachments');
	try {
		await vscode.workspace.fs.stat(dir);
	} catch {
		await vscode.workspace.fs.createDirectory(dir);
	}

	const out: ImageAttachment[] = [];
	const notes: string[] = [];
	const stamp = Date.now();

	for (let i = 0; i < images.length; i += 1) {
		const img = images[i]!;
		const mime = (img.mimeType || 'image/png').split(';')[0]!.trim() || 'image/png';
		const safe = sanitizeFileName(img.name.replace(/\.[^.]+$/, '') || 'image');
		const raw = Buffer.from(img.base64, 'base64');
		const settings = getSettings();
		const processed = settings.attachmentImageAutoResize
			? await resizeImageHost(raw, mime, {
				maxWidth: settings.attachmentImageMaxWidth,
				maxHeight: settings.attachmentImageMaxHeight,
				quality: settings.attachmentImageQuality,
			})
			: { 
				bytes: raw, 
				mimeType: mime, 
				resized: false,
				warning: undefined as string | undefined,
			};
		if (processed.warning) {
			notes.push(`${img.name || safe}: ${processed.warning}`);
		}
		const ext = extForMime(processed.mimeType);
		const fileName = `${stamp}-${i}-${safe}.${ext}`;
		const uri = vscode.Uri.joinPath(dir, fileName);
		await vscode.workspace.fs.writeFile(uri, processed.bytes);
		out.push({
			path: `.gen/attachments/${fileName}`,
			mimeType: processed.mimeType,
		});
	}

	return { attachments: out, notes };
}

// Вставить маркеры `[image path]` в текст пользователя
export function injectImagePathMarkers(text: string, attachments: readonly ImageAttachment[]): string {
	if (attachments.length === 0) {
		return text;
	}

	const markers = attachments.map((a) => `[image ${a.path}]`).join('\n');
	const trimmed = text.trim();
	return trimmed ? `${trimmed}\n\n${markers}` : markers;
}

// Собрать multimodal content для vision-модели (OpenAI-compatible image_url)
export async function buildUserContentWithImages(
	text: string,
	attachments: readonly ImageAttachment[] | undefined,
): Promise<string | ChatContentPart[]> {
	const settings = getSettings();
	if (!settings.visionEnabled || !attachments?.length) {
		return text;
	}

	let textBody = text;
	const imageParts: ChatContentPart[] = [];
	const maxB64 = settings.attachmentImageMaxBase64;
	const folder = vscode.workspace.workspaceFolders?.[0];

	for (const att of attachments) {
		if (!folder) {
			break;
		}

		try {
			const uri = vscode.Uri.joinPath(folder.uri, ...att.path.split('/'));
			let bytes = await vscode.workspace.fs.readFile(uri);
			let mime = att.mimeType || 'image/png';
			if (settings.attachmentImageAutoResize) {
				const processed = await resizeImageHost(bytes, mime, {
					maxWidth: settings.attachmentImageMaxWidth,
					maxHeight: settings.attachmentImageMaxHeight,
					quality: settings.attachmentImageQuality,
					maxBytes: Math.floor(maxB64 * 0.75),
				});
				bytes = processed.bytes;
				mime = processed.mimeType;
				if (processed.warning) {
					textBody += `\n\n[image ${att.path}: ${processed.warning}; using original if within budget]`;
				}
			}
			const b64 = Buffer.from(bytes).toString('base64');
			if (b64.length > maxB64) {
				textBody += `\n\n[image ${att.path}: base64 слишком большой (${b64.length} > ${maxB64}), только путь]`;
				continue;
			}

			imageParts.push({
				type: 'image_url',
				image_url: { 
					url: `data:${mime};base64,${b64}` 
				},
			});
		} catch {
			textBody += `\n\n[image ${att.path}: не удалось прочитать]`;
		}
	}

	if (imageParts.length === 0) {
		return textBody;
	}

	return [{ 
		type: 'text', 
		text: textBody 
	}, ...imageParts];
}
