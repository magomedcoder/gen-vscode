// Упрощённый HTML -> markdown для web_fetch / @url (без полноценного браузера)
export function htmlToMarkdown(html: string, maxChars = 24_000): string {
	let text = html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');

	text = text
		.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
		.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
		.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<\/div>/gi, '\n')
		.replace(/<\/tr>/gi, '\n')
		.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
}
