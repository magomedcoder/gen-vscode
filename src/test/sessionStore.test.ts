import * as assert from 'node:assert/strict';
import type { Memento } from 'vscode';
import type { ChatUiMessage } from '../features/chat/protocol.js';
import { MAX_STORED_TOOL_RESULT_CHARS, SessionStore, capToolResult, slimMessages } from '../features/chat/sessionStore.js';
import { MAX_RESEARCH_JOBS, pruneResearchJobs, upsertResearchJob } from '../features/agent/researchJobs.js';
import type { ResearchJob } from '../features/agent/researchJobs.js';
import { mapLimit } from '../core/util/asyncPool.js';

const INDEX_KEY = 'gen.chat.sessionIndex';
const MSGS_PREFIX = 'gen.chat.session.msgs.';

class FakeMemento implements Memento {
	readonly data = new Map<string, unknown>();
	readonly writes: string[] = [];

	keys(): readonly string[] {
		return [...this.data.keys()];
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.data.has(key) ? this.data.get(key) : defaultValue) as T | undefined;
	}

	update(key: string, value: unknown): Thenable<void> {
		this.writes.push(key);
		if (value === undefined) {
			this.data.delete(key);
		} else {
			// structuredClone: эмулируем сериализацию memento (без aliasing)
			this.data.set(key, structuredClone(value));
		}

		return Promise.resolve();
	}
}

function userMsg(id: string, content: string): ChatUiMessage {
	return {
		id,
		role: 'user',
		content
	};
}

function toolMsg(id: string, result: string): ChatUiMessage {
	return {
		id,
		role: 'assistant',
		content: 'run',
		toolCalls: [{
			id: `${id}-call`,
			name: 'read_file',
			arguments: '{}',
			status: 'ok',
			result,
		}],
	};
}

suite('SessionStore persist dirty', () => {
	test('saveMessages пишет только dirty-сессию, не весь список', async () => {
		const memento = new FakeMemento();
		const store = new SessionStore(memento);
		const a = store.getCurrent();
		const b = store.createSession('B');
		store.switchSession(a.id);
		await store.flush();

		memento.writes.length = 0;
		store.saveMessages([userMsg('1', 'hello')], a.id);
		await store.flush();

		const msgWrites = memento.writes.filter((k) => k.startsWith(MSGS_PREFIX));
		assert.deepEqual(msgWrites, [`${MSGS_PREFIX}${a.id}`]);
		assert.ok(!memento.writes.includes(`${MSGS_PREFIX}${b.id}`));
		assert.ok(memento.writes.includes(INDEX_KEY));
		assert.equal((memento.data.get(`${MSGS_PREFIX}${a.id}`) as ChatUiMessage[]).length, 1);
	});

	test('несколько saveMessages подряд -> один batch write при flush', async () => {
		const memento = new FakeMemento();
		const store = new SessionStore(memento);
		const a = store.getCurrent();
		await store.flush();
		memento.writes.length = 0;

		store.saveMessages([userMsg('1', 'one')], a.id);
		store.saveMessages([userMsg('1', 'one'), userMsg('2', 'two')], a.id);
		store.saveMessages([userMsg('1', 'one'), userMsg('2', 'two'), userMsg('3', 'three')], a.id);
		// debounced: до flush на диск ничего нового не ушло
		assert.equal(memento.writes.filter((k) => k.startsWith(MSGS_PREFIX)).length, 0);

		await store.flush();
		assert.equal(memento.writes.filter((k) => k === `${MSGS_PREFIX}${a.id}`).length, 1);
		assert.equal((memento.data.get(`${MSGS_PREFIX}${a.id}`) as ChatUiMessage[]).length, 3);

		// flush без изменений - no-op
		memento.writes.length = 0;
		await store.flush();
		assert.equal(memento.writes.length, 0);
	});

	test('saveMessages без изменений не двигает updatedAt и не помечает dirty', async () => {
		const memento = new FakeMemento();
		const store = new SessionStore(memento);
		const a = store.getCurrent();
		store.saveMessages([userMsg('1', 'hi')], a.id);
		await store.flush();
		const before = store.getSession(a.id)!.updatedAt;
		memento.writes.length = 0;

		store.saveMessages([userMsg('1', 'hi')], a.id);
		await store.flush();
		assert.equal(store.getSession(a.id)!.updatedAt, before);
		assert.equal(memento.writes.length, 0);
	});

	test('deleteSession удаляет msgs-ключ; reload восстанавливает сессии', async () => {
		const memento = new FakeMemento();
		const store = new SessionStore(memento);
		const a = store.getCurrent();
		store.saveMessages([userMsg('1', 'keep me')], a.id);
		const b = store.createSession('B');
		store.saveMessages([userMsg('2', 'drop me')], b.id);
		await store.flush();
		assert.ok(memento.data.has(`${MSGS_PREFIX}${b.id}`));

		store.deleteSession(b.id);
		await store.flush();
		assert.ok(!memento.data.has(`${MSGS_PREFIX}${b.id}`));

		const reloaded = new SessionStore(memento);
		assert.equal(reloaded.getSession(a.id)?.messages[0]?.content, 'keep me');
		assert.equal(reloaded.getSession(b.id), undefined);
	});

});

suite('SessionStore tool.result cap', () => {
	test('capToolResult: короткий без изменений, длинный режется и идемпотентен', () => {
		assert.equal(capToolResult('short'), 'short');
		const big = 'x'.repeat(MAX_STORED_TOOL_RESULT_CHARS * 3);
		const capped = capToolResult(big);
		assert.ok(capped.length < big.length);
		assert.ok(capped.startsWith('x'.repeat(MAX_STORED_TOOL_RESULT_CHARS)));
		assert.equal(capToolResult(capped), capped);
	});

	test('slimMessages режет tool.result, не мутирует вход', () => {
		const big = 'y'.repeat(MAX_STORED_TOOL_RESULT_CHARS + 500);
		const input = [toolMsg('m1', big)];
		const out = slimMessages(input);
		assert.ok(out[0]!.toolCalls![0]!.result!.length < big.length);
		assert.equal(input[0]!.toolCalls![0]!.result, big);
	});

	test('persist: в memento tool.result урезан, в памяти rt-сообщения целы', async () => {
		const memento = new FakeMemento();
		const store = new SessionStore(memento);
		const a = store.getCurrent();
		const big = 'z'.repeat(MAX_STORED_TOOL_RESULT_CHARS * 5);
		const live = [userMsg('1', 'go'), toolMsg('2', big)];
		store.saveMessages(live, a.id);
		await store.flush();

		const stored = memento.data.get(`${MSGS_PREFIX}${a.id}`) as ChatUiMessage[];
		assert.ok(stored[1]!.toolCalls![0]!.result!.length <= MAX_STORED_TOOL_RESULT_CHARS + 64);
		assert.equal(live[1]!.toolCalls![0]!.result!.length, big.length);
	});
});

suite('researchJobs cap + asyncPool', () => {
	function job(id: string, status: ResearchJob['status'], worktreePath?: string): ResearchJob {
		return {
			id,
			status,
			subagent: 'explore',
			promptPreview: id,
			worktreePath
		};
	}

	test('pruneResearchJobs: выкидывает oldest terminal, active не трогает', () => {
		const jobs: ResearchJob[] = [job('run', 'running')];
		for (let i = 0; i < 5; i += 1) {
			jobs.push(job(`d${i}`, 'done'));
		}

		const pruned = pruneResearchJobs(jobs, 4);
		assert.equal(pruned.length, 4);
		assert.ok(pruned.some((j) => j.id === 'run'));
		assert.ok(!pruned.some((j) => j.id === 'd0' || j.id === 'd1'));
	});

	test('pruneResearchJobs: terminal с worktree живёт дольше', () => {
		const jobs = [job('wt', 'done', '/tmp/wt'), job('a', 'done'), job('b', 'done')];
		const pruned = pruneResearchJobs(jobs, 2);
		assert.deepEqual(pruned.map((j) => j.id), ['wt', 'b']);
	});

	test('upsertResearchJob: cap MAX_RESEARCH_JOBS', () => {
		let jobs: ResearchJob[] = [];
		for (let i = 0; i < MAX_RESEARCH_JOBS + 20; i += 1) {
			jobs = upsertResearchJob(jobs, {
				id: `j${i}`,
				status: 'done',
				promptPreview: 'p'
			});
		}

		assert.equal(jobs.length, MAX_RESEARCH_JOBS);
		assert.equal(jobs[jobs.length - 1]!.id, `j${MAX_RESEARCH_JOBS + 19}`);
	});

	test('mapLimit: порядок результатов и лимит параллелизма', async () => {
		let active = 0;
		let peak = 0;
		const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active -= 1;
			return n * 2;
		});
		assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
		assert.ok(peak <= 3 && peak >= 2);
	});

	test('mapLimit: ошибка останавливает выдачу новых задач', async () => {
		let started = 0;
		await assert.rejects(mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
			started += 1;
			if (n === 2) {
				throw new Error('boom');
			}

			await new Promise((r) => setTimeout(r, 5));
			return n;
		}), /boom/);
		assert.ok(started < 6);
	});
});
