const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const TREE_SITTER_VSCODE_COPY = new Set([
	'tree-sitter.wasm',
	'tree-sitter.js',
	'web-tree-sitter.d.ts',
	'tree-sitter-typescript.wasm',
	'tree-sitter-tsx.wasm',
	'tree-sitter-javascript.wasm',
	'tree-sitter-python.wasm',
	'tree-sitter-go.wasm',
	'tree-sitter-rust.wasm',
	'tree-sitter-java.wasm',
	'tree-sitter-cpp.wasm',
	'tree-sitter-php.wasm',
	'tree-sitter-bash.wasm',
	'tree-sitter-css.wasm',
]);

const TREE_SITTER_VENDOR_ALWAYS = [
	'tree-sitter-html.wasm',
	'tree-sitter-json.wasm',
	'tree-sitter-yaml.wasm',
	'tree-sitter-sql.wasm',
	'tree-sitter-kotlin.wasm',
	'tree-sitter-swift.wasm',
	'tree-sitter-dart.wasm',
];

function copyOne(src, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
}

const TREE_SITTER_REMOVED = new Set([
	'tree-sitter-c-sharp.wasm',
	'tree-sitter-ruby.wasm',
	'tree-sitter-scala.wasm',
]);

function copyTreeSitterWasm() {
	const destDir = path.join(__dirname, 'dist', 'tree-sitter');
	fs.mkdirSync(destDir, { recursive: true });

	for (const name of TREE_SITTER_REMOVED) {
		const stale = path.join(destDir, name);
		if (fs.existsSync(stale)) {
			fs.unlinkSync(stale);
		}
	}

	const vscodeSrc = path.join(__dirname, 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
	if (!fs.existsSync(vscodeSrc)) {
		console.warn('[esbuild] @vscode/tree-sitter-wasm не найден; Tree-sitter будет отключён в runtime');
		return;
	}

	const copySet = new Set(TREE_SITTER_VSCODE_COPY);
	for (const name of String(process.env.TREE_SITTER_EXTRA || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)) {
		copySet.add(name.endsWith('.wasm') ? name : `tree-sitter-${name}.wasm`);
	}

	for (const name of fs.readdirSync(vscodeSrc)) {
		if (!copySet.has(name)) {
			continue;
		}
		copyOne(path.join(vscodeSrc, name), path.join(destDir, name));
	}

	const vendorDir = path.join(__dirname, 'resources', 'tree-sitter-extra');
	for (const name of TREE_SITTER_VENDOR_ALWAYS) {
		const src = path.join(vendorDir, name);
		if (fs.existsSync(src)) {
			copyOne(src, path.join(destDir, name));
		} else {
			console.warn(`[esbuild] нет ${name} в resources/tree-sitter-extra`);
		}
	}
}

/**
 * @param {string} name
 * @returns {import('esbuild').Plugin}
 */
function createProblemMatcherPlugin(name) {
	return {
		name: 'esbuild-problem-matcher',
		setup(build) {
			build.onStart(() => {
				if (activeBuilds.size === 0) {
					console.log('[watch] build started');
				}
				activeBuilds.add(name);
			});

			build.onEnd((result) => {
				result.errors.forEach(({ text, location }) => {
					console.error(`✘ [ERROR] ${text}`);
					if (location) {
						console.error(`    ${location.file}:${location.line}:${location.column}:`);
					}
				});

				activeBuilds.delete(name);
				if (activeBuilds.size === 0) {
					console.log('[watch] build finished');
				}
			});
		},
	};
}

/** @type {Set<string>} */
const activeBuilds = new Set();

async function createExtensionContext() {
	return esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [createProblemMatcherPlugin('extension')],
	});
}

async function createWorkerContext() {
	return esbuild.context({
		entryPoints: ['src/features/index/treeSitterWorkerMain.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/treeSitterWorker.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [createProblemMatcherPlugin('treeSitterWorker')],
	});
}

async function createWebviewContext() {
	return esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outdir: 'dist/webview',
		logLevel: 'silent',
		loader: {
			'.css': 'css',
		},
		plugins: [createProblemMatcherPlugin('webview')],
	});
}

async function main() {
	const [extensionCtx, workerCtx, webviewCtx] = await Promise.all([
		createExtensionContext(),
		createWorkerContext(),
		createWebviewContext(),
	]);

	copyTreeSitterWasm();

	if (watch) {
		await extensionCtx.watch();
		await workerCtx.watch();
		await webviewCtx.watch();
		return;
	}

	await Promise.all([extensionCtx.rebuild(), workerCtx.rebuild(), webviewCtx.rebuild()]);
	copyTreeSitterWasm();
	await Promise.all([extensionCtx.dispose(), workerCtx.dispose(), webviewCtx.dispose()]);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
