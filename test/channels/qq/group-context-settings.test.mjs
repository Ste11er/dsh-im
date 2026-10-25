import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { QQ_ENDPOINTS as CLIENT_ENDPOINTS, normalizeSnapshot } from '../../../plugin-src/client/channels/qq/api.js';
import * as QqUI from '../../../plugin-src/client/channels/qq/index.js';

async function configFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'qq-group-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  const store = await new QqConfigStore(path).load();
  const config = {
    ...deriveQqBotIdentity('test-app'), appId: 'test-app',
    ownerUserOpenid: '*', createdAt: '2026-10-23T00:00:00.000Z',
  };
  await store.save(config);
  return { store, config, path };
}

test('WG-QQ-11 config defaults off, persists explicit enable and rejects illegal values', async (t) => {
  const { store, config, path } = await configFixture(t);
  assert.equal(store.get(config.botId).groupContextEnabled, undefined);
  await store.save({ ...config, groupContextEnabled: true });
  const loaded = await new QqConfigStore(path).load();
  assert.equal(loaded.get(config.botId).groupContextEnabled, true);
  for (const value of [null, 'true', 1, {}, []]) {
    await assert.rejects(store.save({ ...config, groupContextEnabled: value }), /groupContextEnabled/);
  }
  await store.save({ ...config, groupContextEnabled: false });
  assert.doesNotMatch(await readFile(path, 'utf8'), /groupContextEnabled/);
});

test('WG-QQ-11 RPC persists and applies the independent switch to a running bot', async (t) => {
  const { store, config } = await configFixture(t);
  const live = [];
  const controller = new QqController({
    qrAuth: { start: () => () => {} }, configStore: store,
    credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
    createRuntime: async () => ({
      status: { ready: true, qqConnectionState: 'connected', harnessReachable: true,
        groupContextRecorded: 7, groupContextRejected: 2 },
      start: async () => {}, stop: async () => {},
      setGroupContextEnabled: (value) => live.push(value),
    }),
  });
  t.after(() => controller.close());
  await controller.initialize();
  const rpc = createQqRpcHandler(controller);
  assert.equal(QQ_ENDPOINTS.setGroupContext, 'bot.group-context.set');
  assert.equal(CLIENT_ENDPOINTS.setGroupContext, QQ_ENDPOINTS.setGroupContext);
  assert.equal(normalizeSnapshot(controller.status()).bots[0].groupContextEnabled, false);
  for (const value of [null, 'true', 1, {}, []]) {
    const result = await rpc(QQ_ENDPOINTS.setGroupContext, { botId: config.botId, enabled: value });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad-request');
  }
  const result = await rpc(QQ_ENDPOINTS.setGroupContext, { botId: config.botId, enabled: true });
  assert.equal(result.ok, true);
  assert.equal(store.get(config.botId).groupContextEnabled, true);
  const bot = normalizeSnapshot(result.value).bots[0];
  assert.equal(bot.groupContextEnabled, true);
  assert.deepEqual(bot.groupContextStats, { recorded: 7, rejected: 2 });
  assert.deepEqual(live, [true]);
  await rpc(QQ_ENDPOINTS.setGroupContext, { botId: config.botId, enabled: false });
  assert.deepEqual(live, [true, false]);
  assert.equal(store.get(config.botId).groupContextEnabled, undefined);
});

test('WG-QQ-11 credential rebind preserves the explicit context decision', async (t) => {
  const { store, config } = await configFixture(t);
  await store.save({ ...config, groupContextEnabled: true });
  const starts = [];
  const controller = new QqController({
    qrAuth: { start: () => () => {} }, configStore: store,
    credentials: { resolve: async () => ({ value: 'old' }), set: async () => {}, unset: async () => {} },
    createRuntime: async ({ config: next }) => {
      starts.push(next);
      return { start: async () => {}, stop: async () => {} };
    },
  });
  t.after(() => controller.close());
  await controller.bindCredentials({ appId: config.appId, appSecret: 'new' });
  assert.equal(store.get(config.botId).groupContextEnabled, true);
  assert.equal(starts[0].groupContextEnabled, true);
});

test('WG-QQ-11 runtime seeds the switch and applies changes without restarting', async (t) => {
  class Bot extends EventEmitter {
    use() {}
    async sendText() { assert.fail('ambient runtime event must not send'); }
    async start(signal) {
      queueMicrotask(() => this.emit('ready', {}));
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    }
    stop() {}
  }
  const bot = new Bot();
  const runtime = new QqRuntime({
    config: { botId: 'qq_test', appId: 'app', ownerUserOpenid: '*', groupContextEnabled: true },
    appSecret: 'secret', harness: { ensureRunning: async () => true },
    state: { hasSeen: () => false }, createBot: () => bot,
    typingMiddleware: () => async (_ctx, next) => next(),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const emit = (messageId) => bot.emit('message', {}, {
    kind: 'group', groupOpenid: 'g', timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE',
    senderId: 'member', messageId, content: 'background',
  });
  emit('one');
  assert.equal(runtime.status.groupContextRecorded, 1);
  runtime.setGroupContextEnabled(false);
  emit('two');
  assert.equal(runtime.status.groupContextRecorded, 1);
  runtime.setGroupContextEnabled(true);
  emit('three');
  assert.equal(runtime.status.groupContextRecorded, 2);
});

test('WG-QQ-11 panel switch is controlled, reports limits, and sends a boolean', () => {
  const changes = [];
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(QqUI.GroupContextToggle, {
    enabled: false, disabled: false, stats: { recorded: 3, rejected: 1 },
    onChange: (enabled) => changes.push(enabled),
  })); });
  const input = renderer.root.findByType('input');
  assert.equal(input.props.checked, false);
  act(() => input.props.onChange({ target: { checked: true } }));
  assert.deepEqual(changes, [true]);
  assert.match(JSON.stringify(renderer.toJSON()), /15 分钟/);
  act(() => renderer.update(React.createElement(QqUI.GroupContextToggle, { enabled: true, disabled: true })));
  assert.equal(renderer.root.findByType('input').props.checked, true);
  assert.equal(renderer.root.findByType('input').props.disabled, true);
  act(() => renderer.unmount());
});
