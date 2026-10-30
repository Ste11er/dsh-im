import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqFamiliarity, qqFamiliarityEnabled } from '../../../src/channels/qq/familiarity.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
import { installQqFamiliarityContext } from '../../../plugin-src/host/channels/qq/familiarity-context.mjs';
import { qqFamiliarityText } from '../../../src/channels/qq/familiarity-context.mjs';
import { QqGroupMemory } from '../../../src/channels/qq/group-memory.mjs';

const message = (id, extra = {}) => ({ kind: 'group', groupOpenid: 'group-one', senderId: 'member-one',
  senderName: '群友', messageId: id, content: '大肥鱼，你认识我吗', timestamp: new Date().toISOString(),
  rawEventType: 'GROUP_AT_MESSAGE_CREATE', replyTarget: { scope: 'group', targetId: 'group-one', msgId: id }, ...extra });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'qq-familiarity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'familiarity.sqlite');
}

test('familiarity is opt-in, counts Shanghai days rather than message volume and survives restart', async t => {
  const path = await fixture(t); let now = Date.parse('2026-10-29T15:59:00Z');
  const store = new QqFamiliarity({ path, now: () => now }); t.after(() => store.close());
  assert.equal(qqFamiliarityEnabled(), false);
  for (const value of [null, 0, 'true', {}]) assert.throws(() => qqFamiliarityEnabled(value));
  store.observe(message('off'), true); assert.equal(store.context(message('off')), null);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  store.setEnabled(true); store.observe(message('first'), false);
  const first = store.context(message('first'));
  for (let i = 0; i < 100; i++) store.observe(message(`same-day-${i}`), false);
  assert.deepEqual(store.context(message('last')), first, 'same-day volume cannot increase familiarity');
  store.observe(message('mention'), true); store.observe(message('mention'), true);
  assert.equal(store.context(message('last')).addressedDays, 1);
  now += 120_000; store.observe(message('new-day'), true);
  assert.equal(store.context(message('last')).activeDays, 2);
  assert.equal(store.context(message('last')).addressedDays, 2);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const before = store.context(message('last')); store.close();
  const reopened = new QqFamiliarity({ path, now: () => now }); t.after(() => reopened.close());
  reopened.setEnabled(true); assert.deepEqual(reopened.context(message('last')), before);
  reopened.setEnabled(false); now += 86_400_000; reopened.observe(message('disabled'), true);
  assert.equal(reopened.context(message('disabled')), null);
  assert.equal(reopened.list().items[0].activeDays, 2);
});

test('familiarity separates peers and direct identity, can clear one person and remembers old contacts', async t => {
  const path = await fixture(t); let now = Date.parse('2026-01-01T04:00:00Z');
  const store = new QqFamiliarity({ path, now: () => now }); t.after(() => store.close()); store.setEnabled(true);
  for (let i = 0; i < 45; i++) { store.observe(message(`day-${i}`), true); if (i < 44) now += 86_400_000; }
  assert.equal(store.context(message('known')).stage, '熟悉');
  assert.equal(store.context(message('other', { groupOpenid: 'other-group' })), null);
  store.observe(message('other', { groupOpenid: 'other-group' }), true);
  store.observe(message('direct', { kind: 'c2c' }), true);
  assert.equal(store.list().items.length, 3);
  const known = store.list().items.find(row => row.activeDays === 45);
  now += 120 * 86_400_000;
  const older = store.context(message('return'));
  assert.ok(older.score < known.score && older.score > 0);
  assert.equal(older.activeDays, 45);
  assert.equal(store.clear(known.id).removed, true);
  assert.equal(store.clear(known.id).removed, false);
  assert.equal(store.context(message('cleared')), null);
  assert.equal(store.list().items.length, 2);
  store.observe(message('start-again'), true);
  assert.equal(store.context(message('start-again')).activeDays, 1);
  assert.throws(() => store.clear('member-one'));
});

test('invalid local archives are reported, never silently reset to first acquaintance', async t => {
  const path = await fixture(t); await writeFile(path, 'not a sqlite archive');
  const store = new QqFamiliarity({ path }); t.after(() => store.close());
  assert.throws(() => store.setEnabled(true));
  assert.equal(store.status.lastError.code, 'familiarity-unavailable');
  assert.equal(store.status.members, null);
});

test('familiarity context belongs to the actual QQ Turn and cannot become instructions or grant authority', () => {
  const registry = new OutboundArtifactRegistry(); let section;
  installQqFamiliarityContext({ systemPrompt: { context: value => { section = value; } } }, { registry });
  const session = { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  const state = { stage: '眼熟', score: 45, activeDays: 8, addressedDays: 7 };
  assert.equal(section.text({ agent: { session } }), '');
  for (const channel of ['qq', 'telegram']) {
    const close = registry.openConsumer('s', 'rpc', { channel, familiarity: state });
    registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
    const result = section.text({ agent: { session } });
    if (channel === 'qq') { assert.match(result, /眼熟/); assert.match(result, /不代表好感或权限/); assert.ok(Buffer.byteLength(result) < 512); }
    else assert.equal(result, '');
    close(); assert.equal(section.text({ agent: { session } }), '');
  }
});

test('actual bridge supplies sender-specific familiarity for mentions and autonomous replies in the same group Session', async t => {
  const path = await fixture(t); const store = new QqFamiliarity({ path }); store.setEnabled(true); t.after(() => store.close());
  const sessions = new Map(), seen = new Set(), prompts = [];
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', familiarity: store, groupContextEnabled: true,
    groupParticipation: { enabled: true, cooldownSeconds: 1 },
    participationReply: options => options.reply(),
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    harness: { createSession: async () => 'same-group-session', sessionExists: async () => true,
      ask: async (id, text, options) => { prompts.push({ id, context: options.deliveryContext }); return '我记得你'; } },
    bot: { sendText: async () => ({ message: { id: 'sent' } }) },
  });
  await bridge.accept(message('mention'));
  await bridge.accept(message('ambient', { rawEventType: 'GROUP_MESSAGE_CREATE', senderId: 'member-two' }));
  await bridge.waitForIdle();
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].id, prompts[1].id);
  assert.equal(prompts[0].context.familiarity.addressedDays, 1);
  assert.equal(prompts[1].context.familiarity.addressedDays, 0);
  assert.equal(prompts[1].context.autonomous, true);
  assert.equal(store.list().items.length, 2);
  store.setEnabled(false);
  await bridge.accept(message('off'));
  assert.equal(Object.hasOwn(prompts[2].context, 'familiarity'), false);
});

test('familiarity and the real memory overview share the existing 1200-byte budget without losing detail lookup', async t => {
  const path = await fixture(t); let now = 0;
  const memory = new QqGroupMemory({ path, now: () => now, watch: false,
    summarize: async () => ({ text: '鲸鱼项目周五发布。'.repeat(180), model: { provider: 'test', model: 'summary' }, usage: null }) });
  t.after(() => memory.close()); memory.setEnabled(true);
  memory.record('group:g', { messageId: 'one', senderId: 'member', content: '鲸鱼项目周五发布。' });
  now += 16 * 60_000; await memory.compact();
  const relationship = qqFamiliarityText({ stage: '眼熟', score: 45, activeDays: 8, addressedDays: 8 });
  const overview = memory.overview('group:g', '鲸鱼项目', Number.MAX_SAFE_INTEGER, { maxBytes: 1200 - Buffer.byteLength(relationship) });
  assert.ok(Buffer.byteLength(relationship + overview) <= 1200);
  assert.match(overview, /周五/); assert.match(overview, /dsh_qq_memory/);
  assert.match(memory.context('group:g', '鲸鱼项目'), /周五/);
  assert.throws(() => memory.overview('group:g', '鲸鱼', undefined, { maxBytes: 1 }), /reference metadata/);
});
