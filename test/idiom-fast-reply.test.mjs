import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createIdiomGameTool } from '../plugin-src/host/idiom-game-tool.mjs';
import { installQqIdiomFastReplies } from '../plugin-src/host/channels/qq/idiom-fast-reply.mjs';
import { OutboundArtifactRegistry } from '../src/channels/shared/semantic/artifact.mjs';
const chooseQuestion = async () => ({ answer: '耳濡目染', pinyin: ['er3','ru2','mu4','ran3'], tier: 'normal', usage: { inputTokens: 0, outputTokens: 0 } });

test('ordinary game turns use the real referee without a model round trip', async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-fast-');
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = createIdiomGameTool({ stateDirectory }); t.after(() => game.close());
  const exec = id => ({ callId: id, agent: { session: { id: 'fast-group' } } });
  assert.equal(await game.fastReply('一心一意', exec('no-game')), null);
  const started = await game.fastReply('猜成语，3次', exec('start'), { chooseQuestion });
  assert.match(started.text, /3 次/);
  const resumed = await game.fastReply('猜成语', exec('resume'));
  assert.match(resumed.text, /本局还在进行/); assert.doesNotMatch(resumed.text, /restart/);
  const first = await game.fastReply('星罗棋布', exec('guess'));
  assert.equal(first.result.used, 1); assert.match(first.text, /字形：|字：/);
  assert.match(first.text, /1\/3/);
  assert.deepEqual(await game.fastReply('星罗棋布', exec('guess')), first, 'retry cannot consume another attempt');
  assert.equal(await game.fastReply('“一心一意”是个例子', exec('quote')), null);
  assert.equal(await game.fastReply('笃行不怠', exec('missing')), null, 'a missing idiom still goes to AI vocabulary review');
  const progress = await game.fastReply('猜成语进度', exec('status'));
  assert.match(progress.text, /1\/3/);
  assert.equal(await game.fastReply('猜成语，20次', exec('invalid-mode')), null);
  await game.definition.execute({ action: 'start', answer: '耳濡目染', restart: true, limit: 3 }, exec('fixed'));
  const won = await game.fastReply('耳濡目染', exec('win'), { chooseQuestion });
  assert.match(won.text, /猜中了！答案：耳濡目染/);
  assert.match(won.text, /局已开始/);
  assert.equal(won.result.nextRound.used, 0);
});

test('an unknown phrase resolves only its reading, then persists and scores; later guesses stay local', async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-auto-word-');
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = createIdiomGameTool({ stateDirectory }); t.after(() => game.close());
  const exec = id => ({ callId: id, agent: { session: { id: 'phrase-group' } } });
  await game.fastReply('猜成语，5次', exec('start'), { chooseQuestion });
  let calls = 0;
  const resolveReading = async word => { calls++; assert.equal(word, '原神启动'); return { pinyin: ['yuan2', 'shen2', 'qi3', 'dong4'], usage: { inputTokens: 60, outputTokens: 20 } }; };
  const first = await game.fastReply('原神启动', exec('new'), { resolveReading });
  assert.equal(first.result.used, 1); assert.match(first.text, /已.*词库/);
  assert.equal(calls, 1); assert.equal(first.usage.outputTokens, 20);
  const second = await game.fastReply('原神启动', exec('again'), { resolveReading });
  assert.equal(second.result.used, 2); assert.equal(calls, 1);
  const uncertain = await game.fastReply('一一得一', exec('uncertain'), { resolveReading: async () => ({ pinyin: null }) });
  assert.equal(uncertain.result.status, 'reading-unconfirmed'); assert.match(uncertain.text, /读音/);
  assert.equal((await game.definition.execute({ action: 'status' }, exec('state'))).used, 2);
});

test('failed next-question generation keeps the completed board and cannot invent the next secret', async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-next-failed-');
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = createIdiomGameTool({ stateDirectory, logger: { error() {} } }); t.after(() => game.close());
  const exec = id => ({ callId: id, agent: { session: { id: 's' } } });
  await game.fastReply('猜成语，3次', exec('start'), { chooseQuestion });
  const won = await game.fastReply('耳濡目染', exec('win'), { chooseQuestion: async () => { throw new Error('model unavailable'); } });
  assert.match(won.text, /答案：耳濡目染/); assert.match(won.text, /下一题暂未准备好/);
  assert.equal(won.result.nextRound, undefined);
  assert.equal((await game.definition.execute({ action: 'status' }, exec('check'))).active, false);
  const next = await game.fastReply('猜成语', exec('retry-question'), { chooseQuestion });
  assert.equal(next.result.round, 2); assert.equal(next.result.limit, 3);
});

async function streamFixture(t, text, { channel = 'qq', game: suppliedGame } = {}) {
  const stateDirectory = await mkdtemp('/tmp/idiom-stream-');
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = suppliedGame ?? createIdiomGameTool({ stateDirectory });
  t.after(() => game.close?.());
  const hooks = new Map();
  const registry = new OutboundArtifactRegistry();
  installQqIdiomFastReplies({ on: (name, fn) => hooks.set(name, fn), effect: () => {} }, game, { registry, chooseQuestion });
  const session = { id: 'one', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  const agent = { session };
  const close = registry.openConsumer('one', 'qq-message', { channel, idiomInput: text }); t.after(close);
  hooks.get('agent/inbox/claimed')({ agent, message: { source: { rpcId: 'qq-message' } }, turn: 1 });
  await hooks.get('agent/request')({ agent, step: 1 }, async () => ({}));
  let modelCalls = 0;
  const next = async function* () { modelCalls++; yield { type: 'text-delta', index: 0, text: 'MODEL' }; };
  const stream = async options => Array.fromAsync(hooks.get('llm/stream')({ sessionId: 'one', signal: new AbortController().signal, ...options }, next));
  return { game, hooks, registry, session, agent, stream, modelCalls: () => modelCalls };
}

test('the DSH stream seam bypasses the provider only for the exact claimed QQ game input', async t => {
  const f = await streamFixture(t, '猜成语，5次');
  const chunks = await f.stream();
  assert.equal(f.modelCalls(), 0);
  assert.match(chunks.find(row => row.type === 'text-delta').text, /5 次/);
  assert.deepEqual(chunks.find(row => row.type === 'usage').usage, { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(await f.stream(), chunks);
  await f.stream({ sessionId: 'other' }); assert.equal(f.modelCalls(), 1);
  await f.stream({ purpose: 'compaction' }); assert.equal(f.modelCalls(), 2);
});

test('ordinary chat, another channel and same-turn steering preserve the real model path', async t => {
  const chat = await streamFixture(t, '今天怎么样'); await chat.stream(); assert.equal(chat.modelCalls(), 1);
  const other = await streamFixture(t, '猜成语', { channel: 'telegram' }); await other.stream(); assert.equal(other.modelCalls(), 1);
  const steering = await streamFixture(t, '猜成语');
  steering.hooks.get('agent/inbox/claimed')({ agent: steering.agent, message: { source: { rpcId: 'another-message' } }, turn: 1 });
  await steering.stream(); assert.equal(steering.modelCalls(), 1);
});

test('local referee failure is terminal and never falls through to invent a model score', async t => {
  const f = await streamFixture(t, '猜成语', { game: { fastReply: async () => { throw new Error('local write failed'); } } });
  await assert.rejects(f.stream(), /local write failed/); assert.equal(f.modelCalls(), 0);
});
