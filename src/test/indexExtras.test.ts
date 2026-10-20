import * as assert from 'node:assert';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { getToolByName, getToolMeta } from '../features/agent/tools/registry.js';
import { FIND_REFERENCES_DEFAULT_LIMIT, matchWorkspaceFolders, normalizeFindReferencesPaging, pageItems } from '../features/agent/tools/ide/findReferences.js';
import { parseDesignScreenshotWaitUntil } from '../features/agent/tools/meta/designScreenshot.js';
import { extractHttpUrlFromText } from '../features/design/designPickCommand.js';
import { annotateHtmlWithSourceHints, extractSelectorOuterHtml, selectorSearchTokens } from '../features/design/designVisual.js';

suite('find_references / design_inspect smoke', () => {
	suiteSetup(() => {
		registerBuiltins();
	});

	test('find_references registered', () => {
		const tool = getToolByName('find_references');
		assert.ok(tool);
		const meta = getToolMeta('find_references');
		assert.ok(meta?.tags.includes('ide'));
		assert.strictEqual(meta?.risk, 'read');
		assert.ok(tool.parameters && typeof tool.parameters === 'object');
		const props = (tool.parameters as {
			properties?: Record<string, unknown>
		}).properties ?? {};
		assert.ok('limit' in props);
		assert.ok('offset' in props);
		assert.ok('folder' in props || 'root' in props);
	});

	test('design_inspect registered', () => {
		const tool = getToolByName('design_inspect');
		assert.ok(tool);
		const meta = getToolMeta('design_inspect');
		assert.ok(meta?.tags.includes('meta'));
	});

	test('design_screenshot registered', () => {
		const tool = getToolByName('design_screenshot');
		assert.ok(tool);
		const meta = getToolMeta('design_screenshot');
		assert.ok(meta?.tags.includes('meta'));
		assert.strictEqual(meta?.risk, 'web');
		const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
		assert.ok('wait_until' in props);
		assert.ok('selector' in props);
	});

	test('design_screenshot wait_until parsing (no Chromium)', () => {
		assert.strictEqual(parseDesignScreenshotWaitUntil(undefined), 'networkidle');
		assert.strictEqual(parseDesignScreenshotWaitUntil('domcontentloaded'), 'domcontentloaded');
		assert.strictEqual(parseDesignScreenshotWaitUntil('not-a-event'), 'networkidle');
	});

	test('extractHttpUrlFromText for Simple Browser clipboard', () => {
		assert.strictEqual(
			extractHttpUrlFromText('Preview http://localhost:5173/app?q=1 extra'),
			'http://localhost:5173/app?q=1',
		);
		const local = extractHttpUrlFromText('localhost:3000');
		assert.ok(local?.startsWith('http://localhost:3000'));
	});

	test('design_screenshot disabled by default returns error', async () => {
		const tool = getToolByName('design_screenshot')!;
		const result = await tool.execute({ url: 'http://localhost:5173/' }, {});
		assert.strictEqual(result.ok, false);
		assert.ok(/designScreenshotEnabled|отключён/i.test(result.content), result.content);
	});

	test('find_references missing position fails gracefully', async () => {
		const tool = getToolByName('find_references')!;
		try {
			const result = await tool.execute({ path: 'package.json' }, {});
			assert.strictEqual(result.ok, false);
			assert.ok(/line|symbol|workspace|path|policy|folder/i.test(result.content), result.content);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(/workspace|path|policy/i.test(msg), msg);
		}
	});

	test('normalizeFindReferencesPaging defaults and clamps', () => {
		assert.deepStrictEqual(normalizeFindReferencesPaging({}), {
			limit: FIND_REFERENCES_DEFAULT_LIMIT,
			offset: 0,
		});
		assert.deepStrictEqual(normalizeFindReferencesPaging({ limit: 0 }), {
			limit: 1,
			offset: 0,
		});
		assert.deepStrictEqual(normalizeFindReferencesPaging({ limit: 999, offset: 10 }), {
			limit: 50,
			offset: 10,
		});
		assert.deepStrictEqual(normalizeFindReferencesPaging({ limit: 10, page: 2 }), {
			limit: 10,
			offset: 20,
		});
		assert.deepStrictEqual(normalizeFindReferencesPaging({ limit: 10, offset: 3, page: 9 }), {
			limit: 10,
			offset: 3,
		});
	});

	test('pageItems returns total / hasMore / nextOffset', () => {
		const items = [1, 2, 3, 4, 5];
		const first = pageItems(items, {
			limit: 2,
			offset: 0
		});
		assert.deepStrictEqual(first.items, [1, 2]);
		assert.strictEqual(first.total, 5);
		assert.strictEqual(first.hasMore, true);
		assert.strictEqual(first.nextOffset, 2);

		const mid = pageItems(items, {
			limit: 2,
			offset: 2
		});
		assert.deepStrictEqual(mid.items, [3, 4]);
		assert.strictEqual(mid.hasMore, true);
		assert.strictEqual(mid.nextOffset, 4);

		const last = pageItems(items, {
			limit: 2,
			offset: 4
		});
		assert.deepStrictEqual(last.items, [5]);
		assert.strictEqual(last.hasMore, false);
		assert.strictEqual(last.nextOffset, null);

		const past = pageItems(items, {
			limit: 10,
			offset: 100
		});
		assert.deepStrictEqual(past.items, []);
		assert.strictEqual(past.offset, 5);
		assert.strictEqual(past.hasMore, false);
	});

	test('matchWorkspaceFolders filters by name', () => {
		const folders = [
			{
				name: 'app',
				uri: {
					fsPath: '/ws/app'
				}
			},
			{
				name: 'lib',
				uri: {
					fsPath: '/ws/lib'
				}
			},
		] as unknown as import('vscode').WorkspaceFolder[];

		assert.strictEqual(matchWorkspaceFolders(folders, undefined).length, 2);
		assert.strictEqual(matchWorkspaceFolders(folders, '').length, 2);
		assert.deepStrictEqual(
			matchWorkspaceFolders(folders, 'lib').map((f) => f.name),
			['lib'],
		);
		assert.strictEqual(matchWorkspaceFolders(folders, 'missing').length, 0);
		assert.deepStrictEqual(
			matchWorkspaceFolders(folders, '/ws/app').map((f) => f.name),
			['app'],
		);
	});

	test('annotateHtmlWithSourceHints + selector extract', () => {
		const html = `<html><body><div id="root" class="app-shell">Hi</div></body></html>`;
		const annotated = annotateHtmlWithSourceHints(html, 'http://localhost:5173/');
		assert.ok(annotated.html.includes('data-gen-src') || annotated.html.includes('gen-design:'));
		const hit = extractSelectorOuterHtml(annotated.html, '#root');
		assert.strictEqual(hit.matched, true);
		assert.ok(hit.outerHtml?.includes('id="root"'));
		assert.deepStrictEqual(selectorSearchTokens('#root.app-shell'), ['root', 'app-shell']);
	});
});
