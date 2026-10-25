import * as vscode from 'vscode';
import type { Uri } from 'vscode';
import type { ImageAttachment } from '../chat/attachments';
import type { LlmToolDefinition } from '../../core/llm/types';
import type { AgentCheckpoint } from './checkpoint';
import type { DiffHunkPayload } from './diff';
import type { StickyPlan } from './plan';
import type { AgentWriteTracker } from './userEdits';

export type ConfirmChoice = 'apply' | 'skip' | 'abort' | 'always' | 'allow_remaining';

export interface ToolContext {
	signal?: AbortSignal;
	confirm?(request: {
		title: string;
		detail?: string;
		hint?: string;
		suggestion?: string;
		allowAlways?: boolean;
		// Кнопка «Allow remaining edits» при очереди edits в одном turn
		allowRemaining?: boolean;
		remainingEdits?: number;
		variant?: 'agent' | 'binary';
		applyLabel?: string;
		skipLabel?: string;
		rejectLabel?: string;
	}): Promise<ConfirmChoice>;
	revealFile?(uri: Uri): Promise<void>;
	trackMutation?(uri: Uri): void;
	plan?: StickyPlan;
	onPlanChanged?(): void;
	checkpoint?: AgentCheckpoint;
	writes?: AgentWriteTracker;
	// Потоковый stdout/stderr long shell -> UI (без гонок: только пока tool активен)
	onPartialOutput?(text: string): void;
	// После verify-блока postEdit (для attempt_completion gate)
	recordVerify?(info: { hadErrors: boolean; paths: string[] }): void;
}

export interface ToolResult {
	ok: boolean;
	content: string;
	code?: string;
	category?: 'validation' | 'not_found' | 'permission' | 'timeout' | 'network' | 'execution' | 'internal';
	retryable?: boolean;
	denied?: boolean;
	path?: string;
	diff?: string;
	hunks?: DiffHunkPayload[];
	// Картинки из tool (например read_file) - уйдут в vision на следующем шаге цикла
	attachments?: ImageAttachment[];
}

export function makeToolError(
	content: string,
	options?: Pick<ToolResult, 'code' | 'category' | 'retryable' | 'path' | 'denied'>,
): ToolResult {
	return {
		ok: false,
		content,
		...options,
	};
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

export function extractPathFromPartialJson(raw: string): string | undefined {
	const pathMatch = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
	if (pathMatch) {
		try {
			return JSON.parse(`"${pathMatch[1]}"`) as string;
		} catch {
			return pathMatch[1];
		}
	}

	return undefined;
}

export function sanitizeToolArgumentsForApi(raw: string): string {
	const trimmed = raw.trim() || '{}';
	try {
		JSON.parse(trimmed);
		return trimmed;
	} catch {
		const path = extractPathFromPartialJson(trimmed);
		return JSON.stringify({
			error: 'invalid_or_truncated_json',
			...(path ? { path } : {}),
		});
	}
}

function invalidToolArgsMessage(raw: string): string {
	const path = extractPathFromPartialJson(raw);
	const parts = [
		vscode.l10n.t('tool.invalidJsonArgs'),
		path ? vscode.l10n.t('tool.invalidJsonPath', path) : '',
		vscode.l10n.t('tool.fileNotWritten'),
		vscode.l10n.t('tool.invalidJsonRetry'),
		vscode.l10n.t('tool.argsLength', raw.length),
	];

	return parts.filter(Boolean).join(' ');
}

export function parseToolArguments(raw: string): Record<string, unknown> {
	const trimmed = raw.trim() || '{}';
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}

		return { value: parsed };
	} catch {
		throw new Error(invalidToolArgsMessage(trimmed));
	}
}

export function asString(args: Record<string, unknown>, key: string, fallback = ''): string {
	const value = args[key];
	if (typeof value === 'string') {
		return value;
	}

	if (value === undefined || value === null) {
		return fallback;
	}

	return String(value);
}

export function asOptionalInt(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) {
		return undefined;
	}

	return Math.floor(n);
}

export function asBoolean(args: Record<string, unknown>, key: string, fallback = false): boolean {
	const value = args[key];
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		return value === 'true' || value === '1';
	}
	
	return fallback;
}

export function asObjectArray(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = args[key];
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}
