import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { assertAllowedCommand, formatCommandLine } from './commandPolicy';
import { AGENT_LIMITS, previewText } from './policy';
import { resolveShellCwd } from './shellCwd';
import { resolveWorkspacePath } from './workspacePath';

export interface BackgroundJob {
	id: string;
	commandLine: string;
	cwd: string;
	startedAt: number;
	done: boolean;
	exitCode?: number;
	output: string;
	error?: string;
}

// Сохраняет cwd между вызовами run_command и ведёт фоновые shell-задачи
export class ShellSession {
	cwd: string;
	private jobs = new Map<string, BackgroundJob>();
	private nextId = 1;

	constructor(rootCwd: string) {
		this.cwd = rootCwd;
	}

	async resolveCwd(relativeOrAbs?: string): Promise<string> {
		return resolveShellCwd(this.cwd, relativeOrAbs, resolveWorkspacePath);
	}

	async applyCd(command: string, args: string[]): Promise<void> {
		if (command === 'cd' && args.length === 1) {
			this.cwd = await this.resolveCwd(args[0]);
		}
	}

	async startBackground(
		command: string,
		args: string[],
		cwd: string,
		signal?: AbortSignal,
		envExtra?: Record<string, string>,
	): Promise<BackgroundJob> {
		assertAllowedCommand(command, args);
		const allowedCwd = await resolveShellCwd(this.cwd, cwd, resolveWorkspacePath);
		const id = `job_${this.nextId++}`;
		const commandLine = formatCommandLine(command, args);
		const job: BackgroundJob = {
			id,
			commandLine,
			cwd: allowedCwd,
			startedAt: Date.now(),
			done: false,
			output: '',
		};
		this.jobs.set(id, job);

		const proc = spawn(command, args, {
			cwd: allowedCwd,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				...(envExtra ?? {}),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const onChunk = (chunk: Buffer | string) => {
			job.output += String(chunk);
			if (job.output.length > AGENT_LIMITS.maxCommandOutput) {
				job.output = job.output.slice(-AGENT_LIMITS.maxCommandOutput);
			}
		};
		proc.stdout?.on('data', onChunk);
		proc.stderr?.on('data', onChunk);
		proc.on('close', (code) => {
			job.done = true;
			job.exitCode = code ?? 1;
		});
		proc.on('error', (err) => {
			job.done = true;
			job.exitCode = 1;
			job.error = err.message;
		});
		signal?.addEventListener('abort', () => {
			try {
				proc.kill('SIGKILL');
			} catch {}
		}, { once: true });

		return job;
	}

	getJob(id: string): BackgroundJob | undefined {
		return this.jobs.get(id);
	}

	formatJob(job: BackgroundJob): string {
		const lines = [
			`job: ${job.id}`,
			`$ ${job.commandLine}`,
			`cwd: ${job.cwd}`,
			job.done ? `exit: ${job.exitCode ?? '?'}` : 'статус: выполняется',
		];
		if (job.error) {
			lines.push(`ошибка: ${job.error}`);
		}

		if (job.output.trim()) {
			lines.push('вывод:', previewText(job.output.trimEnd(), AGENT_LIMITS.maxCommandOutput));
		}
		
		return lines.join('\n');
	}
}

export function defaultWorkspaceCwd(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
