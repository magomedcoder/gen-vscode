import * as path from 'node:path';

export interface ScriptRunner {
	command: string;
	argsPrefix: string[];
	// Альтернатива, если основной бинарь не найден (ENOENT)
	fallback?: { command: string; argsPrefix: string[] };
}

const NODE = {
	command: 'node',
	argsPrefix: [] as string[]
};
const NODE_TS = {
	command: 'node',
	argsPrefix: ['--experimental-strip-types']
};
const PYTHON = {
	command: process.platform === 'win32' ? 'python' : 'python3',
	argsPrefix: [] as string[],
	fallback: process.platform === 'win32'
		? {
			command: 'python3',
			argsPrefix: [] as string[]
		}
		: {
			command: 'python',
			argsPrefix: [] as string[]
		},
};

const BASH: ScriptRunner = {
	command: 'bash',
	argsPrefix: [],
	fallback: process.platform === 'win32' ? {
		command: 'sh',
		argsPrefix: []
	} : undefined,
};

// Сначала PowerShell Core; запасной Windows PowerShell. Только `-File` (не -Command)
const POWERSHELL: ScriptRunner = {
	command: 'pwsh',
	argsPrefix: ['-NoProfile', '-File'],
	fallback: process.platform === 'win32'
		? {
			command: 'powershell',
			argsPrefix: ['-NoProfile', '-NonInteractive', '-File']
		}
		: undefined,
};

const BY_EXT: Record<string, ScriptRunner> = {
	'.js': NODE,
	'.mjs': NODE,
	'.cjs': NODE,
	'.ts': NODE_TS,
	'.py': PYTHON,
	'.sh': BASH,
	'.bash': BASH,
	'.ps1': POWERSHELL,
};

export function supportedScratchExtensions(): string[] {
	return Object.keys(BY_EXT).sort();
}

export function resolveScriptRunner(filePathOrExt: string): ScriptRunner | undefined {
	const ext = (filePathOrExt.startsWith('.')
		? filePathOrExt
		: path.posix.extname(filePathOrExt.replace(/\\/g, '/'))
	).toLowerCase();
	return BY_EXT[ext];
}

/**
 * Shell для одноразовых start-команд worktree / hooks.
 * Unix: /bin/sh -c; Windows: pwsh -NoProfile -Command (запасной cmd.exe).
 */
export function resolveHostShellInvoker(): {
	command: string;
	argsFor: (script: string) => string[];
	fallback?: {
		command: string;
		argsFor: (script: string) => string[]
	};
} {
	if (process.platform === 'win32') {
		return {
			command: 'pwsh',
			argsFor: (script) => ['-NoProfile', '-NonInteractive', '-Command', script],
			fallback: {
				command: 'cmd.exe',
				argsFor: (script) => ['/d', '/s', '/c', script],
			},
		};
	}

	return {
		command: '/bin/sh',
		argsFor: (script) => ['-c', script],
	};
}
