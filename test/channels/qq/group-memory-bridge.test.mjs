import assert from 'node:assert/strict';
import test from 'node:test';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { configuredAccessPolicy } from '../access-policy-fixture.mjs';

test('QQ archives eligible group text and injects long memory in the next mentioned prompt', async () => {
  const archived = [];
  const prompts = [];
  const sessions = new Map();
  const seen = new Set();
  const memory = {
    record: (key, message) => { archived.push({ key, message }); return { inserted: true, sequence: archived.length }; },
    capture: () => archived.length,
    status: { enabled: true },
    context: () => null,
    overview: (key, query, cutoff) => {
      assert.equal(key, 'group:a');
      assert.equal(query, '发布时间？');
      assert.equal(cutoff, 1);
      return '<long-memory>历史摘要：发布在周五</long-memory>';
    },
  };
  const bridge = new QqHarnessBridge({
    bot: { sendText: async () => {} }, ownerUserOpenid: '*',
    groupContextEnabled: true, groupMemory: memory,
    state: { hasSeen: (id) => seen.has(id), markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key), setSession: async (key, id) => { sessions.set(key, id); } },
    harness: { createSession: async () => 's', sessionExists: async () => true,
      ask: async (_id, text) => { prompts.push(text); return '周五'; } },
  });
  const message = { kind: 'group', groupOpenid: 'a', senderId: 'member',
    timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', messageId: 'one', content: '发布在周五',
    replyTarget: { scope: 'group', targetId: 'a' } };
  await bridge.accept(message);
  assert.equal(archived.length, 1);
  assert.equal(prompts.length, 0);
  await bridge.accept({ ...message, rawEventType: 'GROUP_AT_MESSAGE_CREATE', messageId: 'two', content: '发布时间？' });
  assert.equal(archived.length, 2);
  assert.match(JSON.stringify(prompts[0]), /历史摘要/);
});

test('QQ denies archive access before recording, and archive failure is explicit', async () => {
  const policy = configuredAccessPolicy({ channel: 'qq', config: { ownerUserOpenid: '*' } });
  let writes = 0;
  const bridge = new QqHarnessBridge({
    bot: { sendText: async () => assert.fail('must not send') }, ownerUserOpenid: '*',
    groupContextEnabled: true, accessPolicy: policy, logger: { error() {} },
    groupMemory: { capture: () => 0, record: () => { writes++; throw new Error('disk full'); } },
    harness: {}, state: { hasSeen: () => false },
  });
  const message = { kind: 'group', groupOpenid: 'a', senderId: 'member',
    timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', messageId: 'one', content: 'fact' };
  await bridge.accept(message);
  assert.equal(writes, 0);
  policy.getSettings().group.allowlist.users = [{ id: 'member', canExecuteCommands: false }];
  await assert.rejects(bridge.accept(message), /disk full/);
  assert.equal(bridge.status.groupMemoryError.code, 'archive-failed');
  assert.equal(bridge.status.groupContextRecorded, 0);
});
