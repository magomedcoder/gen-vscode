import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTreeSitterMetrics, initTreeSitterFromPath, isTreeSitterAvailable, LANG_WASM, listSupportedTreeSitterLanguages, parseWithTreeSitter, resetTreeSitterMetricsForTests, resetTreeSitterWorkerForTests, setTreeSitterLanguageAllowlist, setTreeSitterUseWorker, TREE_SITTER_DEFAULT_LANGS, treeSitterWasmFileForLang } from '../features/index/treeSitter.js';
import type { TreeSitterLangId, TreeSitterSpan } from '../features/index/treeSitter.js';
import { outlineEntriesFromTreeSitterSpans } from '../features/index/treeSitterOutline.js';
import { parseTsOutline } from '../features/index/tsOutlineParse.js';

const EXT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(EXT_ROOT, 'src', 'test', 'fixtures', 'treesitter');

/**
 * Языки default allowlist, где допустимо 0 spans (JSON/YAML: pair/block_mapping_pair без извлекаемого имени в rules).
 * Остальные fixture должны давать spans.length >= 1.
 */
const DEFAULT_SPANS_MIN_ZERO: ReadonlySet<TreeSitterLangId> = new Set(['json', 'yaml']);

const DEFAULT_FIXTURE_BY_LANG: Record<TreeSitterLangId, string> = {
	typescript: 'sample.ts',
	tsx: 'sample.tsx',
	javascript: 'sample.js',
	python: 'sample.py',
	go: 'sample.go',
	rust: 'sample.rs',
	java: 'sample.java',
	cpp: 'sample.cpp',
	php: 'sample.php',
	bash: 'sample.sh',
	html: 'sample.html',
	json: 'sample.json',
	yaml: 'sample.yaml',
	sql: 'sample.sql',
	kotlin: 'sample.kt',
	swift: 'sample.swift',
	dart: 'sample.dart',
	css: 'sample.css',
};

function readFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function spanNameSet(spans: TreeSitterSpan[]): Set<string> {
	return new Set(spans.map((s) => s.name));
}

function assertSpanNameSetsEqual(a: Set<string>, b: Set<string>, label: string): void {
	assert.strictEqual(a.size, b.size, `${label}: размер множеств имён`);
	for (const name of a) {
		assert.ok(b.has(name), `${label}: in-process имеет «${name}», worker - нет`);
	}
}

function assertSpan(spans: TreeSitterSpan[], name: string, kind: string, hint?: string): void {
	assert.ok(
		spans.some((s) => s.name === name && s.kind === kind),
		hint ?? `expected span ${name}:${kind}, got [${spans.map((s) => `${s.name}:${s.kind}`).join(', ')}]`,
	);
}

async function assertHasAnyName(file: string, candidates: string[]): Promise<void> {
	const src = readFixture(file);
	const parsed = await parseWithTreeSitter(file, src);
	assert.ok(parsed, `parse ${file}`);
	const names = new Set(parsed!.spans.map((s) => s.name));
	assert.ok(candidates.some((c) => names.has(c)), `${file}: ожидали одно из [${candidates.join(', ')}], получили [${[...names].slice(0, 20).join(', ')}]`);
}

suite('tree-sitter langs smoke', () => {
	suiteSetup(() => {
		initTreeSitterFromPath(EXT_ROOT);
		assert.ok(isTreeSitterAvailable(), 'корень wasm должен находиться (dist/tree-sitter или node_modules)');
		setTreeSitterLanguageAllowlist(['*']);
		resetTreeSitterMetricsForTests();
	});

	suiteTeardown(() => {
		setTreeSitterLanguageAllowlist(undefined);
	});

	test('каждый default-язык: wasm на диске и parse fixture', async () => {
		const supported = new Set(listSupportedTreeSitterLanguages());
		const wasmDir = path.join(EXT_ROOT, 'dist', 'tree-sitter');

		for (const id of TREE_SITTER_DEFAULT_LANGS) {
			const wasmFile = treeSitterWasmFileForLang(id);
			assert.strictEqual(wasmFile, LANG_WASM[id], `LANG_WASM[${id}]`);
			const wasmOnDisk = supported.has(id) || fs.existsSync(path.join(wasmDir, wasmFile));
			assert.ok(wasmOnDisk, `missing wasm for ${id}: ${wasmFile}`);

			const fixture = DEFAULT_FIXTURE_BY_LANG[id];
			const parsed = await parseWithTreeSitter(fixture, readFixture(fixture));
			assert.ok(parsed, `parse ${fixture} (${id})`);
			assert.strictEqual(parsed!.lang, id, fixture);
			assert.strictEqual(parsed!.source, 'treesitter');
			const minSpans = DEFAULT_SPANS_MIN_ZERO.has(id) ? 0 : 1;
			assert.ok(
				parsed!.spans.length >= minSpans,
				`${id} (${fixture}): ожидали spans.length >= ${minSpans}, получили ${parsed!.spans.length}`,
			);
		}
	});
});

suite('tree-sitter wasm fixtures', () => {
	suiteSetup(() => {
		initTreeSitterFromPath(EXT_ROOT);
		assert.ok(isTreeSitterAvailable(), 'корень wasm должен находиться (dist/tree-sitter или node_modules)');
		setTreeSitterLanguageAllowlist(['*']);
		resetTreeSitterMetricsForTests();
	});

	suiteTeardown(() => {
		setTreeSitterLanguageAllowlist(undefined);
	});

	test('typescript: class / method / function / type', async () => {
		const src = readFixture('sample.ts');
		const parsed = await parseWithTreeSitter('sample.ts', src);
		assert.ok(parsed);
		assert.strictEqual(parsed!.source, 'treesitter');
		const names = new Set(parsed!.spans.map((s) => s.name));
		assert.ok(names.has('Widget'));
		assert.ok(names.has('createWidget') || names.has('render'));
		const outline = outlineEntriesFromTreeSitterSpans('sample.ts', parsed!.spans);
		assert.ok(outline.every((e) => e.source === 'treesitter'));
		assert.ok(outline.some((e) => e.name === 'Widget' && e.kind === 'class'));
	});

	test('typescript: parity outline vs createSourceFile (золотые имена)', async () => {
		const src = readFixture('sample.ts');
		const parsed = await parseWithTreeSitter('sample.ts', src);
		assert.ok(parsed);
		const tsNames = new Set(parseTsOutline('sample.ts', src).map((e) => e.name));
		const treeNames = new Set(outlineEntriesFromTreeSitterSpans('sample.ts', parsed!.spans).map((e) => e.name));
		for (const must of ['Widget', 'createWidget', 'render']) {
			assert.ok(tsNames.has(must), `TS API: нет ${must}`);
			assert.ok(treeNames.has(must), `Tree-sitter: нет ${must}`);
		}
	});

	test('не эмитит export_statement как variable', async () => {
		const src = 'export const answer = 42;\nexport function foo() { return 1; }\n';
		const parsed = await parseWithTreeSitter('n.ts', src);
		assert.ok(parsed);
		assert.ok(!parsed!.spans.some((s) => s.name === 'export_statement'));
		assert.ok(parsed!.spans.some((s) => s.name === 'foo' && s.kind === 'function'));
	});

	test('фильтр вложенных arrow внутри function', async () => {
		const src = 'function outer() {\n  const inner = () => 1;\n  return inner();\n}\n';
		const parsed = await parseWithTreeSitter('nest.ts', src);
		assert.ok(parsed);
		const fns = parsed!.spans.filter((s) => s.kind === 'function');
		assert.ok(fns.some((s) => s.name === 'outer'));
		assert.ok(!fns.some((s) => s.name === 'inner'));
	});

	test('python / go / rust / java', async () => {
		await assertHasAnyName('sample.py', ['Greeter', 'hello', 'main']);
		await assertHasAnyName('sample.go', ['NewServer', 'Server', 'Listen']);
		await assertHasAnyName('sample.rs', ['Counter', 'make_counter', 'new']);
		await assertHasAnyName('sample.java', ['App', 'main', 'greet']);
	});

	test('tsx / javascript / cpp / php / bash', async () => {
		await assertHasAnyName('sample.tsx', ['App', 'label']);
		await assertHasAnyName('sample.js', ['greet', 'Person', 'hello']);
		await assertHasAnyName('sample.cpp', ['Widget', 'main', 'demo', 'render']);
		await assertHasAnyName('sample.php', ['Greeter', 'hello', 'main']);
		await assertHasAnyName('sample.sh', ['greet', 'main']);
	});

	test('kotlin: data class, companion, property, method (golden spans)', async () => {
		const parsed = await parseWithTreeSitter('sample.kt', readFixture('sample.kt'));
		assert.ok(parsed);
		const spans = parsed!.spans;
		assertSpan(spans, 'User', 'class');
		assertSpan(spans, 'Greeter', 'class');
		assertSpan(spans, 'greeting', 'property');
		assertSpan(spans, 'Companion', 'class');
		assertSpan(spans, 'hello', 'method');
		assertSpan(spans, 'main', 'function');
	});

	test('swift: struct->class kind, protocol, class, methods (golden spans)', async () => {
		const parsed = await parseWithTreeSitter('sample.swift', readFixture('sample.swift'));
		assert.ok(parsed);
		const spans = parsed!.spans;
		// Swift `struct` в CST часто class_declaration; span kind `class` для outline
		assertSpan(spans, 'Point', 'class', 'Point struct maps to span kind class');
		assertSpan(spans, 'distance', 'method');
		assertSpan(spans, 'GreeterProtocol', 'interface');
		assertSpan(spans, 'Greeter', 'class');
		assert.ok(spans.some((s) => s.name === 'hello' && s.kind === 'method'), 'Greeter.hello method');
		assertSpan(spans, 'main', 'function');
	});

	test('dart: StatelessWidget-style class + build() method (golden spans)', async () => {
		const parsed = await parseWithTreeSitter('sample.dart', readFixture('sample.dart'));
		assert.ok(parsed);
		const spans = parsed!.spans;
		assertSpan(spans, 'HelloText', 'class');
		const helloText = spans.find((s) => s.name === 'HelloText' && s.kind === 'class');
		assert.ok(helloText);
		assert.ok(
			spans.some((s) => s.name === 'build' && s.kind === 'method' && s.startLine > helloText!.startLine),
			'HelloText.build method span',
		);
		assertSpan(spans, 'main', 'function');
	});

	test('css в default allowlist (wasm в пакете)', async () => {
		const src = readFixture('sample.css');
		const parsed = await parseWithTreeSitter('sample.css', src);
		assert.ok(parsed);
		assert.strictEqual(parsed!.lang, 'css');
		assert.ok(parsed!.spans.length >= 1, 'ожидали хотя бы один CSS span');
	});

	test('Default markup/data: html / json / yaml / sql / css', async () => {
		for (const [file, lang] of [
			['sample.html', 'html'],
			['sample.json', 'json'],
			['sample.yaml', 'yaml'],
			['sample.sql', 'sql'],
			['sample.css', 'css'],
		] as const) {
			const parsed = await parseWithTreeSitter(file, readFixture(file));
			assert.ok(parsed, `parse ${file}`);
			assert.strictEqual(parsed!.lang, lang);
		}
	});

	test('кэш spans: повторный parse того же файла', async () => {
		resetTreeSitterMetricsForTests();
		const src = readFixture('sample.ts');
		await parseWithTreeSitter('cache.ts', src);
		const before = getTreeSitterMetrics().cacheHit;
		await parseWithTreeSitter('cache.ts', src);
		assert.ok(getTreeSitterMetrics().cacheHit > before);
	});

	test('слишком большой файл - oversized + метрика', async () => {
		resetTreeSitterMetricsForTests();
		const huge = 'x'.repeat(500_001);
		const parsed = await parseWithTreeSitter('huge.ts', `export const x = "${huge}";`);
		assert.strictEqual(parsed, undefined);
		assert.ok(getTreeSitterMetrics().oversized >= 1);
	});

	test('пустой allowlist = полный default набор (включая css)', async () => {
		setTreeSitterLanguageAllowlist([]);
		const parsed = await parseWithTreeSitter('sample.css', readFixture('sample.css'));
		assert.ok(parsed);
		assert.strictEqual(parsed!.lang, 'css');
		setTreeSitterLanguageAllowlist(['*']);
	});

	test('явный allowlist без css отключает css', async () => {
		setTreeSitterLanguageAllowlist(['typescript', 'python']);
		const parsed = await parseWithTreeSitter('sample.css', readFixture('sample.css'));
		assert.strictEqual(parsed, undefined);
		setTreeSitterLanguageAllowlist(['*']);
	});

	test('worker parity: kotlin / dart / swift - имена spans как in-process', async () => {
		const cases: Array<{ file: string; tag: string }> = [
			{ file: 'sample.kt', tag: 'kotlin' },
			{ file: 'sample.dart', tag: 'dart' },
			{ file: 'sample.swift', tag: 'swift' },
		];

		for (const { file, tag } of cases) {
			const src = readFixture(file);
			resetTreeSitterMetricsForTests();
			setTreeSitterUseWorker(false);
			const inproc = await parseWithTreeSitter(`worker-parity-inproc-${file}`, src);
			assert.ok(inproc, `${tag} in-process`);

			setTreeSitterUseWorker(true);
			const viaWorker = await parseWithTreeSitter(`worker-parity-worker-${file}`, src);
			assert.ok(viaWorker, `${tag} worker`);

			assertSpanNameSetsEqual(spanNameSet(inproc!.spans), spanNameSet(viaWorker!.spans), tag);
		}

		await resetTreeSitterWorkerForTests();
	});
});
