import { getSettings } from '../../core/config/settings';
import { EXAMPLE_SECRET_PATTERNS } from '../../core/config/types';

function compilePatterns(patterns: readonly string[]): RegExp[] {
	const compiled: RegExp[] = [];
	for (const item of patterns) {
		const line = item.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		try {
			compiled.push(new RegExp(line, 'gi'));
		} catch {
			continue;
		}
	}

	return compiled;
}

export function redactSecrets(text: string, patterns?: readonly string[]): { text: string; count: number } {
	const source = patterns ?? getSettings().secretPatterns;
	let next = text;
	let count = 0;
	for (const re of compilePatterns(source)) {
		next = next.replace(re, () => {
			count += 1;
			return '[REDACTED]';
		});
	}

	return {
		text: next,
		count,
	};
}

export function maskForPrivacy(text: string | undefined): string | undefined {
	if (text === undefined || !getSettings().privacyMode) {
		return text;
	}
	
	const configured = getSettings().secretPatterns;
	return redactSecrets(text, [...EXAMPLE_SECRET_PATTERNS, ...configured]).text
		.replace(/([?&](?:key|token|secret|password|signature)=)[^&\s]+/gi, '$1[REDACTED]');
}
