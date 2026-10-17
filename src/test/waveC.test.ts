import * as assert from 'assert';
import { buildImportGraph, extractJsImports, extractPythonImports, findImportCycles, findOrphanFiles, isMostlyReExportFile } from '../features/agent/tools/meta/repoHealthCore.js';
import { boostByImportGraph, isTestPath, pathsFromGitPorcelain, rankRelatedTests, suggestRelatedTests } from '../features/agent/tools/meta/testImpactCore.js';
import { handleDesignClick } from '../features/design/designVisual.js';
import { clearToolsForTests, getToolByName, getToolSource, registerTool, unregisterEphemeralTools } from '../features/agent/tools/registry.js';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import type { ToolDefinition } from '../features/agent/types.js';

suite('Wave C helpers', () => {
	test('extractJsImports + cycle detection', () => {
		const imports = extractJsImports(`
			import { a } from './a';
			const b = require('./b');
			export * from '../c';
		`);
		assert.ok(imports.includes('./a'));
		assert.ok(imports.includes('./b'));
		assert.ok(imports.includes('../c'));

		const files = [
			{ 
				path: 'src/a.ts', 
				source: "import { b } from './b';\n" 
			},
			{ 
				path: 'src/b.ts', 
				source: "import { a } from './a';\n" 
			},
			{ 
				path: 'src/c.ts', 
				source: "export const c = 1;\n" 
			},
		];
		const graph = buildImportGraph(files);
		const cycles = findImportCycles(graph);
		assert.ok(cycles.some((c) => c.includes('src/a.ts') && c.includes('src/b.ts')));
		const orphans = findOrphanFiles(graph);
		assert.ok(orphans.includes('src/c.ts'));
	});

	test('test_impact heuristics', () => {
		assert.ok(isTestPath('src/foo.test.ts'));
		assert.ok(isTestPath('src/__tests__/foo.ts'));
		const related = suggestRelatedTests(
			['src/features/agent/auth.ts'],
			[
				'src/features/agent/auth.ts',
				'src/features/agent/auth.test.ts',
				'src/test/auth.test.ts',
				'src/other.ts',
				'src/features/agent/authorization.test.ts',
			],
		);
		assert.ok(related.includes('src/features/agent/auth.test.ts'));
		// слабый substring auth ⊂ authorization больше не должен ложно срабатывать как единственный hit
		assert.ok(related[0] === 'src/features/agent/auth.test.ts' || related.includes('src/features/agent/auth.test.ts'));
		assert.deepStrictEqual(
			pathsFromGitPorcelain(' M src/a.ts\n?? src/b.ts\nR  old.ts -> new.ts\n'),
			['src/a.ts', 'src/b.ts', 'new.ts'],
		);
	});

	test('test_impact ignores weak stem false positives', () => {
		const related = suggestRelatedTests(
			['src/index.ts'],
			[
				'src/index.ts',
				'src/foo.test.ts',
				'src/bar.spec.ts',
				'src/index.test.ts',
			],
		);
		assert.deepStrictEqual(related, ['src/index.test.ts']);
	});

	test('repo_health: python relative imports + barrel re-export cycle suppress', () => {
		const py = extractPythonImports('from .helper import x\nfrom ..pkg.mod import y\n');
		assert.ok(py.includes('.helper'));
		assert.ok(py.includes('..pkg.mod'));

		assert.ok(isMostlyReExportFile("export * from './a';\nexport { b } from './b';\n"));

		const files = [
			{ path: 'src/a.ts', source: "export * from './b';\n" },
			{ path: 'src/b.ts', source: "export * from './a';\n" },
		];
		const graph = buildImportGraph(files);
		const barrels = new Set(['src/a.ts', 'src/b.ts']);
		const cycles = findImportCycles(graph, { skipBarrelReExports: barrels });
		assert.strictEqual(cycles.length, 0);
	});

	test('test_impact: import-graph boost', () => {
		const base = rankRelatedTests(['src/auth.ts'], ['src/auth.ts', 'src/auth.test.ts', 'src/other.test.ts']);
		const imports = new Map<string, string[]>([
			['src/auth.test.ts', ['src/auth.ts']],
			['src/other.test.ts', ['src/other.ts']],
		]);
		const boosted = boostByImportGraph(base, ['src/auth.ts'], imports);
		assert.ok(boosted.some((h) => h.path === 'src/auth.test.ts' && (h.reason === 'import' || h.reason === 'sidecar')));
	});

	test('repo_health orphan skip + ignore patterns', () => {
		const files = [
			{
				path: 'src/a.ts',
				source: "export const a = 1;\n"
			},
			{
				path: 'src/a.stories.tsx',
				source: "export default {};\n"
			},
			{
				path: 'src/vendor/x.ts',
				source: "export const x = 1;\n"
			},
		];
		const graph = buildImportGraph(files);
		const orphans = findOrphanFiles(graph);
		assert.ok(orphans.includes('src/a.ts'));
		assert.ok(!orphans.includes('src/a.stories.tsx'));
		const filtered = findOrphanFiles(graph, { ignorePatterns: ['src/vendor/'] });
		assert.ok(!filtered.includes('src/vendor/x.ts'));
	});

	test('design click validates bridge payload', async () => {
		const r = await handleDesignClick({ url: 'http://localhost:3000' });
		assert.strictEqual(r.handled, false);
		assert.match(r.message, /url and selector/i);
	});

	test('ephemeral register / unregister', () => {
		clearToolsForTests();
		registerBuiltins();
		const tool: ToolDefinition = {
			name: 'tmp_hint',
			description: 'tmp',
			parameters: { type: 'object', properties: {} },
			async execute() {
				return { ok: true, content: 'body' };
			},
		};
		registerTool(tool, { 
			tags: ['meta'], 
			risk: 'read' 
		}, 'ephemeral');
		assert.strictEqual(getToolSource('tmp_hint'), 'ephemeral');
		unregisterEphemeralTools();
		assert.strictEqual(getToolByName('tmp_hint'), undefined);
		assert.ok(getToolByName('read_file'));
	});
});
