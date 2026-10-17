import * as vscode from 'vscode';
import { stripAnsi } from '../agent/ansi';

// Сколько символов держим на терминал в ring-буфере
const MAX_BUFFER_CHARS = 8_000;

export interface TerminalBufferSnapshot {
	name: string;
	text: string;
	lastCommand?: string;
	exitCode?: number;
	updatedAt?: number;
}

interface TerminalBufferEntry {
	text: string;
	lastCommand?: string;
	exitCode?: number;
	updatedAt: number;
	// Поколение активного read(), чтобы не писать устаревший stream
	readGen: number;
}

const buffers = new Map<string, TerminalBufferEntry>();
let started = false;
let subscription: vscode.Disposable | undefined;

function terminalKey(term: vscode.Terminal): string {
	return term.name || 'Terminal';
}

function getOrCreate(key: string): TerminalBufferEntry {
	let entry = buffers.get(key);
	if (!entry) {
		entry = {
			text: '',
			updatedAt: Date.now(),
			readGen: 0,
		};
		buffers.set(key, entry);
	}

	return entry;
}

export { stripAnsi } from '../agent/ansi';

function append(key: string, data: string): void {
	const cleaned = stripAnsi(data);
	if (!cleaned) {
		return;
	}

	const entry = getOrCreate(key);
	const next = (entry.text + cleaned).length > MAX_BUFFER_CHARS
		? (entry.text + cleaned).slice(-MAX_BUFFER_CHARS)
		: entry.text + cleaned;
	entry.text = next;
	entry.updatedAt = Date.now();
}

async function streamExecution(
	key: string,
	execution: vscode.TerminalShellExecution,
	gen: number,
): Promise<void> {
	try {
		for await (const data of execution.read()) {
			const entry = buffers.get(key);
			if (!entry || entry.readGen !== gen) {
				break;
			}

			append(key, data);
			if ((entry.text?.length ?? 0) >= MAX_BUFFER_CHARS) {
				break;
			}
		}
	} catch {}
}

/**
 * Подписка на вывод терминалов через Shell Integration:
 * - `onDidStartTerminalShellExecution` + `execution.read()` - live stream во время команды
 * - `onDidEndTerminalShellExecution` - код выхода и командная строка
 *
 * Не используем proposed `onDidWriteTerminalData`.
 * Идемпотентно - повторный вызов безопасен.
 */
export function ensureTerminalBufferListener(): vscode.Disposable {
	if (started && subscription) {
		return subscription;
	}

	started = true;
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.window.onDidStartTerminalShellExecution((e) => {
			const key = terminalKey(e.terminal);
			const entry = getOrCreate(key);
			entry.readGen += 1;
			const gen = entry.readGen;
			const cmd = e.execution.commandLine?.value?.trim();
			if (cmd) {
				entry.lastCommand = cmd;
				entry.exitCode = undefined;
				append(key, `\n$ ${cmd}\n`);
			}

			void streamExecution(key, e.execution, gen);
		}),
	);

	disposables.push(
		vscode.window.onDidEndTerminalShellExecution((e) => {
			const key = terminalKey(e.terminal);
			const entry = getOrCreate(key);
			const cmd = e.execution.commandLine?.value?.trim();
			if (cmd) {
				entry.lastCommand = cmd;
			}

			if (typeof e.exitCode === 'number') {
				entry.exitCode = e.exitCode;
				append(key, `\n[exit ${e.exitCode}]\n`);
			}

			entry.updatedAt = Date.now();

			// Резервный вариант: если стартовый поток не успел подключиться (нет shell integration при запуске), дочитаем хвост
			if (!entry.text.trim()) {
				void (async () => {
					try {
						let chunk = '';
						for await (const data of e.execution.read()) {
							chunk += data;
							if (chunk.length >= MAX_BUFFER_CHARS) {
								break;
							}
						}
						append(key, chunk.slice(0, MAX_BUFFER_CHARS));
					} catch {}
				})();
			}
		}),
	);

	disposables.push(
		vscode.window.onDidCloseTerminal((term) => {
			buffers.delete(terminalKey(term));
		}),
	);

	subscription = vscode.Disposable.from(...disposables, {
		dispose: () => {
			started = false;
			subscription = undefined;
			buffers.clear();
		},
	});
	return subscription;
}

// Снимки буферов открытых терминалов (имя * хвост вывода + meta)
export function getTerminalBuffers(): TerminalBufferSnapshot[] {
	ensureTerminalBufferListener();

	const out: TerminalBufferSnapshot[] = [];
	const seen = new Set<string>();

	for (const term of vscode.window.terminals) {
		const name = terminalKey(term);
		if (seen.has(name)) {
			continue;
		}

		seen.add(name);
		const entry = buffers.get(name);
		out.push({
			name,
			text: entry?.text ?? '',
			lastCommand: entry?.lastCommand,
			exitCode: entry?.exitCode,
			updatedAt: entry?.updatedAt,
		});
	}

	// Свежие сверху
	out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	return out;
}

/**
 * Краткое приложение с терминалами для режима Debug (без явного @terminals).
 * Пусто - если нет терминалов / нет вывода.
 */
export function formatDebugTerminalsAppendix(maxTotalChars = 3_000): string | undefined {
	ensureTerminalBufferListener();
	const terminals = getTerminalBuffers().filter((t) => t.text.trim() || t.lastCommand);
	if (terminals.length === 0) {
		return undefined;
	}

	const parts: string[] = ['Live terminals (Debug):'];
	let used = parts[0]!.length;
	for (const t of terminals.slice(0, 4)) {
		const meta = [
			t.lastCommand ? `cmd: ${t.lastCommand}` : undefined,
			typeof t.exitCode === 'number' ? `exit: ${t.exitCode}` : undefined,
		].filter(Boolean).join('; ');
		const header = meta ? `[terminal:${t.name}] (${meta})` : `[terminal:${t.name}]`;
		const body = t.text.trim()
			? (t.text.length > 1_200 ? t.text.slice(-1_200) : t.text)
			: '(нет буферизованного вывода)';
		const block = `${header}\n${body}`;
		if (used + block.length + 2 > maxTotalChars) {
			break;
		}

		parts.push(block);
		used += block.length + 2;
	}

	return parts.length > 1 ? parts.join('\n\n') : undefined;
}
