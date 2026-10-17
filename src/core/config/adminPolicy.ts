import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GenSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

/**
 * Управляемый слой admin policy (MDM-паттерн, без полного Enterprise).
 *
 * Путь к policy.json (первый существующий):
 * 1. `GEN_ADMIN_POLICY` - явный путь к файлу
 * 2. Linux/macOS - системный файл `/etc/gen/policy.json`
 * 3. Windows - системный файл `%ProgramData%/gen/policy.json`
 *
 * Ключи из файла принудительно перекрывают пользовательский слой, UI и проект.
 */

// Ключи GenSettings, которые admin policy может заблокировать / форсировать
export const ADMIN_POLICY_KEYS = [
	'approvalPolicy',
	'autoApprove',
	'continueLoopOnDeny',
	'enableTerminal',
	'enableFileReading',
	'enableWorkspaceContext',
	'webSearchEnabled',
	'webFetchEnabled',
	'allowExternalDirectory',
	'otelEnabled',
	'otelEndpoint',
	'indexingEnabled',
	'embeddingsBaseUrl',
	'baseUrl',
	'planModel',
	'actModel',
	'smallModel',
	'localEmbeddingsMode',
] as const satisfies readonly (keyof GenSettings)[];

export type AdminPolicyKey = (typeof ADMIN_POLICY_KEYS)[number];

const ADMIN_POLICY_KEY_SET = new Set<string>(ADMIN_POLICY_KEYS);

const META_KEYS = new Set(['$schema', 'version', 'description']);

export interface AdminPolicySnapshot {
	// Файл найден и распарсен (даже если lockedKeys пуст - policy «пустой»)
	active: boolean;
	// Абсолютный путь к загруженному файлу
	path?: string;
	// Наложение GenSettings (только ADMIN_POLICY_KEYS)
	settings: Partial<GenSettings>;
	// Имена заблокированных ключей
	lockedKeys: string[];
	errors?: Array<{ pointer: string; message: string }>;
}

const EMPTY: AdminPolicySnapshot = {
	active: false,
	settings: {},
	lockedKeys: [],
};

let snapshot: AdminPolicySnapshot = EMPTY;

/**
 * Кандидаты пути к admin policy (порядок приоритета).
 * Если задан `GEN_ADMIN_POLICY` - только он (даже если файла нет * нет политики).
 */
export function resolveAdminPolicyCandidates(): string[] {
	const envPath = process.env.GEN_ADMIN_POLICY?.trim();
	if (envPath) {
		return [path.resolve(envPath)];
	}

	if (process.platform === 'win32') {
		// Обычно ProgramData = C:\ProgramData
		const programData = process.env.PROGRAMDATA?.trim() || 'C:\\ProgramData';
		return [path.join(programData, 'gen', 'policy.json')];
	}

	return [path.join('/etc', 'gen', 'policy.json')];
}

// Простое сопоставление как в glob (`*`, prefix*, *suffix)
export function matchAdminPattern(pattern: string, subject: string): boolean {
	const p = pattern.trim();
	const s = subject.trim();
	if (!p) {
		return false;
	}

	if (p === '*' || p === s) {
		return true;
	}

	if (p.endsWith('*') && p.startsWith('*') && p.length > 1) {
		return s.includes(p.slice(1, -1));
	}

	if (p.endsWith('*')) {
		return s.startsWith(p.slice(0, -1));
	}

	if (p.startsWith('*')) {
		return s.endsWith(p.slice(1));
	}

	return s === p;
}

export function parseAdminPolicy(raw: unknown): {
	settings: Partial<GenSettings>;
	lockedKeys: string[];
	errors: Array<{ pointer: string; message: string }>;
} {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			settings: {},
			lockedKeys: [],
			errors: [
				{ 
					pointer: '',
					message: vscode.l10n.t('config.validation.jsonObjectRequired')
				}
			],
		};
	}

	const obj = raw as Record<string, unknown>;
	const settings: Partial<GenSettings> = {};
	const lockedKeys: string[] = [];
	const errors: Array<{ pointer: string; message: string }> = [];

	for (const [key, value] of Object.entries(obj)) {
		if (META_KEYS.has(key) || value === undefined) {
			continue;
		}

		if (!ADMIN_POLICY_KEY_SET.has(key)) {
			errors.push({ pointer: `/${key}`, message: vscode.l10n.t('config.adminPolicy.unknownKey') });
			continue;
		}

		const expected = DEFAULT_SETTINGS[key as AdminPolicyKey];
		const expectedType = Array.isArray(expected) ? 'array' : typeof expected;
		const actualType = Array.isArray(value) ? 'array' : typeof value;
		if (expectedType !== actualType) {
			errors.push({ 
				pointer: `/${key}`, 
				message: vscode.l10n.t('config.validation.expectedType', expectedType, actualType)
			});
			continue;
		}

		if (key === 'localEmbeddingsMode' && !['off', 'trigram', 'vector'].includes(String(value))) {
			errors.push({ 
				pointer: `/${key}`, 
				message: vscode.l10n.t('config.adminPolicy.localEmbeddingsModeAllowed')
			});
			continue;
		}

		(settings as Record<string, unknown>)[key] = value;
		lockedKeys.push(key);
	}

	lockedKeys.sort();
	return {
		settings,
		lockedKeys,
		errors,
	};
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
	try {
		const text = await fs.readFile(filePath, 'utf8');
		const trimmed = text.trim();
		if (!trimmed) {
			return undefined;
		}

		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

export function getAdminPolicySnapshot(): AdminPolicySnapshot {
	return snapshot;
}

// Есть ли активная admin policy с хотя бы одним locked-ключом
export function isAdminPolicyActive(): boolean {
	return snapshot.active && snapshot.lockedKeys.length > 0;
}

/**
 * Применить admin-наложение к уже объединённым настройкам (после пользователя/UI/проекта).
 */
export function applyAdminPolicy(merged: Partial<GenSettings>): Partial<GenSettings> {
	if (!snapshot.active || snapshot.lockedKeys.length === 0) {
		return merged;
	}

	return {
		...merged,
		...snapshot.settings
	};
}

// Перед записью в UI globalState: locked-ключи сбрасываем к defaults, чтобы после снятия политики в store не остались «зашитые» значения
export function stripAdminLockedForStorage(settings: GenSettings): GenSettings {
	if (!snapshot.active || snapshot.lockedKeys.length === 0) {
		return settings;
	}

	const out = { ...settings };
	for (const key of ADMIN_POLICY_KEYS) {
		if (!snapshot.lockedKeys.includes(key)) {
			continue;
		}

		const def = DEFAULT_SETTINGS[key];
		(out as Record<string, unknown>)[key] = Array.isArray(def)
			? [...def]
			: typeof def === 'object' && def !== null
				? structuredClone(def)
				: def;
	}

	return out;
}

// Перечитать admin policy с диска
export async function reloadAdminPolicy(): Promise<AdminPolicySnapshot> {
	const candidates = resolveAdminPolicyCandidates();
	const envForced = Boolean(process.env.GEN_ADMIN_POLICY?.trim());

	for (const candidate of candidates) {
		const raw = await readJsonFile(candidate);
		if (raw === undefined) {
			if (envForced) {
				// Явный путь задан, но файла нет - политики нет
				snapshot = EMPTY;
				return snapshot;
			}
			continue;
		}

		const parsed = parseAdminPolicy(raw);
		snapshot = {
			active: true,
			path: candidate,
			settings: parsed.settings,
			lockedKeys: parsed.lockedKeys,
			errors: parsed.errors,
		};
		return snapshot;
	}

	snapshot = EMPTY;
	return snapshot;
}

// Сброс кэша (тесты)
export function resetAdminPolicyForTests(): void {
	snapshot = EMPTY;
}
