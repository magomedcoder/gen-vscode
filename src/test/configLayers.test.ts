import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deepMerge, parseFileConfig, pickNonDefaultSettings, stripUiExcludedKeys, UI_LAYER_EXCLUDED_KEYS } from '../core/config/layers.js';
import { applyAdminPolicy, matchAdminPattern, parseAdminPolicy, reloadAdminPolicy, resetAdminPolicyForTests, resolveAdminPolicyCandidates, setAdminPolicyPathForTests } from '../core/config/adminPolicy.js';
import { DEFAULT_SETTINGS } from '../core/config/types.js';
import { getGenUserConfigDir, getGenUserConfigPath } from '../core/config/userPaths.js';

suite('config layers', () => {
	test('deepMerge: объекты рекурсивно, массивы заменой', () => {
		const merged = deepMerge(
			{ a: 1, nested: { x: 1, y: 2 }, list: [1] },
			{ nested: { y: 9, z: 3 }, list: [2, 3], b: true },
		);
		assert.deepStrictEqual(merged, {
			a: 1,
			b: true,
			nested: { x: 1, y: 9, z: 3 },
			list: [2, 3],
		});
	});

	test('deepMerge: undefined в source не затирает', () => {
		const merged = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
		assert.deepStrictEqual(merged, { a: 1, b: 3 });
	});

	test('parseFileConfig: только известные ключи + hooks', () => {
		const parsed = parseFileConfig({
			version: 1,
			createdAt: '2026-01-01',
			systemPrompt: 'hello',
			webSearchEnabled: false,
			unknownKey: 42,
			hooksPath: '.gen/custom-hooks.json',
			hooks: { beforeSubmit: ['echo'] },
		});
		assert.strictEqual(parsed.settings.systemPrompt, 'hello');
		assert.strictEqual(parsed.settings.webSearchEnabled, false);
		assert.strictEqual((parsed.settings as { unknownKey?: unknown }).unknownKey, undefined);
		assert.strictEqual(parsed.hooksPath, '.gen/custom-hooks.json');
		assert.deepStrictEqual(parsed.hooks, { beforeSubmit: ['echo'] });
		assert.strictEqual('version' in parsed.settings, false);
	});

	test('pickNonDefaultSettings: только отличия от defaults', () => {
		const overlay = pickNonDefaultSettings({
			...DEFAULT_SETTINGS,
			systemPrompt: 'custom',
			temperature: DEFAULT_SETTINGS.temperature,
		});
		assert.strictEqual(overlay.systemPrompt, 'custom');
		assert.strictEqual(overlay.temperature, undefined);
	});

	test('pickNonDefaultSettings: игнорирует команды/redact из UI-хранилища', () => {
		const overlay = pickNonDefaultSettings({
			systemPrompt: 'x',
			deniedCommands: ['curl'],
			sensitivePathPatterns: ['*.pem'],
			secretPatterns: ['secret'],
		});
		assert.strictEqual(overlay.systemPrompt, 'x');
		for (const key of UI_LAYER_EXCLUDED_KEYS) {
			assert.strictEqual(overlay[key], undefined, key);
		}
	});

	test('stripUiExcludedKeys убирает JSON-only knobs (security + settings slim)', () => {
		const stripped = stripUiExcludedKeys({
			...DEFAULT_SETTINGS,
			deniedCommands: ['curl'],
			authHeader: 'X-Api-Key',
			planWriteToFile: false,
			outlineEngine: 'treesitter',
			systemPrompt: 'keep',
		});
		assert.strictEqual(stripped.systemPrompt, 'keep');
		assert.strictEqual('deniedCommands' in stripped, false);
		assert.strictEqual('sensitivePathPatterns' in stripped, false);
		assert.strictEqual('secretPatterns' in stripped, false);
		assert.strictEqual('authHeader' in stripped, false);
		assert.strictEqual('planWriteToFile' in stripped, false);
		assert.strictEqual('outlineEngine' in stripped, false);
		assert.ok(UI_LAYER_EXCLUDED_KEYS.includes('authHeader'));
		assert.ok(UI_LAYER_EXCLUDED_KEYS.includes('outlineEngine'));
	});

	test('FILE_LAYER принимает auth/comments/image knobs для JSON-only UI', () => {
		const parsed = parseFileConfig({
			authHeader: 'X-Api-Key',
			authScheme: '',
			commentStyle: 'block',
			previewBeforeApply: false,
			attachmentImageMaxWidth: 1024,
		});
		assert.strictEqual(parsed.settings.authHeader, 'X-Api-Key');
		assert.strictEqual(parsed.settings.commentStyle, 'block');
		assert.strictEqual(parsed.settings.attachmentImageMaxWidth, 1024);
	});

	test('parseFileConfig: project может задать команды/redact; неизвестные ключи не попадают в settings', () => {
		const parsed = parseFileConfig({
			notASettingsKey: ['.env'],
			deniedCommands: ['rm'],
			sensitivePathPatterns: ['.env.*'],
			secretPatterns: ['token'],
		});
		assert.strictEqual((parsed.settings as { notASettingsKey?: unknown }).notASettingsKey, undefined);
		assert.deepStrictEqual(parsed.settings.deniedCommands, ['rm']);
		assert.deepStrictEqual(parsed.settings.sensitivePathPatterns, ['.env.*']);
		assert.deepStrictEqual(parsed.settings.secretPatterns, ['token']);
	});

	test('getGenUserConfigPath уважает XDG / стандартные пути', () => {
		const prevXdg = process.env.XDG_CONFIG_HOME;
		try {
			assert.ok(getGenUserConfigPath().endsWith(`${path.sep}config.json`));
			assert.ok(getGenUserConfigDir().length > 0);
			if (process.platform === 'linux') {
				process.env.XDG_CONFIG_HOME = path.join(os.tmpdir(), 'xdg-cfg');
				assert.ok(getGenUserConfigDir().startsWith(process.env.XDG_CONFIG_HOME));
			}
		} finally {
			if (prevXdg === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = prevXdg;
			}
		}
	});

	test('parseFileConfig: пустой / битый вход', () => {
		assert.deepStrictEqual(parseFileConfig(null).settings, {});
		assert.deepStrictEqual(parseFileConfig('x').settings, {});
		assert.deepStrictEqual(parseFileConfig([]).settings, {});
	});

	test('user config path - существующий каталог tmp можно записать', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-user-cfg-'));
		const file = path.join(dir, 'config.json');
		fs.writeFileSync(file, JSON.stringify({ systemPrompt: 'from-file' }), 'utf8');
		const parsed = parseFileConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
		assert.strictEqual(parsed.settings.systemPrompt, 'from-file');
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

suite('admin policy', () => {
	teardown(() => {
		resetAdminPolicyForTests();
	});

	test('parseAdminPolicy: только ADMIN_POLICY_KEYS', () => {
		const parsed = parseAdminPolicy({
			$schema: './schemas/gen-policy.schema.json',
			webSearchEnabled: false,
			systemPrompt: 'ignored',
			webFetchEnabled: false,
		});
		assert.strictEqual(parsed.settings.webSearchEnabled, false);
		assert.strictEqual(parsed.settings.webFetchEnabled, false);
		assert.strictEqual((parsed.settings as { systemPrompt?: unknown }).systemPrompt, undefined);
		assert.ok(parsed.lockedKeys.includes('webSearchEnabled'));
		assert.ok(parsed.lockedKeys.includes('webFetchEnabled'));
	});

	test('matchAdminPattern: * wildcards', () => {
		assert.ok(matchAdminPattern('corp-*', 'corp-jira'));
		assert.ok(matchAdminPattern('*-prod', 'api-prod'));
		assert.ok(matchAdminPattern('*', 'any'));
		assert.ok(!matchAdminPattern('corp-*', 'other'));
	});

	test('resolveAdminPolicyCandidates: системный путь', () => {
		const candidates = resolveAdminPolicyCandidates();
		assert.strictEqual(candidates.length, 1);
		assert.ok(candidates[0].endsWith(`${path.sep}gen${path.sep}policy.json`) || candidates[0].endsWith('/gen/policy.json'));
	});

	test('applyAdminPolicy: force keys', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-admin-'));
		const file = path.join(dir, 'policy.json');
		fs.writeFileSync(
			file,
			JSON.stringify({
				webSearchEnabled: false,
				allowExternalDirectory: false,
				enableTerminal: false,
			}),
			'utf8',
		);
		setAdminPolicyPathForTests(file);
		const snap = await reloadAdminPolicy();
		assert.strictEqual(snap.active, true);
		assert.ok(snap.lockedKeys.includes('webSearchEnabled'));

		const merged = applyAdminPolicy({
			webSearchEnabled: true,
			allowExternalDirectory: true,
			enableTerminal: true,
		});
		assert.strictEqual(merged.webSearchEnabled, false);
		assert.strictEqual(merged.allowExternalDirectory, false);
		assert.strictEqual(merged.enableTerminal, false);

		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('reloadAdminPolicy: missing path -> inactive', async () => {
		setAdminPolicyPathForTests(path.join(os.tmpdir(), 'gen-no-such-policy.json'));
		const snap = await reloadAdminPolicy();
		assert.strictEqual(snap.active, false);
		assert.deepStrictEqual(snap.lockedKeys, []);
	});
});
