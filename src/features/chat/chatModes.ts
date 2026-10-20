import type { ChatMode } from '../../core/config/types';

/**
 * Единый реестр режимов чата.
 * Composer picker, Settings default, slash `/mode` - из этого списка.
 * Новый режим: добавить id в ChatMode + запись сюда (+ runtime ветки).
 */
export interface ChatModeDef {
	id: ChatMode;
	// Полная подпись (Settings)
	labelKey: string;
	// Короткая подпись (composer select)
	shortKey: string;
	// Подпись slash-autocomplete
	slashDetailKey: string;
}

export const CHAT_MODE_DEFS: readonly ChatModeDef[] = [
	{
		id: 'ask',
		labelKey: 'settings.chatMode.ask',
		shortKey: 'chat.composer.mode.ask',
		slashDetailKey: 'chat.slash.ask',
	},
	{
		id: 'agent',
		labelKey: 'settings.chatMode.agent',
		shortKey: 'chat.composer.mode.agent',
		slashDetailKey: 'chat.slash.agent',
	},
	{
		id: 'plan',
		labelKey: 'settings.chatMode.plan',
		shortKey: 'chat.composer.mode.plan',
		slashDetailKey: 'chat.slash.plan',
	},
	{
		id: 'debug',
		labelKey: 'settings.chatMode.debug',
		shortKey: 'chat.composer.mode.debug',
		slashDetailKey: 'chat.slash.debug',
	},
	{
		id: 'design',
		labelKey: 'settings.chatMode.design',
		shortKey: 'chat.composer.mode.design',
		slashDetailKey: 'chat.slash.design',
	},
	{
		id: 'multitask',
		labelKey: 'settings.chatMode.multitask',
		shortKey: 'chat.composer.mode.multitask',
		slashDetailKey: 'chat.slash.multitask',
	},
	{
		id: 'project',
		labelKey: 'settings.chatMode.project',
		shortKey: 'chat.composer.mode.project',
		slashDetailKey: 'chat.slash.project',
	},
];

const CHAT_MODE_SET = new Set<string>(CHAT_MODE_DEFS.map((d) => d.id));

export function isChatMode(value: unknown): value is ChatMode {
	return typeof value === 'string' && CHAT_MODE_SET.has(value);
}

export function chatModeDef(id: ChatMode): ChatModeDef {
	return CHAT_MODE_DEFS.find((d) => d.id === id) ?? CHAT_MODE_DEFS[0]!;
}

// Ids для schema / тестов (порядок = picker)
export const CHAT_MODE_IDS: readonly ChatMode[] = CHAT_MODE_DEFS.map((d) => d.id);
