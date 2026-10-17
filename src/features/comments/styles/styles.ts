import type { CommentStyleConfig, CommentStyleId } from './types';

const cStrings = [
	{ open: "'", close: "'", escape: true },
	{ open: '"', close: '"', escape: true },
	{ open: '`', close: '`', escape: true },
];

const hashStrings = [
	{ open: "'''", close: "'''", escape: true },
	{ open: '"""', close: '"""', escape: true },
	{ open: "'", close: "'", escape: true },
	{ open: '"', close: '"', escape: true },
];

const sqlStrings = [
	{ open: "'", close: "'", escape: false, doubledEscape: true },
	{ open: '"', close: '"', escape: false, doubledEscape: true },
];

// Предустановленные семейства - новый синтаксис = новый id + конфиг
export const COMMENT_STYLES: Record<CommentStyleId, CommentStyleConfig> = {
	// TypeScript/JS-подобные: // и /* */ - также запасной вариант для неизвестных языков
	tsStyle: {
		line: ['//'],
		block: [{ open: '/*', close: '*/' }],
		strings: cStrings,
	},
	hash: {
		line: ['#'],
		block: [
			{ open: '=begin', close: '=end', atLineStart: true },
		],
		strings: hashStrings,
	},
	html: {
		line: [],
		block: [{ open: '<!--', close: '-->' }],
		strings: [
			{ open: '"', close: '"', escape: true },
			{ open: "'", close: "'", escape: true },
		],
	},
	sql: {
		line: ['--'],
		block: [{ open: '/*', close: '*/' }],
		strings: sqlStrings,
	},
	lua: {
		line: ['--'],
		block: [{ open: '--[[', close: ']]' }],
		strings: [
			{ open: "'", close: "'", escape: true },
			{ open: '"', close: '"', escape: true },
			{ open: '[[', close: ']]', escape: false },
		],
	},
	php: {
		line: ['//', '#'],
		block: [{ open: '/*', close: '*/' }],
		strings: cStrings,
	}
};


const LANGUAGE_STYLE: Record<string, CommentStyleId> = {
	// ts-style: // и /* */
	javascript: 'tsStyle',
	javascriptreact: 'tsStyle',
	typescript: 'tsStyle',
	typescriptreact: 'tsStyle',
	jsx: 'tsStyle',
	tsx: 'tsStyle',
	java: 'tsStyle',
	c: 'tsStyle',
	cpp: 'tsStyle',
	csharp: 'tsStyle',
	go: 'tsStyle',
	rust: 'tsStyle',
	kotlin: 'tsStyle',
	swift: 'tsStyle',
	scala: 'tsStyle',
	dart: 'tsStyle',
	groovy: 'tsStyle',
	objectivec: 'tsStyle',
	objectivecpp: 'tsStyle',
	jsonc: 'tsStyle',
	json5: 'tsStyle',
	css: 'tsStyle',
	scss: 'tsStyle',
	less: 'tsStyle',
	sass: 'tsStyle',

	// Комментарии через # (hash-синтаксис)
	python: 'hash',
	python2: 'hash',
	python3: 'hash',
	ruby: 'hash',
	shellscript: 'hash',
	shell: 'hash',
	bash: 'hash',
	zsh: 'hash',
	fish: 'hash',
	powershell: 'hash',
	yaml: 'hash',
	yml: 'hash',
	toml: 'hash',
	perl: 'hash',
	r: 'hash',
	elixir: 'hash',
	dockerfile: 'hash',
	makefile: 'hash',
	cmake: 'hash',
	ini: 'hash',
	properties: 'hash',
	gitignore: 'hash',
	ignore: 'hash',

	// HTML-подобные (<!-- -->)
	html: 'html',
	xml: 'html',
	svg: 'html',
	xsl: 'html',
	vue: 'html',
	svelte: 'html',

	// SQL (-- и /* */)
	sql: 'sql',
	mysql: 'sql',
	postgres: 'sql',
	postgresql: 'sql',
	sqlite: 'sql',
	plsql: 'sql',
	tsql: 'sql',

	// Lua (-- и --[[ ]])
	lua: 'lua',

	// PHP: //, # и блочные /* */
	php: 'php',
};

const DEFAULT_STYLE: CommentStyleId = 'tsStyle';

export function resolveCommentStyleId(languageId: string): CommentStyleId {
	const key = languageId.trim().toLowerCase();
	return LANGUAGE_STYLE[key] ?? DEFAULT_STYLE;
}

export function getCommentStyleConfig(languageId: string): CommentStyleConfig {
	return COMMENT_STYLES[resolveCommentStyleId(languageId)];
}
