export const GHOST_MAX_LINES = 12;
export const GHOST_MAX_CHARS = 800;

export function sanitizeGhostInsert(raw: string, opts?: { maxLines?: number; maxChars?: number }): string {
	let insert = raw.trim();
	if (!insert) {
		return '';
	}

	if (insert.startsWith('```')) {
		insert = insert.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim();
	}

	const maxLines = opts?.maxLines ?? GHOST_MAX_LINES;
	const maxChars = opts?.maxChars ?? GHOST_MAX_CHARS;
	const lines = insert.split(/\r?\n/).slice(0, maxLines);
	insert = lines.join('\n');
	if (insert.length > maxChars) {
		insert = insert.slice(0, maxChars);
		// Не оставлять оборванный хвост без перевода строки посередине токена - обрезать до последней строки
		const lastNl = insert.lastIndexOf('\n');
		if (lastNl > maxChars * 0.4) {
			insert = insert.slice(0, lastNl);
		}
	}

	return insert;
}
