import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';
import type { ChatUiMessage } from './protocol';
import { redactSecrets } from '../agent/secrets';

const DIR_NAME = 'export-archives';

function archivesRoot(context: ExtensionContext): string | undefined {
	const base = context.storageUri?.fsPath;
	if (!base) {
		return undefined;
	}

	return path.join(base, DIR_NAME);
}

function archivePath(context: ExtensionContext, sessionId: string): string | undefined {
	const root = archivesRoot(context);
	if (!root) {
		return undefined;
	}

	const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
	return path.join(root, `${safe}.json`);
}

// Сохранить полный архив сессии до сжатия в хранилище workspace
export async function saveExportArchive(
	context: ExtensionContext,
	sessionId: string,
	messages: ChatUiMessage[],
	options?: { rawExport?: boolean },
): Promise<void> {
	const file = archivePath(context, sessionId);
	if (!file) {
		return;
	}
	if (options?.rawExport) {
		void vscode.window.showWarningMessage(vscode.l10n.t('chat.export.rawWarning'));
	}

	await fs.mkdir(path.dirname(file), { recursive: true });
	const storedMessages = options?.rawExport
		? messages
		: messages.map((message) => ({
			...message,
			content: redactSecrets(message.content).text,
			toolArgs: message.toolArgs ? redactSecrets(message.toolArgs).text : message.toolArgs,
			toolCalls: message.toolCalls?.map((call) => ({
				...call,
				arguments: redactSecrets(call.arguments).text,
				result: call.result ? redactSecrets(call.result).text : call.result,
			})),
		}));
	const payload = {
		version: 1,
		sessionId,
		savedAt: Date.now(),
		messages: storedMessages,
	};
	await fs.writeFile(file, JSON.stringify(payload), 'utf8');
}

export type ExportArchiveLoadResult = | { status: 'ok'; messages: ChatUiMessage[] }
	| { status: 'not_found' }
	| { status: 'corrupt'; quarantinedPath?: string; error: string };

export async function loadExportArchiveResult(
	context: ExtensionContext,
	sessionId: string,
): Promise<ExportArchiveLoadResult> {
	const file = archivePath(context, sessionId);
	if (!file) {
		return { status: 'not_found' };
	}

	try {
		const raw = await fs.readFile(file, 'utf8');
		const parsed = JSON.parse(raw) as { messages?: unknown };
		if (!Array.isArray(parsed.messages)) {
			throw new Error(vscode.l10n.t('chat.export.invalidArchiveMessages'));
		}

		return {
			status: 'ok',
			messages: parsed.messages.filter((m): m is ChatUiMessage => Boolean(m && typeof m === 'object' && typeof (m as ChatUiMessage).id === 'string')),
		};
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { status: 'not_found' };
		}
		
		const quarantinedPath = `${file}.corrupt-${Date.now()}`;
		try {
			await fs.rename(file, quarantinedPath);
		} catch {}
		const error = err instanceof Error ? err.message : String(err);
		return { 
			status: 'corrupt', 
			quarantinedPath, 
			error 
		};
	}
}

export async function loadExportArchive(
	context: ExtensionContext,
	sessionId: string,
): Promise<ChatUiMessage[] | undefined> {
	const result = await loadExportArchiveResult(context, sessionId);
	return result.status === 'ok' ? result.messages : undefined;
}

// Удалить файл архива сессии
export async function deleteExportArchive(context: ExtensionContext, sessionId: string): Promise<void> {
	const file = archivePath(context, sessionId);
	if (!file) {
		return;
	}

	try {
		await fs.unlink(file);
	} catch {}
}

// Есть ли файл архива на диске (без чтения содержимого)
export async function exportArchiveExists(context: ExtensionContext, sessionId: string): Promise<boolean> {
	const file = archivePath(context, sessionId);
	if (!file) {
		return false;
	}

	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}
