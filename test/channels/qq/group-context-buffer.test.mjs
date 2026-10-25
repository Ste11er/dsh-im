import assert from 'node:assert/strict';
import test from 'node:test';
import { QqGroupContext, QQ_GROUP_CONTEXT_LIMITS as limits } from '../../../src/channels/qq/group-context.mjs';
import { isQqGroupContextMessage } from '../../../src/channels/qq/qq-mention.mjs';

const row = (messageId, content = 'text') => ({ messageId, senderId: 'member', content });
const rendered = (buffer, key, now) => buffer.prepend(buffer.snapshot(key, now), 'question', now);

test('WG-QQ-11 limits message count and characters with visible truncation', () => {
  const buffer = new QqGroupContext();
  for (let i = 0; i <= limits.messages; i++) buffer.record('g', row(`m-${i}`, `message-${i}`), 0);
  const text = rendered(buffer, 'g', 1);
  assert.doesNotMatch(text, /"message-0"/);
  assert.equal(text.match(/"senderId"/g).length, limits.messages);
  buffer.record('g', row('long', 'x'.repeat(1000)), 1);
  const long = rendered(buffer, 'g', 2);
  assert.match(long, /"truncated":true/);
  assert.ok(long.includes('x'.repeat(limits.messageCharacters)));
  assert.ok(!long.includes('x'.repeat(limits.messageCharacters + 1)));
});

test('WG-QQ-11 TTL applies both to memory reads and to queued mention snapshots', () => {
  const buffer = new QqGroupContext();
  buffer.record('g', row('one', 'stale'), 0);
  const snapshot = buffer.snapshot('g', 1);
  assert.match(buffer.prepend(snapshot, 'question', limits.ttlMs - 1), /stale/);
  assert.equal(buffer.prepend(snapshot, 'question', limits.ttlMs), 'question');
  assert.equal(buffer.snapshot('g', limits.ttlMs), null);
});

test('WG-QQ-11 bounds account group memory, deduplicates and rejects empty text', () => {
  const buffer = new QqGroupContext();
  assert.equal(buffer.record('first', row('a', 'first'), 0), true);
  assert.equal(buffer.record('first', row('a', 'duplicate'), 0), false);
  assert.equal(buffer.record('empty', row('empty', ''), 0), false);
  for (let i = 0; i < limits.groups; i++) buffer.record(`g-${i}`, row(`id-${i}`), 0);
  assert.equal(buffer.snapshot('first', 0), null);
  assert.match(rendered(buffer, `g-${limits.groups - 1}`, 0), /member/);
});

test('WG-QQ-11 disabling invalidates already queued snapshots and preserves image blocks', () => {
  const buffer = new QqGroupContext();
  buffer.record('g', row('one'), 0);
  const snapshot = buffer.snapshot('g', 0);
  const original = [{ type: 'image', image: 'unchanged' }, { type: 'text', text: 'question' }];
  const enhanced = buffer.prepend(snapshot, original, 1);
  assert.deepEqual(enhanced.slice(1), original);
  buffer.clear();
  assert.equal(buffer.prepend(snapshot, original, 1), original);
});

test('WG-QQ-11 context eligibility never changes the addressed decision', () => {
  const message = { kind: 'group', rawEventType: 'GROUP_MESSAGE_CREATE' };
  assert.equal(isQqGroupContextMessage(message), false);
  assert.equal(isQqGroupContextMessage(message, true), true);
  assert.equal(isQqGroupContextMessage({ ...message, mentions: [{ is_you: true }] }, true), false);
  assert.equal(isQqGroupContextMessage({ ...message, kind: 'c2c' }, true), false);
  assert.equal(isQqGroupContextMessage({ ...message, rawEventType: 'UNKNOWN' }, true), false);
});

test('QQ context image references expire and clear together with their text snapshot', () => {
  const buffer = new QqGroupContext();
  const source = { load: () => assert.fail('the context buffer must not download images') };
  assert.equal(buffer.record('g', { ...row('picture', ''), images: [source] }, 0), true);
  const snapshot = buffer.snapshot('g', 1);
  assert.equal(snapshot.hasImages, true);
  const current = buffer.prepare(snapshot, 'question', { now: 2, maxImages: 1 });
  assert.deepEqual(current.images, [source]);
  assert.match(current.content[0].text, /"imageIndexes":\[1\]/);
  assert.deepEqual(buffer.prepare(snapshot, 'question', { now: limits.ttlMs, maxImages: 1 }), { content: 'question', images: [] });
  buffer.clear();
  assert.deepEqual(buffer.prepare(snapshot, 'question', { now: 2, maxImages: 1 }), { content: 'question', images: [] });
});

test('QQ context image mapping respects the existing serialized text budget', () => {
  const buffer = new QqGroupContext();
  for (let i = 0; i < 30; i++) buffer.record('g', { ...row(`picture-${i}`, '中'.repeat(512)),
    images: Array.from({ length: 20 }, () => ({ load() {} })) }, i);
  const prepared = buffer.prepare(buffer.snapshot('g', 31), 'question', { now: 31, maxImages: 20, imageOffset: 1 });
  assert.equal(prepared.images.length, 20);
  assert.ok(Buffer.byteLength(prepared.content[0].text) <= limits.promptBytes);
  assert.match(prepared.content[0].text, /"imageIndexes":\[2,3,4/);
});

test('trusted bot replies retain assistant identity while incoming group data cannot claim that role', () => {
  const buffer = new QqGroupContext();
  buffer.record('g', { ...row('question', '你叫什么'), role: 'assistant' }, 0);
  buffer.recordReply('g', { messageId: 'question', content: '我叫大肥鱼' }, 1);
  const text = rendered(buffer, 'g', 2);
  const rows = JSON.parse(text.split('\n')[2]);
  assert.equal(rows[0].role, undefined); assert.equal(rows[1].role, 'assistant');
  assert.equal(rows[1].text, '我叫大肥鱼');
  assert.equal(buffer.snapshot('other', 2), null);
  assert.equal(buffer.snapshot('g', limits.ttlMs + 1), null);
});
