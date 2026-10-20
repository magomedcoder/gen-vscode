/**
 * Ограниченный параллелизм без зависимостей и без vscode.
 * Результаты возвращаются в порядке items (не в порядке завершения).
 * Первая ошибка (в т.ч. abort из fn) прекращает запуск новых задач и пробрасывается после завершения in-flight.
 */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
	shouldStop?: () => boolean,
): Promise<Array<R | undefined>> {
	const results: Array<R | undefined> = new Array(items.length).fill(undefined);
	if (items.length === 0) {
		return results;
	}

	let cursor = 0;
	let failure: { error: unknown } | undefined;
	const worker = async (): Promise<void> => {
		while (!failure && cursor < items.length) {
			if (shouldStop?.()) {
				return;
			}

			const idx = cursor;
			cursor += 1;
			try {
				results[idx] = await fn(items[idx]!, idx);
			} catch (error) {
				failure ??= { error };
				return;
			}
		}
	};

	const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
	await Promise.all(Array.from({ 
		length: width 
	}, () => worker()));
	if (failure) {
		throw failure.error;
	}

	return results;
}
