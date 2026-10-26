import * as assert from 'assert';
import { extractTextToolCalls, normalizeTextToolName, stripTextToolCallsForDisplay } from '../features/agent/textToolCalls.js';

suite('textToolCalls', () => {
	test('parses Qwen-style tool_call blocks and strips them from content', () => {
		const raw = [
			'Смотрю каталоги.',
			'<tool_call>',
			'<function=list_dir>',
			'<parameter=path>',
			'internal/core',
			'</parameter>',
			'</function>',
			'</tool_call>',
			'<tool_call>',
			'<function=list_dir>',
			'<parameter=path>',
			'internal/utils',
			'</parameter>',
			'</function>',
			'</tool_call>',
		].join('\n');

		const extracted = extractTextToolCalls(raw);
		assert.strictEqual(extracted.content, 'Смотрю каталоги.');
		assert.strictEqual(extracted.toolCalls.length, 2);
		assert.strictEqual(extracted.toolCalls[0]?.function.name, 'list_dir');
		assert.strictEqual(extracted.toolCalls[0]?.function.arguments, JSON.stringify({ 
			path: 'internal/core' 
		}));
		assert.strictEqual(extracted.toolCalls[1]?.function.arguments, JSON.stringify({ 
			path: 'internal/utils' 
		}));
	});

	test('normalizeTextToolName only trims (no alias remap)', () => {
		assert.strictEqual(normalizeTextToolName('  list_dir  '), 'list_dir');
		assert.strictEqual(normalizeTextToolName('list_directory'), 'list_directory');
		assert.strictEqual(normalizeTextToolName('read_file'), 'read_file');
	});

	test('stripTextToolCallsForDisplay hides incomplete trailing block', () => {
		const partial = 'Hello\n<tool_call>\n<function=list_dir>\n<parameter=path>\nsrc';
		assert.strictEqual(stripTextToolCallsForDisplay(partial), 'Hello');
	});

	test('parses invoke-style XML tool tags', () => {
		const raw = '<tool name="read_file"><parameter name="path">src/a.ts</parameter></tool>';
		const extracted = extractTextToolCalls(raw);
		assert.strictEqual(extracted.toolCalls.length, 1);
		assert.strictEqual(extracted.toolCalls[0]?.function.name, 'read_file');
		assert.strictEqual(extracted.toolCalls[0]?.function.arguments, JSON.stringify({ path: 'src/a.ts' }));
	});

	test('parses JSONL / fenced tool call objects', () => {
		const raw = [
			'Calling tool.',
			'```json',
			'{"name":"grep","arguments":{"pattern":"foo","path":"src"}}',
			'```',
			'{"name":"list_dir","arguments":{"path":"."}}',
		].join('\n');
		const extracted = extractTextToolCalls(raw);
		assert.ok(extracted.toolCalls.length >= 2);
		assert.ok(extracted.toolCalls.some((c) => c.function.name === 'grep'));
		assert.ok(extracted.toolCalls.some((c) => c.function.name === 'list_dir'));
	});
});
