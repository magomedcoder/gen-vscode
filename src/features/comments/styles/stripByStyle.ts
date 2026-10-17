import type { BlockRule, CommentStyleConfig, StringRule } from './types';

type State = | {
	kind: 'code'
} | {
	kind: 'line'
} | {
	kind: 'block';
	close: string
} | {
	kind: 'string';
	rule: StringRule
};

export function stripByStyle(source: string, style: CommentStyleConfig): string {
	const lineMarkers = [...style.line].sort((a, b) => b.length - a.length);
	const blockRules = [...style.block].sort((a, b) => b.open.length - a.open.length);
	const stringRules = [...style.strings].sort((a, b) => b.open.length - a.open.length);

	let result = '';
	let i = 0;
	let state: State = { kind: 'code' };
	let lineStart = true;
	let onlyWsSinceLineStart = true;

	while (i < source.length) {
		const ch = source[i];

		if (state.kind === 'code') {
			if (ch === '\n') {
				result += ch;
				i += 1;
				lineStart = true;
				onlyWsSinceLineStart = true;
				continue;
			}

			const atLineStart = lineStart || onlyWsSinceLineStart;

			const str = matchPrefix(source, i, stringRules.map((r) => r.open));
			if (str) {
				const rule = stringRules.find((r) => r.open === str)!;
				result += str;
				i += str.length;
				state = { kind: 'string', rule };
				lineStart = false;
				onlyWsSinceLineStart = false;
				continue;
			}

			const block = matchBlockOpen(source, i, blockRules, atLineStart);
			if (block) {
				state = { kind: 'block', close: block.close };
				i += block.open.length;
				lineStart = false;
				onlyWsSinceLineStart = false;
				continue;
			}

			const line = matchPrefix(source, i, lineMarkers);
			if (line) {
				state = { kind: 'line' };
				i += line.length;
				lineStart = false;
				onlyWsSinceLineStart = false;
				continue;
			}

			if (ch === ' ' || ch === '\t') {
				result += ch;
				i += 1;
				// onlyWsSinceLineStart остаётся true, пока с начала строки только пробелы
				continue;
			}

			result += ch;
			i += 1;
			lineStart = false;
			onlyWsSinceLineStart = false;
			continue;
		}

		if (state.kind === 'line') {
			if (ch === '\n') {
				result += ch;
				state = { kind: 'code' };
				lineStart = true;
				onlyWsSinceLineStart = true;
			}
			i += 1;
			continue;
		}

		if (state.kind === 'block') {
			if (startsWithAt(source, i, state.close)) {
				i += state.close.length;
				state = { kind: 'code' };
				lineStart = false;
				onlyWsSinceLineStart = false;
				continue;
			}

			if (ch === '\n') {
				lineStart = true;
				onlyWsSinceLineStart = true;
			} else if (ch !== ' ' && ch !== '\t') {
				lineStart = false;
				onlyWsSinceLineStart = false;
			}

			i += 1;
			continue;
		}

		// строковый литерал
		const { rule } = state;
		const escape = rule.escape !== false && !rule.doubledEscape;

		if (escape && ch === '\\' && i + 1 < source.length) {
			result += ch + source[i + 1];
			i += 2;
			lineStart = false;
			onlyWsSinceLineStart = false;
			continue;
		}

		if (startsWithAt(source, i, rule.close)) {
			if (rule.doubledEscape && startsWithAt(source, i + rule.close.length, rule.close)) {
				result += rule.close + rule.close;
				i += rule.close.length * 2;
				continue;
			}
			result += rule.close;
			i += rule.close.length;
			state = { kind: 'code' };
			lineStart = false;
			onlyWsSinceLineStart = false;
			continue;
		}

		if (ch === '\n') {
			result += ch;
			i += 1;
			lineStart = true;
			onlyWsSinceLineStart = true;
			continue;
		}

		result += ch;
		i += 1;
		lineStart = false;
		onlyWsSinceLineStart = false;
	}

	return result;
}

function matchPrefix(source: string, index: number, markers: string[]): string | undefined {
	for (const marker of markers) {
		if (marker && startsWithAt(source, index, marker)) {
			return marker;
		}
	}

	return undefined;
}

function matchBlockOpen(source: string, index: number, blocks: BlockRule[], atLineStart: boolean): BlockRule | undefined {
	for (const block of blocks) {
		if (block.atLineStart && !atLineStart) {
			continue;
		}
		
		if (startsWithAt(source, index, block.open)) {
			return block;
		}
	}

	return undefined;
}

function startsWithAt(source: string, index: number, token: string): boolean {
	if (!token || index + token.length > source.length) {
		return false;
	}

	return source.startsWith(token, index);
}
