/**
 * Точка входа worker_threads: разобрать исходник через Tree-sitter wasm и вернуть диапазоны.
 * Загружается как dist/treeSitterWorker.js (отдельная точка входа esbuild).
 */

import { parentPort, workerData } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectSpansFromTree } from './treeSitterRules';

type ParseRequest = {
	id: number;
	relativePath: string;
	sourceText: string;
	lang: string;
	wasmFile: string;
	timeoutMs: number;
};

type ParseResponse = {
	id: number;
	ok: boolean;
	spans?: Array<{
		name: string;
		kind: string;
		startLine: number;
		endLine: number;
		startIndex: number;
		endIndex: number;
	}>;
	durationMs?: number;
	error?: string;
	timedOut?: boolean;
};

const wasmRoot: string = typeof workerData?.wasmRoot === 'string' ? workerData.wasmRoot : '';

let apiPromise: Promise<{ Parser: any; Language: any } | undefined> | undefined;
const languageCache = new Map<string, any>();

async function ensureApi(): Promise<{ Parser: any; Language: any } | undefined> {
	if (!wasmRoot) {
		return undefined;
	}

	if (!apiPromise) {
		apiPromise = (async () => {
			const glue = path.join(wasmRoot, 'tree-sitter.js');
			if (!fs.existsSync(glue)) {
				throw new Error('worker: нет tree-sitter.js');
			}

			const mod = require(glue) as {
				default?: any;
				Parser?: any;
				Language?: any;
				init?: (opts?: { locateFile?: (scriptName: string) => string }) => Promise<void>;
			};

			const Parser = mod.Parser ?? mod.default?.Parser ?? mod.default ?? mod;
			const Language = mod.Language ?? mod.default?.Language ?? Parser.Language;
			if (!Parser || !Language) {
				throw new Error('worker: нет Parser/Language');
			}

			const init = Parser.init?.bind(Parser) ?? mod.init;
			if (typeof init === 'function') {
				await init({
					locateFile: (scriptName: string) => path.join(wasmRoot, path.basename(scriptName)),
				});
			}

			return { Parser, Language };
		})().catch((err) => {
			apiPromise = undefined;
			throw err;
		});
	}
	return apiPromise;
}

async function loadLanguage(wasmFile: string): Promise<any | undefined> {
	if (languageCache.has(wasmFile)) {
		return languageCache.get(wasmFile);
	}

	const api = await ensureApi();
	if (!api || !wasmRoot) {
		return undefined;
	}

	const full = path.join(wasmRoot, wasmFile);
	if (!fs.existsSync(full)) {
		return undefined;
	}

	const language = await api.Language.load(full);
	languageCache.set(wasmFile, language);
	return language;
}

async function handleParse(req: ParseRequest): Promise<ParseResponse> {
	const started = Date.now();
	try {
		const api = await ensureApi();
		const language = await loadLanguage(req.wasmFile);
		if (!api || !language) {
			return { 
				id: req.id, 
				ok: false, 
				error: 'wasm_missing' 
			};
		}

		const parser = new api.Parser();
		parser.setLanguage(language);
		let timedOut = false;
		const tree = parser.parse(req.sourceText, undefined, {
			progressCallback: () => {
				if (Date.now() - started > req.timeoutMs) {
					timedOut = true;
					return true;
				}

				return false;
			},
		});

		if (timedOut || !tree?.rootNode) {
			try {
				tree?.delete?.();
			} catch {}

			try {
				parser.delete?.();
			} catch {}
			
			return {
				id: req.id,
				ok: false,
				timedOut,
				error: timedOut ? 'timeout' : 'empty',
				durationMs: Date.now() - started,
			};
		}

		const spans = collectSpansFromTree(tree.rootNode, req.sourceText);
		tree.delete?.();
		parser.delete?.();
		return {
			id: req.id,
			ok: true,
			spans,
			durationMs: Date.now() - started,
		};
	} catch (err) {
		return {
			id: req.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - started,
		};
	}
}

if (parentPort) {
	parentPort.on('message', (msg: ParseRequest) => {
		void handleParse(msg).then((res) => parentPort!.postMessage(res));
	});
}
