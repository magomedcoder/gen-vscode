import * as vscode from 'vscode';
import { formatMiniDiff } from './diff';
import { AGENT_LIMITS } from './policy';

const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_CHARS = 3_000;

interface WriteSnapshot {
	uri: vscode.Uri;
	relative: string;
	content: string;
}

// Ограничено сессией: содержимое после последней успешной записи/исправления файла агентом
export class AgentWriteTracker {
	private readonly snapshots = new Map<string, WriteSnapshot>();

	get size(): number {
		return this.snapshots.size;
	}

	clear(): void {
		this.snapshots.clear();
	}

	remember(uri: vscode.Uri, relative: string, content: string): void {
		if (content.length > AGENT_LIMITS.maxReadBytes) {
			this.snapshots.delete(uri.toString());
			return;
		}

		this.snapshots.set(uri.toString(), { uri, relative, content });
	}

	forget(uri: vscode.Uri): void {
		this.snapshots.delete(uri.toString());
	}

	getSnapshot(uri: vscode.Uri): string | undefined {
		return this.snapshots.get(uri.toString())?.content;
	}

	// Сравнение снимков агентов -> текущий буфер (редактирование пользователем). 
	// Не определено, если снимок отсутствует или идентичен
	userDiff(uri: vscode.Uri, current: string): string | undefined {
		const snap = this.snapshots.get(uri.toString());
		if (!snap || snap.content === current) {
			return undefined;
		}

		return formatMiniDiff(snap.content, current);
	}

	hasUserEdits(uri: vscode.Uri, current: string): boolean {
		return this.userDiff(uri, current) !== undefined;
	}

	// Краткий блок для системной подсказки: файлы, измененные пользователем после работы агента
	async buildPromptAppendix(): Promise<string> {
		const drifts: Array<{ relative: string; diff: string }> = [];

		for (const snap of this.snapshots.values()) {
			if (drifts.length >= MAX_CONTEXT_FILES) {
				break;
			}

			let current: string;
			try {
				const doc = await vscode.workspace.openTextDocument(snap.uri);
				current = doc.getText();
			} catch {
				continue;
			}

			if (current === snap.content) {
				continue;
			}

			const diff = formatMiniDiff(snap.content, current);
			if (!diff) {
				continue;
			}

			drifts.push({ 
				relative: snap.relative, 
				diff 
			});
		}

		if (drifts.length === 0) {
			return '';
		}

		const body = drifts.map((item) => `Файл ${item.relative} (правки пользователя после агента):\n${item.diff}`).join('\n\n');
		const truncated = body.length > MAX_CONTEXT_CHARS ? `${body.slice(0, MAX_CONTEXT_CHARS)}\n... [обрезано]` : body;

		return `Пользователь правил файлы после агента. Не откатывай эти правки, если задача явно не требует. Не используй полный write_file поверх них - только точечные правки (apply_diff / apply_patch / apply_workspace_edit, что есть в tools) по актуальному тексту (сначала read_file).\n${truncated}`;
	}
}

export function denyWriteOverUserEdits(relative: string, userDiff: string): string {
	return [
		`Файл ${relative} изменён пользователем после последней записи агента.`,
		'Полный write_file запрещён - затрёт правки пользователя.',
		'Сделай read_file, затем точечные правки (apply_diff, apply_patch или apply_workspace_edit - что доступно) по актуальному тексту.',
		userDiff ? `\nПравки пользователя (снимок агента -> сейчас):\n${userDiff}` : '',
	]
		.filter(Boolean)
		.join(' ');
}
