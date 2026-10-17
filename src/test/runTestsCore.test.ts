import * as assert from 'assert';
import * as path from 'node:path';
import { resolveShellCwd, shellCwdCandidate } from '../features/agent/shellCwd.js';
import { applyTestFilters, parseTestFailures } from '../features/agent/tools/shell/runTestsCore.js';
import type { DetectedTestCommand } from '../features/agent/detectTestCommand.js';

suite('run tests core', () => {
	test('parses and ranks Jest/Vitest failures', () => {
		const failures = parseTestFailures(`
FAIL src/math.test.ts > math > adds
Error: expected 3 to be 4
    at Object.<anonymous> (src/math.test.ts:12:7)
src/other.spec.ts:20:5: expected true to be false
`);
		assert.deepStrictEqual(failures[0], {
			file: 'src/other.spec.ts',
			line: 20,
			message: 'expected true to be false',
			score: 100,
		});
		assert.strictEqual(failures[1].file, 'src/math.test.ts');
		assert.strictEqual(failures[1].line, 12);
		assert.match(failures[1].message, /expected 3/);
	});

	test('parses pytest, Go and Cargo failures', () => {
		const failures = parseTestFailures(`
FAILED tests/test_api.py::test_create - AssertionError: bad status
pkg/service/service_test.go:42: got 2, want 3
thread 'tests::works' panicked at src/lib.rs:18:9: assertion failed: value
`);
		assert.deepStrictEqual(
			failures.map((failure) => [failure.file, failure.line]),
			[
				['pkg/service/service_test.go', 42],
				['src/lib.rs', 18],
				['tests/test_api.py', 1],
			],
		);
	});

	test('maps impact paths to runner-specific arguments', () => {
		const detected = (runner: DetectedTestCommand['runner'], command: string, args: string[]): DetectedTestCommand => ({
			runner,
			command,
			args,
			label: runner,
		});
		assert.deepStrictEqual(
			applyTestFilters(detected('jest', 'npm', ['test']), {
				paths: ['src/a.test.ts'],
				filter: 'works',
			}),
			['test', '--', '--runTestsByPath', 'src/a.test.ts', '--testNamePattern', 'works'],
		);
		assert.deepStrictEqual(
			applyTestFilters(detected('pytest', 'pytest', []), {
				paths: ['tests/test_a.py'],
				filter: 'works',
			}),
			['tests/test_a.py', '-k', 'works'],
		);
		assert.deepStrictEqual(
			applyTestFilters(detected('go', 'go', ['test', './...']), {
				paths: ['pkg/api/api_test.go', 'pkg/api/more_test.go'],
			}),
			['test', './pkg/api'],
		);
		assert.deepStrictEqual(
			applyTestFilters(detected('vitest', 'npm', ['test']), {}),
			['test'],
		);
	});
});

suite('shell cwd sandbox core', () => {
	const root = path.resolve('/workspace/project');
	const policyResolver = async (candidate: string): Promise<{ fsPath: string }> => {
		const relative = path.relative(root, candidate);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			throw new Error('path outside workspace');
		}
		if (relative === 'ignored') {
			throw new Error('path ignored by .genignore');
		}
		return { fsPath: candidate };
	};

	test('resolves relative cwd inside workspace', async () => {
		assert.strictEqual(shellCwdCandidate(path.join(root, 'src'), '../tests'), path.join(root, 'tests'));
		assert.strictEqual(
			await resolveShellCwd(path.join(root, 'src'), '../tests', policyResolver),
			path.join(root, 'tests'),
		);
	});

	test('fails closed for escape and ignored cwd', async () => {
		await assert.rejects(
			resolveShellCwd(root, '../../outside', policyResolver),
			/Shell cwd denied: path outside workspace/,
		);
		await assert.rejects(
			resolveShellCwd(root, 'ignored', policyResolver),
			/Shell cwd denied: path ignored by \.genignore/,
		);
	});

	test('normalizes dot and absolute cwd through the same policy resolver', async () => {
		assert.strictEqual(await resolveShellCwd(path.join(root, 'src'), '.', policyResolver), path.join(root, 'src'));
		assert.strictEqual(await resolveShellCwd(root, path.join(root, 'tests'), policyResolver), path.join(root, 'tests'));
		await assert.rejects(resolveShellCwd(root, path.resolve('/tmp'), policyResolver), /Shell cwd denied/);
	});
});
