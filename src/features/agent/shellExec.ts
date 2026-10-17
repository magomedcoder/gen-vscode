import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { assertAllowedCommand, CommandPolicyError, formatCommandLine } from './commandPolicy';
import { AGENT_LIMITS, previewText } from './policy';

export interface ShellExecRequest {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	// Доп. env (например из hook shell.env)
	env?: Record<string, string>;
	/**
	 * Потоковый вывод (stdout+stderr) для UI во время long shell.
	 * Вызывается с накопленным сырым текстом (уже capped).
	 */
	onPartialOutput?: (accumulatedRaw: string) => void;
	// Доверенный script runner (run_scratch): бинарь из denylist разрешён
	allowDeniedBinary?: boolean;
}

export interface ShellExecResult {
	ok: boolean;
	exitCode: number;
	content: string;
	commandLine: string;
	timedOut: boolean;
}

function clampTimeout(ms: number | undefined): number {
	const settings = getSettings();
	const defaultMs = settings.defaultToolTimeoutMs || AGENT_LIMITS.defaultCommandTimeoutMs;
	const maxMs = settings.maxToolTimeoutMs || AGENT_LIMITS.maxCommandTimeoutMs;
	const value = ms ?? defaultMs;
	return Math.min(maxMs, Math.max(1000, Math.floor(value)));
}

// Формат финального/промежуточного вывода shell (для UI и tool result)
export function formatExecOutput(params: {
	commandLine: string;
	cwd: string;
	exitCode: number | string;
	stdout: string;
	stderr: string;
	truncated?: boolean;
	// Пока команда ещё бежит - показываем running вместо exit
	running?: boolean;
}): string {
	const lines = [
		`$ ${params.commandLine}`,
		`cwd: ${params.cwd}`,
		params.running ? 'exit: running...' : `exit: ${params.exitCode}`,
	];

	if (params.stdout.trim()) {
		lines.push('stdout:', params.stdout.trimEnd());
	}

	if (params.stderr.trim()) {
		lines.push('stderr:', params.stderr.trimEnd());
	}

	if (params.truncated) {
		lines.push(vscode.l10n.t('shell.outputTruncated', AGENT_LIMITS.maxCommandOutput));
	}

	return lines.join('\n');
}

// Разделить накопленный stdout+stderr поток на «как будто» один stdout для preview (spawn склеивает оба в один буфер).
export function formatPartialShellPreview(params: {
	commandLine: string;
	cwd: string;
	raw: string;
}): string {
	const body = formatExecOutput({
		commandLine: params.commandLine,
		cwd: params.cwd,
		exitCode: 'running...',
		stdout: params.raw,
		stderr: '',
		running: true,
		truncated: params.raw.length >= AGENT_LIMITS.maxCommandOutput,
	});
	return previewText(body, AGENT_LIMITS.maxCommandOutput);
}

export async function runShellCommand(request: ShellExecRequest): Promise<ShellExecResult> {
	const args = request.args ?? [];
	assertAllowedCommand(request.command, args, undefined, {
		allowDeniedBinary: request.allowDeniedBinary,
	});

	const commandLine = formatCommandLine(request.command, args);
	const timeout = clampTimeout(request.timeoutMs);

	try {
		const { stdout, stderr, exitCode, truncated, killedByTimeout } = await spawnShellCollect({
			command: request.command,
			args,
			cwd: request.cwd,
			timeout,
			signal: request.signal,
			env: request.env,
			onPartialOutput: request.onPartialOutput
				? (raw) => {
					request.onPartialOutput?.(raw);
				}
				: undefined,
		});

		if (request.signal?.aborted) {
			const abortErr = new Error(vscode.l10n.t('agent.operationCancelled'));
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		const body = formatExecOutput({
			commandLine,
			cwd: request.cwd,
			exitCode,
			stdout,
			stderr: killedByTimeout
				? `${stderr}\n${vscode.l10n.t('shell.timeout', timeout)}`.trim()
				: stderr,
			truncated,
		});

		return {
			ok: exitCode === 0 && !killedByTimeout,
			exitCode,
			content: previewText(body, AGENT_LIMITS.maxCommandOutput),
			commandLine,
			timedOut: killedByTimeout,
		};
	} catch (err) {
		if (err instanceof Error && (err.name === 'AbortError' || request.signal?.aborted)) {
			const abortErr = new Error(vscode.l10n.t('agent.operationCancelled'));
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		if (err instanceof CommandPolicyError) {
			return {
				ok: false,
				exitCode: 1,
				content: err.message,
				commandLine,
				timedOut: false,
			};
		}

		throw err;
	}
}

type SpawnCollectResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	truncated: boolean;
	killedByTimeout: boolean;
};

// Spawn + сбор stdout/stderr с необязательным partial callback и отменой без гонок status
function spawnShellCollect(params: {
	command: string;
	args: string[];
	cwd: string;
	timeout: number;
	signal?: AbortSignal;
	env?: Record<string, string>;
	onPartialOutput?: (accumulatedRaw: string) => void;
}): Promise<SpawnCollectResult> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let stdout = '';
		let stderr = '';
		let combined = '';
		let truncated = false;
		let killedByTimeout = false;

		const proc = spawn(params.command, params.args, {
			cwd: params.cwd,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				...(params.env ?? {}),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			params.signal?.removeEventListener('abort', onAbort);
			fn();
		};

		const append = (which: 'out' | 'err', chunk: Buffer | string) => {
			const text = String(chunk);
			if (which === 'out') {
				stdout += text;
				if (stdout.length > AGENT_LIMITS.maxCommandOutput) {
					stdout = stdout.slice(-AGENT_LIMITS.maxCommandOutput);
					truncated = true;
				}
			} else {
				stderr += text;
				if (stderr.length > AGENT_LIMITS.maxCommandOutput) {
					stderr = stderr.slice(-AGENT_LIMITS.maxCommandOutput);
					truncated = true;
				}
			}

			combined += text;
			if (combined.length > AGENT_LIMITS.maxCommandOutput) {
				combined = combined.slice(-AGENT_LIMITS.maxCommandOutput);
				truncated = true;
			}

			params.onPartialOutput?.(combined);
		};

		proc.stdout?.on('data', (c) => append('out', c));
		proc.stderr?.on('data', (c) => append('err', c));

		const killProc = () => {
			try {
				proc.kill('SIGKILL');
			} catch {}
		};

		const onAbort = () => {
			killProc();
			finish(() => {
				const abortErr = new Error('AbortError');
				abortErr.name = 'AbortError';
				reject(abortErr);
			});
		};

		if (params.signal) {
			if (params.signal.aborted) {
				onAbort();
				return;
			}
			params.signal.addEventListener('abort', onAbort, { once: true });
		}

		const timer = setTimeout(() => {
			killedByTimeout = true;
			killProc();
		}, params.timeout);

		proc.on('error', (err) => {
			finish(() => {
				// ENOENT и т.п. - как неуспешный exit с сообщением в stderr
				resolve({
					stdout,
					stderr: stderr || (err instanceof Error ? err.message : String(err)),
					exitCode: 1,
					truncated,
					killedByTimeout: false,
				});
			});
		});

		proc.on('close', (code) => {
			finish(() => {
				if (params.signal?.aborted) {
					const abortErr = new Error('AbortError');
					abortErr.name = 'AbortError';
					reject(abortErr);
					return;
				}

				resolve({
					stdout,
					stderr,
					exitCode: code ?? (killedByTimeout ? 1 : 0),
					truncated,
					killedByTimeout,
				});
			});
		});
	});
}
