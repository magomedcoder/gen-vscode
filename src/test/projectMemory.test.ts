import * as assert from 'assert';
import { extractMemoryCandidatesFromSummary, formatMemoryForPrompt, MEMORY_RELATIVE, MEMORY_TEMPLATE, mergeMemoryAppend, normalizeMemoryText } from '../features/project/projectMemory.js';

suite('projectMemory', () => {
	test('normalizeMemoryText: пустой / только шаблон -> undefined', () => {
		assert.strictEqual(normalizeMemoryText(''), undefined);
		assert.strictEqual(normalizeMemoryText('   '), undefined);
		assert.strictEqual(
			normalizeMemoryText('# Project memory\n\n## Decisions\n\n-\n\n## Preferences\n\n-\n'),
			undefined,
		);
	});

	test('normalizeMemoryText: substantive content', () => {
		const text = '# Project memory\n\n## Decisions\n\n- Use pnpm\n';
		const normalized = normalizeMemoryText(text);
		assert.ok(normalized);
		assert.ok(normalized!.includes('Use pnpm'));
		assert.ok(formatMemoryForPrompt(normalized!).startsWith(`### ${MEMORY_RELATIVE}`));
	});

	test('extractMemoryCandidatesFromSummary: Decisions / Next step, max 5', () => {
		const summary = [
			'## Goal',
			'Ship memory',
			'## Decisions',
			'- Prefer workspace file only',
			'- No cloud Memories',
			'- Cap at 6k chars',
			'## Files / paths',
			'.gen/memory.md',
			'## Done',
			'Loader',
			'## Next step',
			'- Wire compact offer',
			'- Update wiki',
			'## Open questions',
			'None',
		].join('\n');
		const lines = extractMemoryCandidatesFromSummary(summary);
		assert.strictEqual(lines.length, 5);
		assert.ok(lines[0]!.includes('workspace file'));
		assert.ok(lines.some((l) => l.includes('compact offer')));
	});

	test('extractMemoryCandidatesFromSummary: без Decisions -> Next', () => {
		const lines = extractMemoryCandidatesFromSummary(
			'## Next step\nRemember to use actModel for Agent\n## Done\nx',
		);
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0]!.includes('actModel'));
	});

	test('mergeMemoryAppend: под ## Decisions, без дубля плейсхолдера', () => {
		const next = mergeMemoryAppend(MEMORY_TEMPLATE, ['- Use pnpm', '- No cloud sync']);
		assert.ok(next.includes('## Decisions'));
		assert.ok(next.includes('- Use pnpm'));
		assert.ok(next.includes('- No cloud sync'));
		assert.ok(next.includes('## Preferences'));
		// Один плейсхолдер «-» под Decisions убран
		const decisionsBlock = next.split(/##\s+Preferences/i)[0]!;
		assert.ok(!/\n-\n/.test(decisionsBlock));
	});
});
