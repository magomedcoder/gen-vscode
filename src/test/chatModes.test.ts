import * as assert from 'assert';
import { CHAT_MODE_DEFS, CHAT_MODE_IDS, isChatMode } from '../features/chat/chatModes.js';
import { SLASH_COMMANDS } from '../features/chat/slashCommands.js';
import { isAgentLikeMode } from '../core/config/types.js';

suite('chatModes registry', () => {
	test('CHAT_MODE_IDS покрывает все defs без дублей', () => {
		assert.strictEqual(CHAT_MODE_IDS.length, CHAT_MODE_DEFS.length);
		assert.strictEqual(new Set(CHAT_MODE_IDS).size, CHAT_MODE_IDS.length);
		assert.ok(isChatMode('ask'));
		assert.ok(isChatMode('project'));
		assert.ok(!isChatMode('yolo'));
	});

	test('isAgentLikeMode: только ask без tools', () => {
		assert.strictEqual(isAgentLikeMode('ask'), false);
		for (const id of CHAT_MODE_IDS) {
			if (id === 'ask') {
				continue;
			}
			assert.strictEqual(isAgentLikeMode(id), true, id);
		}
	});

	test('каждый режим имеет slash-команду mode', () => {
		for (const id of CHAT_MODE_IDS) {
			const cmd = SLASH_COMMANDS.find((c) => c.name === id && c.mode === id);
			assert.ok(cmd, `missing slash for ${id}`);
		}
	});
});
