/**
 * Нормализация OpenAI-compatible baseUrl: trim, без trailing slash, без дубля `/v1/v1`.
 * Пустой ввод -> ''.
 */
export function normalizeBaseUrl(raw: string): string {
	let url = String(raw ?? '').trim();
	if (!url) {
		return '';
	}

	// file:// и прочее не трогаем сверх trim
	try {
		const parsed = new URL(url.includes('://') ? url : `http://${url}`);
		let path = parsed.pathname.replace(/\/+$/, '') || '';
		// Схлопнуть .../v1/v1 -> .../v1
		while (/\/v1\/v1$/i.test(path)) {
			path = path.replace(/\/v1$/i, '');
		}
		parsed.pathname = path || '/';
		// URL с pathname `/` -> origin без лишнего слэша
		const href = parsed.toString().replace(/\/$/, '');
		return href;
	} catch {
		return url.replace(/\/+$/, '');
	}
}
