export const CHAT_VIEW_ID = 'gen.chatView';
export const CHAT_EDITOR_VIEW_TYPE = 'gen.chatEditor';

export function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
