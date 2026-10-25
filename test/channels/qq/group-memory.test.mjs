import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { QqGroupMemory, QQ_GROUP_MEMORY_LIMITS as limits } from '../../../src/channels/qq/group-memory.mjs';

const message = (id, content = '本次项目发布安排在周五') => ({ messageId: id, senderId: 'alice', content });
const result = (text) => ({ text, model: { provider: 'test', model: 'summary' }, usage: null });

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'qq-memory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = 0;
  const calls = [];
  const path = join(dir, 'memory.sqlite');
  const summarize = options.summarize ?? (async (input) => {
    calls.push(input);
    return result('项目发布安排在周五。测试代号是海风317。');
  });
  const memory = new QqGroupMemory({ path, summarize, watch: false, now: () => now });
  t.after(() => memory.close());
  return { memory, path, calls, advance: (ms) => { now += ms; }, summarize };
}

test('long memory is opt-in, archives complete text with deduplication and survives restart', async (t) => {
  const f = await fixture(t);
  await assert.rejects(stat(f.path), { code: 'ENOENT' });
  f.memory.setEnabled(true);
  const original = '原始正文'.repeat(300);
  assert.equal(f.memory.record('group:a', message('one', original)).inserted, true);
  assert.equal(f.memory.record('group:a', message('one', original)).inserted, false);
  assert.equal(f.memory.status.archived, 1);
  assert.equal(f.calls.length, 0);
  f.advance(limits.recentMs + 1);
  await f.memory.compact();
  assert.equal(f.calls[0].messages[0].content, original);
  assert.equal(f.memory.status.summaries, 1);
  assert.equal((await stat(f.path)).mode & 0o777, 0o600);
  await f.memory.close();
  const restored = new QqGroupMemory({ path: f.path, summarize: f.summarize, watch: false });
  t.after(() => restored.close());
  restored.setEnabled(true);
  assert.equal(restored.status.archived, 1);
  assert.equal(restored.status.summaries, 1);
  assert.match(restored.context('group:a', '发布时间'), /周五/);
  assert.equal(restored.context('group:b', '发布时间'), null);
});

test('summary failure never consumes raw messages or claims success; retry is bounded', async (t) => {
  let calls = 0;
  const f = await fixture(t, { summarize: async () => { calls++; throw new Error('provider unavailable'); } });
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('one'));
  f.advance(limits.recentMs + 1);
  for (let i = 0; i < limits.maxAttempts; i++) {
    await assert.rejects(f.memory.compact(), /provider unavailable/);
    f.advance(limits.summaryIntervalMs);
  }
  await f.memory.compact();
  assert.equal(calls, limits.maxAttempts);
  assert.equal(f.memory.status.archived, 1);
  assert.equal(f.memory.status.pending, 1);
  assert.equal(f.memory.status.summaries, 0);
  assert.equal(f.memory.status.lastError.code, 'summary-failed');
  assert.match(f.memory.context('group:a', '发布原话'), /周五/);
});

test('long memory retrieves relevant Chinese/English excerpts without loading all history', async (t) => {
  const f = await fixture(t);
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('code', '代号是海风317，原话不能改写。'));
  for (let i = 0; i < 70; i++) f.memory.record('group:a', message(`noise-${i}`, `其他话题 unrelated-${i}`));
  f.memory.record('group:b', message('secret', '海风317是另一个群的机密'));
  f.advance(limits.recentMs + 1);
  const prompt = f.memory.context('group:a', '海风317的原话是什么？');
  assert.match(prompt, /代号是海风317/);
  assert.doesNotMatch(prompt, /其他话题|另一个群/);
  assert.ok(Buffer.byteLength(prompt) <= limits.promptBytes);
});

test('memory snapshots exclude future messages and disabled memory is not injected', async (t) => {
  const f = await fixture(t);
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('before', '代号海风317'));
  const before = f.memory.capture();
  f.memory.record('group:a', message('after', '代号未来999'));
  f.advance(limits.recentMs + 1);
  const prompt = f.memory.context('group:a', '代号原文', before);
  assert.match(prompt, /海风317/);
  assert.doesNotMatch(prompt, /未来999/);
  f.memory.setEnabled(false);
  assert.equal(f.memory.context('group:a', '代号原文'), null);
  assert.equal(f.memory.status.archived, 2);
  f.memory.setEnabled(true);
  assert.match(f.memory.context('group:a', '代号原文'), /海风317/);
});

test('disabling aborts an in-flight summary and cannot commit late results', async (t) => {
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(t, { summarize: async ({ signal }) => {
    entered(signal);
    return new Promise((resolve) => { finish = resolve; });
  } });
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('one'));
  f.advance(limits.recentMs + 1);
  const work = f.memory.compact();
  const signal = await started;
  f.memory.setEnabled(false);
  assert.equal(signal.aborted, true);
  finish(result('late result'));
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(f.memory.status.summaries, 0);
  assert.equal(f.memory.status.pending, 1);
});

test('invalid or oversized summaries leave archives pending', async (t) => {
  const f = await fixture(t, { summarize: async () => result('x'.repeat(limits.summaryBytes + 1)) });
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('one'));
  f.advance(limits.recentMs + 1);
  await assert.rejects(f.memory.compact(), /summary/);
  assert.equal(f.memory.status.pending, 1);
});

test('manual compaction handles recent messages and does not consume arrivals during generation', async (t) => {
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(t, { summarize: async () => {
    entered(); return new Promise((resolve) => { finish = resolve; });
  } });
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('one'));
  assert.deepEqual(await f.memory.compact(), { created: 0 });
  const task = f.memory.compact({ force: true });
  assert.equal(f.memory.compact(), task);
  await started;
  f.memory.record('group:a', message('two', '新到消息'));
  finish(result('周五发布'));
  await task;
  assert.equal(f.memory.status.archived, 2);
  assert.equal(f.memory.status.pending, 1);
});

test('failed/cooling groups cannot starve another group that is due for summary', async (t) => {
  const f = await fixture(t);
  f.memory.setEnabled(true);
  for (let i = 0; i < 5; i++) f.memory.record(`group:${i}`, message(`one-${i}`));
  f.advance(limits.recentMs + 1);
  await f.memory.compact();
  assert.equal(f.memory.status.summaries, 4);
  await f.memory.compact();
  assert.equal(f.memory.status.summaries, 5);
  // New recent input in the four cooling groups must not prevent a later
  // group's expired input from being selected by the bounded worker.
  for (let i = 0; i < 4; i++) f.memory.record(`group:${i}`, message(`new-${i}`));
  f.memory.record('group:z', message('old-z'));
  f.advance(limits.recentMs + 1);
  await f.memory.compact();
  await f.memory.compact();
  assert.equal(f.memory.status.summaries, 10);
});

test('archive corruption is exposed and never replaced by an empty database', async (t) => {
  const f = await fixture(t);
  const original = Buffer.from('corrupt archive must not be silently reset');
  await writeFile(f.path, original);
  assert.throws(() => f.memory.setEnabled(true));
  assert.deepEqual(await readFile(f.path), original);
});

test('four failed groups do not permanently block a fifth healthy group', async (t) => {
  const f = await fixture(t, { summarize: async ({ messages }) => {
    if (messages[0].content === 'fail') throw new Error('bad group');
    return result('healthy group summary');
  } });
  f.memory.setEnabled(true);
  for (let i = 0; i < 4; i++) f.memory.record(`group:${i}`, message(`bad-${i}`, 'fail'));
  f.memory.record('group:healthy', message('good', 'healthy'));
  f.advance(limits.recentMs + 1);
  for (let i = 0; i < limits.maxAttempts * 4 + 2; i++) {
    try { await f.memory.compact(); } catch (error) { assert.equal(error.message, 'bad group'); }
    f.advance(limits.summaryIntervalMs);
  }
  assert.equal(f.memory.status.summaries, 1);
});

test('oversized originals fail summary explicitly but stay in the lossless archive', async (t) => {
  const f = await fixture(t);
  f.memory.setEnabled(true);
  f.memory.record('group:a', message('long', '原话'.repeat(limits.inputBytes)));
  f.advance(limits.recentMs + 1);
  await assert.rejects(f.memory.compact(), /byte budget/);
  assert.equal(f.memory.status.pending, 1);
  assert.equal(f.calls.length, 0);
  assert.match(f.memory.context('group:a', '原话'), /"truncated":true/);
});

test('archive transaction rolls back on indexing failure and does not claim a saved record', async (t) => {
  const f = await fixture(t);
  f.memory.setEnabled(true);
  const db = new DatabaseSync(f.path);
  db.exec('DROP TABLE message_search');
  db.close();
  assert.throws(() => f.memory.record('group:a', message('one')));
  assert.equal(f.memory.status.archived, 0);
  assert.equal(f.memory.status.lastError.code, 'archive-failed');
});

test('disabled and illegal archive writes fail; empty messages do not create records', async (t) => {
  const f = await fixture(t);
  assert.throws(() => f.memory.record('group:a', message('disabled')), /disabled/);
  assert.throws(() => f.memory.setEnabled('yes'), /boolean/);
  f.memory.setEnabled(true);
  assert.equal(f.memory.record('group:a', message('empty', '')).inserted, false);
  assert.equal(f.memory.context('group:a', ''), null);
  assert.throws(() => f.memory.record('group:a', message('huge', 'x'.repeat(limits.recordBytes + 1))), /byte budget/);
});

test('automatic summary timer runs due work and stops when disabled', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dir = await mkdtemp(join(tmpdir(), 'qq-memory-timer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = 0;
  let calls = 0;
  const memory = new QqGroupMemory({ path: join(dir, 'memory.sqlite'), now: () => now,
    summarize: async () => { calls++; return result('周五发布'); } });
  t.after(() => memory.close());
  memory.setEnabled(true);
  memory.record('group:a', message('one'));
  now = limits.recentMs + 1;
  t.mock.timers.tick(limits.pollMs);
  await memory.compact();
  assert.equal(calls, 1);
  memory.setEnabled(false);
  t.mock.timers.tick(limits.pollMs);
  assert.equal(calls, 1);
});

test('casual unrelated chatter injects no latest summary; relevant excerpts stay within the smaller byte budget', async t => {
  const f = await fixture(t, { summarize: async () => result('过去无关的背景。'.repeat(120) + '项目海风317发布定在周五。' + '另外的闲聊。'.repeat(100)) });
  f.memory.setEnabled(true); f.memory.record('group:a', message('a')); f.advance(limits.recentMs + 1); await f.memory.compact();
  assert.equal(f.memory.context('group:a', '哈哈你好呀'), null);
  const prompt = f.memory.context('group:a', '海风317发布时间');
  assert.match(prompt, /周五/); assert.doesNotMatch(prompt, /过去无关的背景/);
  assert.match(prompt, /"truncated":true/); assert.ok(Buffer.byteLength(prompt) <= 3072);
});

test('automatic memory overview is small and leaves original-detail retrieval to the scoped lookup', async t => {
  const f = await fixture(t); f.memory.setEnabled(true); f.memory.record('group:a', message('fact')); f.advance(limits.recentMs + 1); await f.memory.compact();
  const overview = f.memory.overview('group:a', '发布时间');
  assert.ok(Buffer.byteLength(overview) <= 1200); assert.match(overview, /dsh_qq_memory/);
  const chatter = f.memory.overview('group:a', '哈哈你好呀'); assert.doesNotMatch(chatter, /海风317|周五/);
  assert.match(f.memory.context('group:a', '海风317原话'), /海风317/);
});
