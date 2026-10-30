import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { QqFamiliarity } from '../../../src/channels/qq/familiarity.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot, QQ_ENDPOINTS as clientEndpoints } from '../../../plugin-src/client/channels/qq/api.js';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { configuredAccessPolicy } from '../access-policy-fixture.mjs';

test('familiarity management persists the switch, lists only opaque identities, clears and preserves settings on rebind', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-familiarity-settings-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'config.json'); const store = await new QqConfigStore(configPath).load();
  const config = { ...deriveQqBotIdentity('familiarity-app'), appId: 'familiarity-app', ownerUserOpenid: '*', createdAt: '2026-10-29T00:00:00Z', stickersEnabled: true };
  await store.save(config); let local;
  const controller = new QqController({ configStore: store, qrAuth: { start: () => () => {} },
    credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
    createRuntime: async ({ config }) => {
      local = new QqFamiliarity({ path: join(directory, 'familiarity.sqlite') });
      return { get status() { return { ready: true, qqConnectionState: 'connected', harnessReachable: true, familiarity: local.status }; },
        start: async () => local.setEnabled(config.familiarityEnabled ?? false), stop: async () => local.close(),
        prepareFamiliarity: () => local.prepare(), setFamiliarityEnabled: value => local.setEnabled(value),
        listFamiliarity: options => local.list(options), clearFamiliarity: id => local.clear(id) };
    } });
  t.after(() => controller.close()); await controller.initialize();
  const rpc = createQqRpcHandler(controller);
  for (const key of ['setFamiliarity', 'listFamiliarity', 'clearFamiliarity']) assert.equal(QQ_ENDPOINTS[key], clientEndpoints[key]);
  for (const enabled of [null, 1, 'true']) assert.equal((await rpc(QQ_ENDPOINTS.setFamiliarity, { botId: config.botId, enabled })).ok, false);
  for (const offset of [-1, 1.2, '0']) assert.equal((await rpc(QQ_ENDPOINTS.listFamiliarity, { botId: config.botId, offset })).ok, false);
  assert.equal((await rpc(QQ_ENDPOINTS.clearFamiliarity, { botId: config.botId, id: '*' })).ok, false);
  assert.equal(normalizeSnapshot(controller.status()).bots[0].familiarityEnabled, false);
  const enabled = await rpc(QQ_ENDPOINTS.setFamiliarity, { botId: config.botId, enabled: true }); assert.equal(enabled.ok, true);
  assert.equal(normalizeSnapshot(enabled.value).bots[0].familiarityEnabled, true);
  assert.equal((await new QqConfigStore(configPath).load()).get(config.botId).familiarityEnabled, true);
  assert.equal(store.get(config.botId).groupMemoryEnabled, undefined);
  local.observe({ kind: 'group', groupOpenid: 'private-group-1234', senderId: 'private-sender-5678', senderName: '群友' }, true);
  const list = await rpc(QQ_ENDPOINTS.listFamiliarity, { botId: config.botId, offset: 0 }); assert.equal(list.ok, true);
  assert.equal(list.value.items.length, 1); assert.match(list.value.items[0].id, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(list), /private-group|private-sender|secret/);
  const deleted = await rpc(QQ_ENDPOINTS.clearFamiliarity, { botId: config.botId, id: list.value.items[0].id });
  assert.deepEqual(deleted, { ok: true, value: { removed: true } });
  assert.equal(local.status.members, 0);
  await controller.bindCredentials({ appId: config.appId, appSecret: 'new-secret' });
  assert.equal(store.get(config.botId).familiarityEnabled, true);
  assert.equal(local.status.enabled, true);
  const disabled = await rpc(QQ_ENDPOINTS.setFamiliarity, { botId: config.botId, enabled: false }); assert.equal(disabled.ok, true);
  assert.equal(store.get(config.botId).familiarityEnabled, undefined);
  assert.equal(store.get(config.botId).stickersEnabled, true);
});

test('denied members and bot messages never enter familiarity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-familiarity-denied-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const familiarity = new QqFamiliarity({ path: join(directory, 'familiarity.sqlite') }); familiarity.setEnabled(true); t.after(() => familiarity.close());
  const accessPolicy = configuredAccessPolicy({ channel: 'qq', config: { ownerUserOpenid: '*' } });
  const seen = new Set();
  const bridge = new QqHarnessBridge({ familiarity, ownerUserOpenid: '*', accessPolicy, groupContextEnabled: true,
    bot: { sendText: async () => {} }, harness: {}, state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id) } });
  const message = { kind: 'group', groupOpenid: 'g', senderId: 'denied', content: 'hello', messageId: '1', timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE' };
  await bridge.accept(message); await bridge.accept({ ...message, messageId: '2', rawEventType: 'GROUP_AT_MESSAGE_CREATE' });
  await bridge.accept({ ...message, messageId: '3', senderIsBot: true });
  assert.equal(familiarity.status.members, 0);
});

test('familiarity editor uses real endpoint callbacks, keeps errors visible and requires confirmation before clearing', async () => {
  const React = await import('react'); const { default: Renderer, act } = await import('react-test-renderer');
  const { FamiliarityEditor } = await import('../../../plugin-src/client/channels/qq/familiarity-editor.js');
  let renderer; let failRead = false; const changed = [], cleared = [], offsets = [];
  const record = { id: 'a'.repeat(64), label: '群 …1234 / 群友 …5678', stage: '刚认识', score: 15, activeDays: 1, addressedDays: 1 };
  act(() => { renderer = Renderer.create(React.createElement(FamiliarityEditor, { enabled: false,
    onChange: async enabled => changed.push(enabled),
    onList: async offset => { if (failRead) throw new Error('熟识度读取失败'); offsets.push(offset); return { items: cleared.length ? [] : [record], nextOffset: null }; },
    onClear: async id => { cleared.push(id); } })); });
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === text);
  await act(async () => { await renderer.root.findByType('select').props.onChange({ target: { value: 'on' } }); });
  assert.deepEqual(changed, [true]);
  await act(async () => { await button('查看／刷新熟识度').props.onClick(); });
  act(() => button('清除此人').props.onClick()); assert.deepEqual(cleared, []);
  await act(async () => { await button('确认清除').props.onClick(); });
  assert.deepEqual(cleared, [record.id]); assert.deepEqual(offsets, [0, 0]);
  failRead = true;
  await act(async () => { await button('查看／刷新熟识度').props.onClick(); });
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), '熟识度读取失败');
  act(() => renderer.unmount());
});
