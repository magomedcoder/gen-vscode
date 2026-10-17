import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';

export class CommandPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CommandPolicyError';
	}
}

const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const C_FLAGS = new Set(['-c', '--command']);

const PACKAGE_SUBCOMMANDS = new Set(['install', 'ci', 'publish', 'uninstall', 'global', 'add', 'remove']);
const GIT_WRITE_SUBCOMMANDS = new Set(['push', 'rebase', 'reset', 'commit', 'tag', 'filter-branch']);

export function normalizeBinaryName(command: string): string {
	const base = path.basename(command.trim()).toLowerCase();
	return base.replace(/\.(cmd|exe|bat)$/i, '');
}

function deniedBinarySet(patterns?: readonly string[]): Set<string> {
	const source = patterns ?? getSettings().deniedCommands;
	const out = new Set<string>();
	for (const item of source) {
		const name = item.trim().toLowerCase();
		if (!name || name.startsWith('#')) {
			continue;
		}

		out.add(normalizeBinaryName(name));
	}

	return out;
}

function looksLikeFileOperand(arg: string): boolean {
	if (arg.startsWith('-') || /[\s;`$(){}|&<>]/.test(arg)) {
		return false;
	}

	return /[\\/]/.test(arg) || /\.\w{1,10}$/.test(arg);
}

/**
 * File-based script runners из denylist всё же разрешены:
 * - pwsh/powershell -File script.ps1 (не -Command)
 * - bash/sh script.sh без -c/-e
 */
export function isAllowedScriptFileInvocation(binary: string, args: string[]): boolean {
	const b = binary.toLowerCase();
	if (b === 'pwsh' || b === 'powershell') {
		const hasInline = args.some((a) => /^-(?:[Cc]ommand|EncodedCommand|e)$/i.test(a) || a === '-c');
		if (hasInline) {
			return false;
		}

		for (let i = 0; i < args.length; i += 1) {
			if (/^-(?:[Ff]ile|f)$/i.test(args[i]!)) {
				const next = args[i + 1];
				return Boolean(next && looksLikeFileOperand(next));
			}
		}

		return false;
	}

	if (b === 'bash' || b === 'sh' || b === 'zsh' || b === 'dash') {
		if (args.some((a) => a === '-c' || a === '-e' || a === '--eval')) {
			return false;
		}

		const file = args.find((a) => !a.startsWith('-'));
		return Boolean(file && looksLikeFileOperand(file));
	}

	return false;
}

function isDeniedCFlag(binary: string, args: string[], index: number): boolean {
	if (!C_FLAGS.has(args[index])) {
		return false;
	}

	if (binary === 'git') {
		return false;
	}

	const next = args[index + 1];
	if (next === undefined) {
		return true;
	}

	if (next.startsWith('-')) {
		return false;
	}

	return !looksLikeFileOperand(next);
}

function firstSubcommand(args: string[]): string | undefined {
	for (const arg of args) {
		if (!arg.startsWith('-')) {
			return arg.toLowerCase();
		}
	}

	return undefined;
}

function gitSubcommand(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '-c') {
			i += 1;
			continue;
		}

		if (arg.startsWith('-')) {
			continue;
		}

		return arg.toLowerCase();
	}

	return undefined;
}

export function assertAllowedCommand(
	command: string,
	args: string[],
	deniedCommands?: readonly string[],
	opts?: { allowDeniedBinary?: boolean },
): void {
	const trimmed = command.trim();
	if (!trimmed) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.empty'));
	}

	if (trimmed.includes('..') || trimmed.includes('\0')) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.badPath'));
	}

	const binary = normalizeBinaryName(trimmed);
	if (!binary) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.empty'));
	}

	const denied = deniedBinarySet(deniedCommands).has(binary);
	if (denied && !opts?.allowDeniedBinary && !isAllowedScriptFileInvocation(binary, args)) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.deniedBinary', binary));
	}

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (typeof arg !== 'string') {
			throw new CommandPolicyError(vscode.l10n.t('cmd.argsMustBeStrings'));
		}

		if (arg.includes('\0')) {
			throw new CommandPolicyError(vscode.l10n.t('cmd.badArgChar'));
		}

		// PowerShell -Command / -EncodedCommand - inline eval (запрещено)
		if ((binary === 'pwsh' || binary === 'powershell') && (/^-(?:[Cc]ommand|EncodedCommand)$/i.test(arg) || arg === '-c')) {
			throw new CommandPolicyError(vscode.l10n.t('cmd.evalFlag', arg));
		}

		if (EVAL_FLAGS.has(arg) || isDeniedCFlag(binary, args, i)) {
			throw new CommandPolicyError(vscode.l10n.t('cmd.evalFlag', arg));
		}
	}

	const sub = binary === 'git' ? gitSubcommand(args) : firstSubcommand(args);
	if (sub && PACKAGE_SUBCOMMANDS.has(sub)) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.deniedSub', sub));
	}

	if (binary === 'git' && sub && GIT_WRITE_SUBCOMMANDS.has(sub)) {
		throw new CommandPolicyError(vscode.l10n.t('cmd.gitDenied', sub));
	}
}

export function formatCommandLine(command: string, args: string[]): string {
	const parts = [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part));
	return parts.join(' ');
}
