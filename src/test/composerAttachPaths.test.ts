import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFileChipInsert, extractPathsFromTransferData, looksLikeFilePath, needsHostPathResolve, normalizePastedPath, quoteMentionPathArg } from '../features/chat/composerAttachPaths.js';

test('quoteMentionPathArg квотит пробелы', () => {
	assert.equal(quoteMentionPathArg('src/a.ts'), 'src/a.ts');
	assert.equal(quoteMentionPathArg('my dir/a.ts'), '"my dir/a.ts"');
});

test('normalizePastedPath file:// и Windows', () => {
	assert.equal(normalizePastedPath('file:///home/u/a.ts'), '/home/u/a.ts');
	assert.equal(normalizePastedPath('file:///C:/proj/a.ts'), 'C:/proj/a.ts');
	assert.equal(normalizePastedPath('"src/foo.ts"'), 'src/foo.ts');
});

test('looksLikeFilePath: путь да, код/URL нет', () => {
	assert.equal(looksLikeFilePath('src/app.ts'), 'src/app.ts');
	assert.equal(looksLikeFilePath('package.json'), 'package.json');
	assert.equal(looksLikeFilePath('https://example.com/a.ts'), undefined);
	assert.equal(looksLikeFilePath('const x = 1;\nconst y = 2;'), undefined);
	assert.equal(looksLikeFilePath('hello world'), undefined);
});

test('needsHostPathResolve для абсолютных', () => {
	assert.equal(needsHostPathResolve('src/a.ts'), false);
	assert.equal(needsHostPathResolve('/home/u/a.ts'), true);
	assert.equal(needsHostPathResolve('C:/proj/a.ts'), true);
	assert.equal(needsHostPathResolve('file:///tmp/a.ts'), true);
});

test('buildFileChipInsert', () => {
	assert.equal(buildFileChipInsert('src/a.ts'), '@file src/a.ts');
	assert.equal(buildFileChipInsert('my dir/a.ts', 'folder'), '@folder "my dir/a.ts"');
});

test('extractPathsFromTransferData uri-list + resourceurls', () => {
	const data: Record<string, string> = {
		'text/uri-list': 'file:///home/u/p/src/a.ts\n#comment\nfile:///home/u/p/src/b.ts',
		resourceurls: JSON.stringify(['file:///home/u/p/src/c.ts']),
	};
	const paths = extractPathsFromTransferData((type) => data[type] ?? '');
	assert.ok(paths.includes('file:///home/u/p/src/a.ts'));
	assert.ok(paths.includes('file:///home/u/p/src/b.ts'));
	assert.ok(paths.includes('file:///home/u/p/src/c.ts'));
});
