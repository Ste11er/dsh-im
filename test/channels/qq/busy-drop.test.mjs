import assert from 'node:assert/strict';
import test from 'node:test';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
test('busy QQ group drops new prompts and attachments before downloading or asking, then accepts fresh messages after completion', async () => {
  let finish; let started; const entered = new Promise(resolve => { started = resolve; }); const blocked = new Promise(resolve => { finish = resolve; });
  const asks = []; const sent = []; const seen = new Set(); const sessions = new Map();
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    bot: { sendText: async (_target, text) => sent.push(text) }, fetchImpl: () => assert.fail('dropped attachments must not download'),
    harness: { createSession: async () => 's', sessionExists: async () => true, ask: async (_id, text) => { asks.push(text); if (asks.length === 1) { started(); await blocked; } return 'reply'; } } });
  const message = (id, content) => ({ messageId: id, senderId: 'owner', kind: 'group', groupOpenid: 'g', rawEventType: 'GROUP_AT_MESSAGE_CREATE', content, replyTarget: { scope: 'group', targetId: 'g', msgId: id } });
  const first = bridge.accept(message('one', 'first')); await entered;
  const late = { ...message('two', 'late'), attachments: [{ content_type: 'application/octet-stream', filename: 'a.bin', url: 'https://example.com/a.bin' }] };
  assert.deepEqual(await bridge.accept(late), { outcome: 'dropped', reason: 'busy' });
  await bridge.accept(late); assert.equal(seen.has('two'), true); assert.equal(asks.length, 1); assert.equal(sent.length, 0);
  finish(); await first; await bridge.accept(message('three', 'fresh'));
  assert.deepEqual(asks, ['first', 'fresh']); assert.equal(sent.some(text => text.includes('已排队')), false);
});
