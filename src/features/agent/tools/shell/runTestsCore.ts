import * as path from 'node:path';
import type { DetectedTestCommand } from '../../detectTestCommand';

export interface TestFailure {
	file: string;
	line: number;
	message: string;
	score: number;
}

function cleanFile(file: string): string {
	return file.trim().replace(/^[>❯●\s]+/, '').replace(/^file:\/\//, '').replace(/\\/g, '/');
}

function addFailure(
	out: Map<string, TestFailure>,
	file: string,
	line: string | number,
	message: string,
	score: number,
): void {
	const normalizedFile = cleanFile(file);
	const lineNumber = Math.max(1, Number(line) || 1);
	const normalizedMessage = message.trim().replace(/\s+/g, ' ').slice(0, 500);
	if (!normalizedFile || !normalizedMessage || /node_modules\//.test(normalizedFile)) {
		return;
	}

	const key = `${normalizedFile}:${lineNumber}:${normalizedMessage}`;
	const existing = out.get(key);
	if (!existing || existing.score < score) {
		out.set(key, { file: normalizedFile, line: lineNumber, message: normalizedMessage, score });
	}
}

export function parseTestFailures(output: string): TestFailure[] {
	const failures = new Map<string, TestFailure>();
	const lines = output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
	let failureTitle = '';
	let assertionMessage = '';

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const title = line.match(/^(?:FAIL\s+(.+?)(?:\s+>\s+(.+))?|●\s+(.+))$/);
		if (title) {
			failureTitle = (title[2] || title[3] || title[1] || '').trim();
			continue;
		}

		const pytestFailed = line.match(/^FAILED\s+(.+?\.py)(?:::(.+?))?(?:\s+-\s+(.+))?$/);
		if (pytestFailed) {
			addFailure(failures, pytestFailed[1], 1, pytestFailed[3] || pytestFailed[2] || 'pytest failure', 95);
			continue;
		}

		const rust = line.match(/^-->\s+(.+?\.rs):(\d+):\d+/);
		if (rust) {
			addFailure(failures, rust[1], rust[2], assertionMessage || failureTitle || 'Cargo test failure', 90);
			continue;
		}

		const stack = line.match(/(?:at\s+.+?\s+\(|at\s+)?(.+?\.(?:[cm]?[jt]sx?|py)):(\d+):\d+\)?$/);
		if (stack) {
			addFailure(failures, stack[1], stack[2], assertionMessage || failureTitle || 'Test failure', 75);
			continue;
		}

		const panic = line.match(/^thread\s+'([^']+)'\s+panicked\s+at\s+(.+?\.rs):(\d+):\d+:\s*(.*)$/);
		if (panic) {
			addFailure(failures, panic[2], panic[3], panic[4] || `thread '${panic[1]}' panicked`, 100);
			continue;
		}

		const direct = line.match(/^(.+?\.(?:[cm]?[jt]sx?|py|go|rs)):(\d+)(?::\d+)?(?::|\s+-)\s*(.+)$/);
		if (direct) {
			addFailure(failures, direct[1], direct[2], direct[3], 100);
			continue;
		}

		if (/^(?:AssertionError|Error:|assertion failed:|panic:|E\s+)/.test(line)) {
			assertionMessage = line.replace(/^E\s+/, '').trim();
		}
	}

	return [...failures.values()]
		.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
		.slice(0, 50);
}

function packageManagerSeparator(command: string): string[] {
	return command === 'npm' || command === 'pnpm' ? ['--'] : [];
}

function goPackages(paths: string[]): string[] {
	const packages = new Set<string>();
	for (const value of paths) {
		const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
		const dir = path.posix.dirname(normalized);
		packages.add(dir === '.' ? '.' : `./${dir}`);
	}

	return [...packages];
}

export function applyTestFilters(
	detected: DetectedTestCommand,
	options: { paths?: string[]; filter?: string },
): string[] {
	const paths = (options.paths ?? []).map((value) => value.trim()).filter(Boolean);
	const filter = options.filter?.trim();
	const args = [...detected.args];

	switch (detected.runner) {
		case 'jest':
			if (paths.length > 0 || filter) {
				args.push(...packageManagerSeparator(detected.command));
				if (paths.length > 0) {
					args.push('--runTestsByPath', ...paths);
				}

				if (filter) {
					args.push('--testNamePattern', filter);
				}
			}
			break;
		case 'vitest':
		case 'node':
			if (paths.length > 0 || filter) {
				args.push(...packageManagerSeparator(detected.command), ...paths);
				if (filter) {
					args.push('-t', filter);
				}
			}

			break;
		case 'pytest':
			args.push(...paths);
			if (filter) {
				args.push('-k', filter);
			}

			break;
		case 'go':
			if (paths.length > 0) {
				args.splice(1, args.length - 1, ...goPackages(paths));
			}

			if (filter) {
				args.push('-run', filter);
			}
			
			break;
		case 'cargo':
			if (filter) {
				args.push(filter);
			} else if (paths.length > 0) {
				args.push(path.posix.basename(paths[0]).replace(/(?:\.test)?\.rs$/, ''));
			}

			break;
		case 'django':
			args.push(...paths);
			if (filter) {
				args.push(filter);
			}
			
			break;
	}

	return args;
}
