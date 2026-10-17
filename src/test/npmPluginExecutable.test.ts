import * as assert from 'node:assert';
import * as path from 'node:path';
import { buildNpmPluginExecutable } from '../features/project/plugins.js';

suite('npmPluginExecutable', () => {
	test('buildNpmPluginExecutable: resolves relative args under packageRoot', () => {
		const root = '/ws';
		const pkg = '/ws/node_modules/foo';
		const exe = buildNpmPluginExecutable({
			workspaceRoot: root,
			packageRoot: pkg,
			command: 'node',
			args: ['dist/plugin.js', '--flag'],
		});
		assert.strictEqual(exe.command, 'node');
		assert.strictEqual(exe.args[0], path.resolve(pkg, 'dist/plugin.js'));
		assert.strictEqual(exe.args[1], '--flag');
		assert.strictEqual(exe.packageRoot, path.resolve(pkg));
	});

	test('buildNpmPluginExecutable: denies path outside workspace', () => {
		assert.throws(() => buildNpmPluginExecutable({
			workspaceRoot: '/ws',
			packageRoot: '/ws/node_modules/foo',
			command: 'node',
			args: ['../../../../etc/passwd'],
		}), /outside workspace/);
	});

	test('buildNpmPluginExecutable: denies arbitrary PATH commands', () => {
		assert.throws(() => buildNpmPluginExecutable({
			workspaceRoot: '/ws',
			packageRoot: '/ws/node_modules/foo',
			command: 'python',
			args: ['plugin.py'],
		}), /declared package bin/);
	});
});
