import * as path from 'node:path';

const JS_EXT = /\.(?:[cm]?[jt]s|tsx|jsx)$/i;
const PY_EXT = /\.py$/i;
const GO_EXT = /\.go$/i;

export type ImportLang = 'js' | 'python' | 'go';

export function detectImportLang(rel: string): ImportLang | undefined {
	if (JS_EXT.test(rel)) {
		return 'js';
	}

	if (PY_EXT.test(rel)) {
		return 'python';
	}

	if (GO_EXT.test(rel)) {
		return 'go';
	}

	return undefined;
}

export function isGraphPath(rel: string): boolean {
	return detectImportLang(rel) !== undefined;
}

export function isJsLikePath(rel: string): boolean {
	return JS_EXT.test(rel);
}

/**
 * Импорты ES/CJS из текста (эвристика).
 * `export ... from` / `export * from` помечаются как реэкспорт (реэкспорт всё равно создаёт ребро; ложные срабатывания циклов снижаем, игнорируя чистые barrel-реэкспорты при оценке).
 */
export function extractJsImports(source: string): string[] {
	const out: string[] = [];
	const patterns = [
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\bimport\s+['"]([^'"]+)['"]/g,
		/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
		/\bexport\s+\{[^}]*\}\s*from\s+['"]([^'"]+)['"]/g,
	];

	for (const re of patterns) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) !== null) {
			const spec = m[1]?.trim();
			if (spec) {
				out.push(spec);
			}
		}
	}

	return [...new Set(out)];
}

// Строки вида `export ... from 'x'` / `export * from 'x'` - чистый re-export
export function isMostlyReExportFile(source: string): boolean {
	const lines = source
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));
	
		if (lines.length === 0) {
		return false;
	}

	const reExport = lines.filter((l) => /^export\s+(\*|\{)/.test(l) && /\bfrom\s+['"]/.test(l)).length;
	const imports = lines.filter((l) => /^import\b/.test(l)).length;
	const other = lines.length - reExport - imports;
	return reExport > 0 && other <= 1 && reExport >= Math.max(1, lines.length - 2);
}

export function extractPythonImports(source: string): string[] {
	const out: string[] = [];
	const patterns = [
		/^\s*from\s+(\.[\w.]*)\s+import\b/gm,
		/^\s*import\s+(\.[\w.]*)\b/gm,
	];

	for (const re of patterns) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) !== null) {
			const spec = m[1]?.trim();
			if (spec?.startsWith('.')) {
				out.push(spec);
			}
		}
	}

	return [...new Set(out)];
}

export function extractGoImports(source: string): string[] {
	const out: string[] = [];
	const block = /import\s*\(([\s\S]*?)\)/g;
	let m: RegExpExecArray | null;
	while ((m = block.exec(source)) !== null) {
		for (const line of m[1]!.split(/\r?\n/)) {
			const q = line.match(/"([^"]+)"/);
			if (q?.[1] && (q[1].startsWith('.') || q[1].startsWith('/'))) {
				out.push(q[1]);
			}
		}
	}

	const single = /^\s*import\s+(?:\w+\s+)?"(\.[^"]+)"/gm;
	while ((m = single.exec(source)) !== null) {
		if (m[1]) {
			out.push(m[1]);
		}
	}

	return [...new Set(out)];
}

/**
 * Диапазоны Tree-sitter и текст import-узла -> относительные спецификаторы для JS.
 * Резервный вариант: регулярное выражение extractJsImports.
 */
export function extractImportsForFile(
	rel: string,
	source: string,
	opts?: { treeSitterImportSpecs?: string[] },
): string[] {
	const lang = detectImportLang(rel);
	if (!lang) {
		return [];
	}

	if (lang === 'js') {
		const fromTs = opts?.treeSitterImportSpecs?.filter(Boolean) ?? [];
		if (fromTs.length > 0) {
			return [...new Set([...fromTs, ...extractJsImports(source)])];
		}

		return extractJsImports(source);
	}

	if (lang === 'python') {
		return extractPythonImports(source);
	}

	return extractGoImports(source);
}

function stripExt(rel: string): string {
	return rel.replace(/\.(?:[cm]?[jt]s|tsx|jsx|py|go)$/i, '');
}

export function resolveImportSpec(
	fromFile: string,
	spec: string,
	fileSet: Set<string>,
	lang: ImportLang = 'js',
): string | undefined {
	if (lang === 'js') {
		if (!spec.startsWith('.')) {
			return undefined;
		}

		const fromDir = path.posix.dirname(fromFile);
		const joined = path.posix.normalize(path.posix.join(fromDir, spec));
		const candidates = [
			joined,
			`${joined}.ts`,
			`${joined}.tsx`,
			`${joined}.js`,
			`${joined}.jsx`,
			`${joined}.mjs`,
			`${joined}.cjs`,
			`${joined}/index.ts`,
			`${joined}/index.tsx`,
			`${joined}/index.js`,
			`${joined}/index.jsx`,
		];

		for (const c of candidates) {
			if (fileSet.has(c)) {
				return c;
			}
		}

		const noExt = stripExt(joined);
		for (const f of fileSet) {
			if (stripExt(f) === noExt || stripExt(f) === `${noExt}/index`) {
				return f;
			}
		}
		return undefined;
	}

	if (lang === 'python') {
		if (!spec.startsWith('.')) {
			return undefined;
		}

		const fromDir = path.posix.dirname(fromFile);
		let dots = 0;
		while (spec[dots] === '.') {
			dots += 1;
		}

		const rest = spec.slice(dots).replace(/\./g, '/');
		let dir = fromDir;
		for (let i = 1; i < dots; i += 1) {
			dir = path.posix.dirname(dir);
		}

		const base = rest ? path.posix.normalize(path.posix.join(dir, rest)) : dir;
		const candidates = [`${base}.py`, `${base}/__init__.py`];
		for (const c of candidates) {
			if (fileSet.has(c)) {
				return c;
			}
		}

		return undefined;
	}

	// Go: относительные импорты редки; только ./foo
	if (!spec.startsWith('.')) {
		return undefined;
	}

	const fromDir = path.posix.dirname(fromFile);
	const joined = path.posix.normalize(path.posix.join(fromDir, spec));
	for (const f of fileSet) {
		if (f.startsWith(`${joined}/`) || stripExt(f) === joined || f === `${joined}.go`) {
			return f.endsWith('.go') ? f : undefined;
		}
	}

	const asFile = joined.endsWith('.go') ? joined : `${joined}.go`;
	
	return fileSet.has(asFile) ? asFile : undefined;
}

export type GraphFile = {
	path: string;
	source: string;
	treeSitterImportSpecs?: string[];
};

export function buildImportGraph(files: GraphFile[]): Map<string, string[]> {
	const fileSet = new Set(files.map((f) => f.path));
	const graph = new Map<string, string[]>();

	for (const file of files) {
		const lang = detectImportLang(file.path);
		if (!lang) {
			continue;
		}

		const deps: string[] = [];
		for (const spec of extractImportsForFile(file.path, file.source, {
			treeSitterImportSpecs: file.treeSitterImportSpecs,
		})) {
			const resolved = resolveImportSpec(file.path, spec, fileSet, lang);
			if (resolved && resolved !== file.path) {
				deps.push(resolved);
			}
		}
		graph.set(file.path, [...new Set(deps)]);
	}

	return graph;
}

export function findImportCycles(
	graph: Map<string, string[]>,
	opts?: { skipBarrelReExports?: Set<string> },
): string[][] {
	const cycles: string[][] = [];
	const seenCycle = new Set<string>();
	const visiting = new Set<string>();
	const stack: string[] = [];
	const skip = opts?.skipBarrelReExports;

	const visit = (node: string) => {
		if (visiting.has(node)) {
			const idx = stack.indexOf(node);
			if (idx >= 0) {
				const cycle = [...stack.slice(idx), node];

				// FP: цикл только из barrel re-export файлов
				if (skip && cycle.every((p) => skip.has(p) || p === cycle[0])) {
					const nonBarrel = cycle.filter((p) => p !== cycle[cycle.length - 1] && !skip.has(p));
					if (nonBarrel.length === 0) {
						return;
					}
				}

				const key = [...cycle].sort().join('>');
				if (!seenCycle.has(key)) {
					seenCycle.add(key);
					cycles.push(cycle);
				}
			}
			return;
		}

		if (!graph.has(node)) {
			return;
		}

		visiting.add(node);
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			visit(next);
		}
		stack.pop();
		visiting.delete(node);
	};

	for (const node of graph.keys()) {
		visit(node);
	}

	return cycles.slice(0, 50);
}

const ENTRY_HINT = /(?:^|\/)(?:index|main|app|extension|activate|__init__)(?:\.[^/]+)?$/i;
const ORPHAN_SKIP = /(?:\.d\.ts$|\/(?:dist|build|out|coverage|storybook|__mocks__|fixtures|generated|vendor)\b|\.stories\.|\.story\.|\.mock\.|\.config\.|\.min\.)/i;

export type OrphanOptions = {
	ignorePatterns?: readonly string[];
};

export function findOrphanFiles(graph: Map<string, string[]>, opts?: OrphanOptions): string[] {
	const imported = new Set<string>();
	for (const deps of graph.values()) {
		for (const d of deps) {
			imported.add(d);
		}
	}

	const ignore = opts?.ignorePatterns ?? [];
	const orphans: string[] = [];
	for (const file of graph.keys()) {
		if (imported.has(file)) {
			continue;
		}

		if (
			ENTRY_HINT.test(file)
			|| file.includes('/test/')
			|| file.includes('.test.')
			|| file.includes('.spec.')
			|| ORPHAN_SKIP.test(file)
		) {
			continue;
		}

		if (ignore.length > 0 && matchesIgnorePatterns(file, ignore)) {
			continue;
		}

		orphans.push(file);
	}

	return orphans.sort().slice(0, 200);
}

export function matchesIgnorePatterns(rel: string, patterns: readonly string[]): boolean {
	const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
	for (const raw of patterns) {
		const pat = raw.trim().replace(/\\/g, '/');
		if (!pat || pat.startsWith('#')) {
			continue;
		}

		if (pat.endsWith('/')) {
			const dir = pat.slice(0, -1);
			if (p === dir || p.startsWith(`${dir}/`)) {
				return true;
			}
			continue;
		}

		if (pat.startsWith('*.')) {
			if (p.endsWith(pat.slice(1))) {
				return true;
			}
			continue;
		}

		if (pat.includes('*')) {
			const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
			if (new RegExp(`^${escaped}$`).test(p)) {
				return true;
			}
			continue;
		}

		if (p === pat || p.startsWith(`${pat}/`) || p.endsWith(`/${pat}`)) {
			return true;
		}
	}

	return false;
}

export function repoHealthCacheKey(
	paths: readonly string[],
	ignorePatterns: readonly string[],
): string {
	const joined = [...paths].sort().join('\n');
	const ign = [...ignorePatterns].map((s) => s.trim()).filter(Boolean).sort().join('\n');
	let h = 2166136261;
	const s = `${joined}\n#\n${ign}`;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}

	return `${paths.length}:${(h >>> 0).toString(16)}`;
}

// Извлечь строковые литералы import/from из диапазонов Tree-sitter (грубо по тексту диапазона)
export function importSpecsFromTreeSitterSpans(
	source: string,
	spans: ReadonlyArray<{ startIndex: number; endIndex: number; kind?: string; name?: string }>,
): string[] {
	const out: string[] = [];
	for (const sp of spans) {
		const slice = source.slice(sp.startIndex, sp.endIndex);
		for (const m of slice.matchAll(/['"](\.[^'"]+)['"]/g)) {
			if (m[1]) {
				out.push(m[1]);
			}
		}
	}

	// Дополнительный проход по всему файлу через регулярное выражение import/export уже есть в резервном варианте
	return [...new Set(out)];
}
