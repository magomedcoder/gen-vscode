import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GEN_CONFIG_RELATIVE } from '../../features/project/config';
import { getAdminPolicySnapshot, reloadAdminPolicy, resolveAdminPolicyCandidates } from './adminPolicy';
import { DEFAULT_SETTINGS, type GenSettings } from './types';
import { getGenUserConfigPath } from './userPaths';

/**
 * Слои JSON-конфигурации (MVP, без удалённого `.well-known`).
 *
 * Приоритет (низкий * высокий):
 * 1. `DEFAULT_SETTINGS` (встроенные значения по умолчанию)
 * 2. пользователь: `~/.config/gen/config.json` (XDG/APPDATA - см. userPaths)
 * 3. Gen Settings UI (`globalState`) - только ключи, отличающиеся от defaults
 *    (без `UI_LAYER_EXCLUDED_KEYS` - команды/redact только в пользовательском/проектном JSON)
 * 4. проект: `<workspace>/.gen/config.json`
 * 5. admin policy (`GEN_ADMIN_POLICY` / `/etc/gen/policy.json` / ProgramData) - locked-ключи
 *
 * VSCode `contributes.configuration` сейчас только `gen.chatViewLocation` (синхронизируется из effective settings) - не отдельный файл-слой.
 * UI настроек не ломаем: слои аддитивны; проект перекрывает пользователя и UI только по явно заданным в JSON ключам; admin нельзя обойти.
 */

/**
 * Не из UI настроек/globalState - только пользовательский/проектный JSON.
 * Игнор путей/папок - `.genignore`, не эти ключи.
 */
export const UI_LAYER_EXCLUDED_KEYS = [
	'sensitivePathPatterns',
	'deniedCommands',
	'secretPatterns',
] as const satisfies readonly (keyof GenSettings)[];

// Убрать из blob ключи, которые UI-слой не хранит
export function stripUiExcludedKeys<T extends Partial<GenSettings>>(input: T): T {
	const out = { ...input } as Record<string, unknown>;
	for (const key of UI_LAYER_EXCLUDED_KEYS) {
		delete out[key];
	}

	return out as T;
}

/** Ключи GenSettings, которые можно задать в JSON-слоях */
export const FILE_LAYER_KEYS = [
	'systemPrompt',
	'commentSystemPrompt',
	'primaryTools',
	'modelRoutedPatch',
	'watcherIgnore',
	'webSearchEnabled',
	'webSearchBackend',
	'webSearchHttpUrl',
	'webSearchHttpHeader',
	'webFetchEnabled',
	'privacyMode',
	'blockNonLocalUrls',
	'skillsPaths',
	'skillsUrls',
	'instructionUrls',
	'trustedPlugins',
	'personaId',
	'usernameDisplay',
	'deniedCommands',
	'sensitivePathPatterns',
	'secretPatterns',
	'allowExternalDirectory',
	'enableTerminal',
	'enableFileReading',
	'enableWorkspaceContext',
	'alwaysOnWorkspaceContext',
	'indexingEnabled',
	'indexNewFolders',
	'indexForGrep',
	'formatAfterEdit',
	'agentMaxIterations',
	'autoApprove',
	'persistAlwaysAllow',
	'continueLoopOnDeny',
	'approvalPolicy',
	'baseUrl',
	'smallModel',
	'planModel',
	'actModel',
	'temperature',
	'maxTokens',
	'maxContextTokens',
	'contextOverflowPolicy',
	'requestTimeoutMs',
	'defaultToolTimeoutMs',
	'maxToolTimeoutMs',
	'maxInputChars',
	'planWriteToFile',
	'planShellPolicy',
	'snapshotEnabled',
	'subagentDepth',
	'worktreesEnabled',
	'worktreeStartCommand',
	'toolOutputMaxChars',
	'toolOutputModelMaxChars',
	'gitSyncAutoKeep',
	'embeddingsBaseUrl',
	'embeddingsModel',
	'localEmbeddingsMode',
	'outlineEngine',
	'chunkEngine',
	'treeSitterLanguages',
	'treeSitterUseWorker',
	'indexForceContentHash',
	'indexStorageBackend',
	'indexSqliteMinFiles',
	'compactTailTurns',
	'compactPruneToolResults',
	'compactReservedTokens',
	'midLoopAutoCompact',
	'llmAutoCompact',
	'chatMode',
	'shareMode',
	'revealOnEdit',
	'backgroundEditMode',
	'notifyOnComplete',
	'notifySoundOnComplete',
	'loggingEnabled',
	'otelEnabled',
	'otelEndpoint',
	'visionEnabled',
	'attachmentImageQuality',
	'pdfVisionMaxPages',
	'chatTextSize',
	'thinkingDisplay',
	'chatViewLocation',
	'maxTabCount',
	'maxConcurrentRuns',
	'tabEvictionPolicy',
] as const satisfies readonly (keyof GenSettings)[];

export type FileLayerKey = (typeof FILE_LAYER_KEYS)[number];

const FILE_LAYER_KEY_SET = new Set<string>(FILE_LAYER_KEYS);

// Метаданные `.gen/config.json` - не отображаются в GenSettings
const META_KEYS = new Set(['version', 'createdAt', '$schema']);

export interface ParsedFileConfig {
	// Наложение для GenSettings (только известные ключи)
	settings: Partial<GenSettings>;
	// Относительный/абсолютный путь к hooks.json
	hooksPath?: string;
	// Встроенные hooks из конфигурации (`hooks: { beforeSubmit: ... }`)
	hooks?: Record<string, unknown>;
}

export interface ConfigLayersSnapshot {
	user: ParsedFileConfig;
	project: ParsedFileConfig;
	userPath: string;
	projectPath: string | undefined;
	// Путь загруженной admin policy (если active)
	adminPolicyPath: string | undefined;
}

export interface ConfigLayerError {
	layer: 'user' | 'project';
	path: string;
	pointer: string;
	message: string;
}

export let lastConfigLayerErrors: ConfigLayerError[] = [];

export function getLastConfigLayerErrors(): readonly ConfigLayerError[] {
	return lastConfigLayerErrors;
}

const EMPTY_PARSED: ParsedFileConfig = {
	settings: {}
};

let snapshot: ConfigLayersSnapshot = {
	user: EMPTY_PARSED,
	project: EMPTY_PARSED,
	userPath: getGenUserConfigPath(),
	projectPath: undefined,
	adminPolicyPath: undefined,
};

const layerListeners = new Set<() => void>();

/**
 * Глубокое слияние (deep-merge): объекты рекурсивно, массивы и примитивы - заменой.
 * `undefined` в источнике пропускаем (не затираем цель).
 */
export function deepMerge<T>(target: T, ...sources: unknown[]): T {
	let result: unknown = target;
	for (const source of sources) {
		result = deepMergeOne(result, source);
	}

	return result as T;
}

function deepMergeOne(target: unknown, source: unknown): unknown {
	if (source === undefined) {
		return target;
	}

	if (source === null || typeof source !== 'object' || Array.isArray(source)) {
		return source;
	}

	if (target === null || typeof target !== 'object' || Array.isArray(target)) {
		return deepMergeOne({}, source);
	}

	const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
	for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
		if (value === undefined) {
			continue;
		}
		out[key] = deepMergeOne(out[key], value);
	}

	return out;
}

// Вытащить известные ключи + hooks / hooksPath из сырого JSON
export function parseFileConfig(raw: unknown): ParsedFileConfig {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { settings: {} };
	}

	const obj = raw as Record<string, unknown>;
	const settings: Partial<GenSettings> = {};

	for (const [key, value] of Object.entries(obj)) {
		if (META_KEYS.has(key) || key === 'hooks' || key === 'hooksPath') {
			continue;
		}

		if (!FILE_LAYER_KEY_SET.has(key)) {
			continue;
		}
		
		(settings as Record<string, unknown>)[key] = value;
	}

	const out: ParsedFileConfig = { settings };

	if (typeof obj.hooksPath === 'string' && obj.hooksPath.trim()) {
		out.hooksPath = obj.hooksPath.trim();
	}

	if (obj.hooks && typeof obj.hooks === 'object' && !Array.isArray(obj.hooks)) {
		out.hooks = obj.hooks as Record<string, unknown>;
	}

	return out;
}

function valueType(value: unknown): string {
	if (Array.isArray(value)) {
		return 'array';
	}

	if (value === null) {
		return 'null';
	}

	return typeof value;
}

function pointer(key: string): string {
	return `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function validateFileConfig(raw: unknown): Array<{ pointer: string; message: string }> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return [{ 
			pointer: '', 
			message: vscode.l10n.t('config.validation.jsonObjectRequired')
		}];
	}

	const errors: Array<{ pointer: string; message: string }> = [];
	const obj = raw as Record<string, unknown>;
	for (const [key, value] of Object.entries(obj)) {
		if (!META_KEYS.has(key) && key !== 'hooks' && key !== 'hooksPath' && !FILE_LAYER_KEY_SET.has(key)) {
			errors.push({ pointer: pointer(key), message: vscode.l10n.t('config.validation.unknownKey') });
			continue;
		}

		if (value === undefined || META_KEYS.has(key)) {
			continue;
		}

		if (key === 'hooksPath' && typeof value !== 'string') {
			errors.push({ pointer: pointer(key), message: vscode.l10n.t('config.validation.expectedType', 'string', valueType(value)) });
			continue;
		}

		if (key === 'hooks' && (!value || typeof value !== 'object' || Array.isArray(value))) {
			errors.push({ pointer: pointer(key), message: vscode.l10n.t('config.validation.expectedType', 'object', valueType(value)) });
			continue;
		}

		if (!FILE_LAYER_KEY_SET.has(key)) {
			continue;
		}

		const expected = DEFAULT_SETTINGS[key as keyof GenSettings];
		const expectedType = valueType(expected);
		if (valueType(value) !== expectedType) {
			errors.push({ pointer: pointer(key), message: vscode.l10n.t('config.validation.expectedType', expectedType, valueType(value)) });
			continue;
		}

		if (Array.isArray(expected) && Array.isArray(value) && value.some((item) => typeof item !== 'string')) {
			errors.push({ pointer: pointer(key), message: vscode.l10n.t('config.validation.stringArrayRequired') });
		}
	}

	return errors;
}

export async function saveConfigLayerJson(filePath: string, raw: unknown): Promise<void> {
	const errors = validateFileConfig(raw);
	if (errors.length > 0) {
		const detail = errors.map((error) => `${error.pointer || '/'}: ${error.message}`).join('; ');
		throw new Error(vscode.l10n.t('config.validation.invalidConfig', detail));
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

type JsonReadResult = | { kind: 'missing' }
	| { kind: 'ok'; value: unknown }
	| { kind: 'error'; message: string };

async function readJsonFile(filePath: string): Promise<JsonReadResult> {
	try {
		const text = await fs.readFile(filePath, 'utf8');
		const trimmed = text.trim();
		if (!trimmed) {
			return { kind: 'error', message: vscode.l10n.t('config.validation.emptyFile') };
		}

		return { kind: 'ok', value: JSON.parse(trimmed) as unknown };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { kind: 'missing' };
		}
		
		return { 
			kind: 'error', 
			message: err instanceof Error ? err.message : String(err) 
		};
	}
}

function projectConfigPath(): string | undefined {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		return undefined;
	}

	return path.join(root, GEN_CONFIG_RELATIVE);
}

// Текущий снимок слоёв (синхронный кэш)
export function getConfigLayersSnapshot(): ConfigLayersSnapshot {
	return snapshot;
}

// Наложение настроек из файлов с приоритетом project > user (без UI; UI объединяется в getSettings)
export function getFileSettingsOverlay(): {
	user: Partial<GenSettings>;
	project: Partial<GenSettings>;
} {
	return {
		user: snapshot.user.settings,
		project: snapshot.project.settings,
	};
}

// Эффективный hooksPath (project > user)
export function getEffectiveHooksPath(): string | undefined {
	return snapshot.project.hooksPath ?? snapshot.user.hooksPath;
}

// Встроенные hooks: глубокое объединение user <- project
export function getEffectiveHooksInline(): Record<string, unknown> | undefined {
	const user = snapshot.user.hooks;
	const project = snapshot.project.hooks;
	if (!user && !project) {
		return undefined;
	}

	return deepMerge({}, user ?? {}, project ?? {}) as Record<string, unknown>;
}

export function onConfigLayersChanged(listener: () => void): { dispose(): void } {
	layerListeners.add(listener);
	return {
		dispose: () => {
			layerListeners.delete(listener);
		},
	};
}

function notifyLayerListeners(): void {
	for (const listener of layerListeners) {
		listener();
	}
}

// Перечитать пользовательский и проектный слои и admin policy в кэш
export async function reloadConfigLayers(): Promise<ConfigLayersSnapshot> {
	const userPath = getGenUserConfigPath();
	const projPath = projectConfigPath();

	const [userRaw, projectRaw] = await Promise.all([
		readJsonFile(userPath),
		projPath ? readJsonFile(projPath) : Promise.resolve({ kind: 'missing' } as JsonReadResult),
	]);
	await reloadAdminPolicy();

	const admin = getAdminPolicySnapshot();
	const errors: ConfigLayerError[] = [];
	const resolveLayer = (
		layer: 'user' | 'project',
		filePath: string | undefined,
		result: JsonReadResult,
		previous: ParsedFileConfig,
	): ParsedFileConfig => {
		if (result.kind === 'missing') {
			return { settings: {} };
		}

		if (result.kind === 'error') {
			errors.push({ 
				layer, 
				path: filePath ?? '', 
				pointer: '', 
				message: result.message 
			});
			return previous;
		}

		const validation = validateFileConfig(result.value);
		if (validation.length > 0) {
			errors.push(...validation.map((error) => ({ 
				layer, 
				path: filePath ?? '', 
				...error 
			})));
			return previous;
		}

		return parseFileConfig(result.value);
	};
	snapshot = {
		user: resolveLayer('user', userPath, userRaw, snapshot.user),
		project: resolveLayer('project', projPath, projectRaw, snapshot.project),
		userPath,
		projectPath: projPath,
		adminPolicyPath: admin.active ? admin.path : undefined,
	};
	lastConfigLayerErrors = errors;

	notifyLayerListeners();
	return snapshot;
}

/**
 * Ключи UI-хранилища, отличающиеся от DEFAULT_SETTINGS.
 * Так JSON-слои «просвечивают», пока пользователь не менял поле в Settings UI.
 */
export function pickNonDefaultSettings(stored: Partial<GenSettings> | undefined): Partial<GenSettings> {
	if (!stored || typeof stored !== 'object') {
		return {};
	}

	const out: Partial<GenSettings> = {};
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GenSettings)[]) {
		if ((UI_LAYER_EXCLUDED_KEYS as readonly string[]).includes(key)) {
			continue;
		}
		
		if (!(key in stored)) {
			continue;
		}

		const value = stored[key];
		if (value === undefined) {
			continue;
		}

		if (stableEqual(value, DEFAULT_SETTINGS[key])) {
			continue;
		}

		(out as Record<string, unknown>)[key] = value;
	}
	return out;
}

function stableEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) {
		return true;
	}

	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

// Подписка на файлы + workspace folders; вызывать из initSettings
export function initConfigLayers(context: vscode.ExtensionContext): void {
	void reloadConfigLayers();

	const projectWatchDisposables: vscode.Disposable[] = [];

	const clearProjectWatchers = (): void => {
		for (const d of projectWatchDisposables) {
			d.dispose();
		}

		projectWatchDisposables.length = 0;
	};

	const startProjectWatcher = (): void => {
		clearProjectWatchers();
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, GEN_CONFIG_RELATIVE));
		const onProject = (): void => {
			void reloadConfigLayers();
		};
		projectWatchDisposables.push(
			watcher,
			watcher.onDidChange(onProject),
			watcher.onDidCreate(onProject),
			watcher.onDidDelete(onProject),
		);
	};

	startProjectWatcher();

	context.subscriptions.push(
		{ 
			dispose: clearProjectWatchers 
		},
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			startProjectWatcher();
			void reloadConfigLayers();
		}),
	);

	// Пользовательская конфигурация вне workspace - AbsolutePattern или путь к файлу
	const userPath = getGenUserConfigPath();
	try {
		const userWatcher = vscode.workspace.createFileSystemWatcher(userPath);
		const onUser = (): void => {
			void reloadConfigLayers();
		};
		context.subscriptions.push(
			userWatcher,
			userWatcher.onDidChange(onUser),
			userWatcher.onDidCreate(onUser),
			userWatcher.onDidDelete(onUser),
		);
	} catch {}

	// Admin policy (системный путь / GEN_ADMIN_POLICY)
	for (const policyPath of resolveAdminPolicyCandidates()) {
		try {
			const policyWatcher = vscode.workspace.createFileSystemWatcher(policyPath);
			const onPolicy = (): void => {
				void reloadConfigLayers();
			};
			context.subscriptions.push(
				policyWatcher,
				policyWatcher.onDidChange(onPolicy),
				policyWatcher.onDidCreate(onPolicy),
				policyWatcher.onDidDelete(onPolicy),
			);
		} catch {}
	}
}
