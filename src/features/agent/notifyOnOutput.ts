import { stripAnsi } from './ansi';

export interface NotifyOnOutputMatchOptions {
	// Полный буфер job.output
	output: string;
	// Длина буфера на старте await - матчим только новый хвост
	fromOffset: number;
	pattern: RegExp;
}

/**
 * Совпадение notify_on_output только по **новому** выводу (без ложного срабатывания на старый буфер).
 * Перед regex срезаем ANSI.
 */
export function matchNotifyOnOutput(opts: NotifyOnOutputMatchOptions): {
	matched: boolean;
	slice: string;
} {
	const from = Math.max(0, Math.min(opts.fromOffset, opts.output.length));
	const slice = stripAnsi(opts.output.slice(from));
	if (!slice) {
		return { matched: false, slice };
	}

	// Сброс lastIndex у /g паттернов
	opts.pattern.lastIndex = 0;
	return {
		matched: opts.pattern.test(slice),
		slice,
	};
}

// Собрать RegExp из строки пользователя; пустая / битая - ошибка текстом
export function compileNotifyPattern(raw: string): { ok: true; pattern: RegExp } | { ok: false; error: string } {
	const trimmed = raw.trim();
	if (!trimmed) {
		return {
			ok: false,
			error: 'пустой regex'
		};
	}

	try {
		return {
			ok: true,
			pattern: new RegExp(trimmed)
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
