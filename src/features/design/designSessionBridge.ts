import type { DesignSessionPayload, ToWebviewMessage } from '../chat/protocol';
import { getLastDesignSelection } from './designSession';

// Снимок последнего Design click для webview (Settings / chat)
export function buildDesignSessionPayload(): DesignSessionPayload | null {
	const sel = getLastDesignSelection();
	if (!sel) {
		return null;
	}

	return {
		path: sel.sourcePath,
		line: sel.line,
		url: sel.url,
		selector: sel.selector,
		updatedAt: sel.inspectedAt,
	};
}

export function buildDesignSessionMessage(): Extract<ToWebviewMessage, { type: 'designSession' }> {
	return {
		type: 'designSession',
		session: buildDesignSessionPayload(),
	};
}
