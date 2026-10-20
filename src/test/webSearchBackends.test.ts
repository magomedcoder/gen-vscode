import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeWebSearchTitle, parseExaSearchJson, parseParallelSearchJson } from '../features/agent/tools/webSearchBackends.js';

function fixture(name: string): unknown {
	const candidates = [
		path.join(__dirname, 'fixtures', 'web-search', name),
		path.join(process.cwd(), 'src', 'test', 'fixtures', 'web-search', name),
	];
	const file = candidates.find((candidate) => fs.existsSync(candidate));
	assert.ok(file, `fixture not found: ${name}`);
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

suite('web search backend adapters', () => {
	test('normalizes Exa, filters unsafe URLs and duplicates', () => {
		assert.deepStrictEqual(parseExaSearchJson(fixture('exa.json'), 8), [
			{ title: 'Gen docs', url: 'https://example.com/gen' },
			{ title: 'https://example.com/no-title', url: 'https://example.com/no-title' },
		]);
	});

	test('normalizes nested Parallel pages and null titles', () => {
		assert.deepStrictEqual(parseParallelSearchJson(fixture('parallel.json'), 8), [
			{ title: 'Parallel result', url: 'https://parallel.example/result' },
			{ title: 'https://parallel.example/untitled', url: 'https://parallel.example/untitled' },
		]);
	});

	test('fixture edge-case: empty title falls back to url (exa, parallel)', () => {
		const exaUrl = 'https://example.com/no-title';
		const parallelUrl = 'https://parallel.example/untitled';
		const exaHit = parseExaSearchJson(fixture('exa.json'), 8).find((hit) => hit.url === exaUrl);
		const parallelHit = parseParallelSearchJson(fixture('parallel.json'), 8).find((hit) => hit.url === parallelUrl);
		assert.ok(exaHit);
		assert.ok(parallelHit);
		assert.strictEqual(exaHit.title, exaUrl);
		assert.strictEqual(parallelHit.title, parallelUrl);
		assert.strictEqual(normalizeWebSearchTitle('', exaUrl), exaUrl);
		assert.strictEqual(normalizeWebSearchTitle(null, parallelUrl), parallelUrl);
	});
});
