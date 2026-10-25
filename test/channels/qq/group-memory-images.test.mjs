import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { QqGroupMemory } from '../../../src/channels/qq/group-memory.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { imageInputLimits } from '../../../src/channels/shared/image-input-policy.mjs';

async function fixture(t, describeImages) {
  const root = await mkdtemp(join(tmpdir(), 'qq-image-memory-'));
  const path = join(root, 'memory.sqlite');
  const summarize = async ({ messages }) => ({ text: messages.map(m => m.content).join('\n'), model: { provider: 'p', model: 'm' }, usage: null });
  const memory = new QqGroupMemory({ path, watch: false, describeImages, summarize });
  t.after(async () => { await memory.close(); await rm(root, { recursive: true, force: true }); });
  return { memory, path, summarize };
}
const message = (id = 'picture', content = '') => ({ messageId: id, senderId: 'member', content });
const result = { text: '图片显示：红色折线图，周五销量为 317。', model: { provider: 'p', model: 'vision' }, usage: { inputTokens: 10 } };

test('image descriptions and captions persist together and enter long summary and retrieval', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return result; });
  await assert.rejects(f.memory.recordImages('group:a', message(), [{}]), /disabled/);
  f.memory.setEnabled(true);
  await f.memory.recordImages('group:a', message('pic', '销售报表'), [{}]);
  await f.memory.recordImages('group:a', message('pic', '销售报表'), [{}]);
  assert.equal(calls, 1);
  assert.equal(f.memory.status.archived, 1);
  assert.match(f.memory.context('group:a', '销量原文'), /317/);
  await f.memory.compact({ force: true });
  assert.equal(f.memory.status.summaries, 1);
  await f.memory.close();
  f.memory.setEnabled(true);
  assert.match(f.memory.context('group:a', '销量'), /销售报表|317/);
});

test('failed vision keeps caption and reports failure; disabled vision never commits late results', async t => {
  let finish;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, async ({ text }) => {
    if (text === 'caption') throw Error('vision unavailable');
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  f.memory.setEnabled(true);
  await assert.rejects(f.memory.recordImages('group:a', message('failure', 'caption'), [{}]), /vision unavailable/);
  assert.equal(f.memory.status.archived, 1);
  assert.equal(f.memory.status.lastError.code, 'image-summary-failed');
  const pending = f.memory.recordImages('group:a', message('late'), [{}]);
  await entered;
  f.memory.setEnabled(false);
  finish(result);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.memory.status.archived, 1);
});

test('QQ background image recognition archives text without replying and the next question can retrieve it', async t => {
  let calls = 0;
  const f = await fixture(t, async ({ images }) => { assert.equal(images.length, 1); calls++; return result; });
  f.memory.setEnabled(true);
  const prompts = []; const recalls = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async () => {} }, ownerUserOpenid: '*', groupContextEnabled: true, groupMemory: f.memory,
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: () => 'session', setSession: async () => {} },
    harness: { sessionExists: async () => true, getImageInputLimits: async () => imageInputLimits(),
      ask: async (_id, content, options) => { prompts.push(content); recalls.push(options.deliveryContext.memoryLookup('销量原文')); return '317'; } },
  });
  const incoming = { kind: 'group', groupOpenid: 'a', senderId: 'member', messageId: 'image',
    timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', content: '', attachments: [{ content_type: 'image/png', url: 'https://qpic.cn/test.png' }],
    replyTarget: { scope: 'group', targetId: 'a' } };
  await bridge.accept(incoming);
  await f.memory.recordImages('group:a', message('image'), [{}]);
  assert.equal(calls, 1);
  assert.equal(prompts.length, 0);
  assert.equal(f.memory.status.archived, 1);
  await bridge.accept({ ...incoming, messageId: 'question', content: '销量原文', attachments: [], rawEventType: 'GROUP_AT_MESSAGE_CREATE' });
  assert.doesNotMatch(JSON.stringify(prompts[0]), /317/);
  assert.match(JSON.stringify(prompts[0]), /dsh_qq_memory/);
  assert.match(recalls[0], /317/);
  assert.match(recalls[0], /Agent/);
});
