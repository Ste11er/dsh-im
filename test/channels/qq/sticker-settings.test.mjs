import { qqPersona } from '../../../src/channels/qq/persona.mjs';
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
  const root = await mkdtemp(join(tmpdir(), 'qq-sticker-settings-'));
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

test('QQ stickers config defaults off, persists explicit enable and rejects illegal values', async (t) => {
  const { store, config, path } = await configFixture(t);
  assert.equal(store.get(config.botId).stickersEnabled, undefined);
  await store.save({ ...config, stickersEnabled: true });
  const loaded = await new QqConfigStore(path).load();
  assert.equal(loaded.get(config.botId).stickersEnabled, true);
  for (const value of [null, 'true', 1, {}, []]) {
    await assert.rejects(store.save({ ...config, stickersEnabled: value }), /stickersEnabled/);
  }
  await store.save({ ...config, stickersEnabled: false });
  assert.doesNotMatch(await readFile(path, 'utf8'), /stickersEnabled/);
});

test('QQ stickers RPC persists and applies the independent switch to a running bot', async (t) => {
  const { store, config } = await configFixture(t);
  const live = [];
  const controller = new QqController({
    qrAuth: { start: () => () => {} }, configStore: store,
    credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
    createRuntime: async () => ({
      status: { ready: true, qqConnectionState: 'connected', harnessReachable: true,
        groupContextRecorded: 7, groupContextRejected: 2 },
      start: async () => {}, stop: async () => {},
      setStickersEnabled: (value) => live.push(value),
    }),
  });
  t.after(() => controller.close());
  await controller.initialize();
  const rpc = createQqRpcHandler(controller);
  assert.equal(QQ_ENDPOINTS.setStickers, 'bot.stickers.set');
  assert.equal(CLIENT_ENDPOINTS.setStickers, QQ_ENDPOINTS.setStickers);
  assert.equal(normalizeSnapshot(controller.status()).bots[0].stickersEnabled, false);
  for (const value of [null, 'true', 1, {}, []]) {
    const result = await rpc(QQ_ENDPOINTS.setStickers, { botId: config.botId, enabled: value });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad-request');
  }
  const result = await rpc(QQ_ENDPOINTS.setStickers, { botId: config.botId, enabled: true });
  assert.equal(result.ok, true);
  assert.equal(store.get(config.botId).stickersEnabled, true);
  const bot = normalizeSnapshot(result.value).bots[0];
  assert.equal(bot.stickersEnabled, true);
  assert.deepEqual(bot.groupContextStats, { recorded: 7, rejected: 2 });
  assert.deepEqual(live, [true]);
  await rpc(QQ_ENDPOINTS.setStickers, { botId: config.botId, enabled: false });
  assert.deepEqual(live, [true, false]);
  assert.equal(store.get(config.botId).stickersEnabled, undefined);
});

test('QQ stickers credential rebind preserves the explicit context decision', async (t) => {
  const { store, config } = await configFixture(t);
  await store.save({ ...config, stickersEnabled: true });
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
  assert.equal(store.get(config.botId).stickersEnabled, true);
  assert.equal(starts[0].stickersEnabled, true);
});

test('QQ stickers runtime seeds and applies the switch without restarting', async (t) => {
  class Bot extends EventEmitter {
    use() {}
    async sendText() {}
    async start(signal) {
      queueMicrotask(() => this.emit('ready', {}));
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    }
    stop() {}
  }
  const bot = new Bot();
  const requests = [];
  const sessions = new Map();
  const runtime = new QqRuntime({
    config: { botId: 'qq_test', appId: 'app', ownerUserOpenid: '*', stickersEnabled: true },
    appSecret: 'secret', harness: { ensureRunning: async () => true,
      createSession: async () => 'session', sessionExists: async () => true,
      ask: async (_id, _text, options) => { requests.push(options.deliveryContext); return 'ok'; } },
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: key => sessions.get(key),
      setSession: async (key, id) => sessions.set(key, id) }, createBot: () => bot,
    typingMiddleware: () => async (_ctx, next) => next(),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const emit = async (messageId, kind = 'group', rawEventType = 'GROUP_AT_MESSAGE_CREATE') => {
    bot.emit('message', {}, { kind, groupOpenid: 'g', rawEventType, senderId: 'member', messageId, content: 'hi',
      replyTarget: { scope: kind, targetId: 'g', msgId: messageId } });
    for (let n = 0; n < 30; n++) await new Promise(resolve => setImmediate(resolve));
  };
  await emit('ambient', 'group', 'GROUP_MESSAGE_CREATE');
  assert.equal(requests.length, 0, 'stickers must not enable unmentioned replies');
  await emit('one');
  const { qqCapabilities, ...delivery } = requests[0];
  assert.equal(qqCapabilities.groupParticipationImplemented, true);
  assert.equal(qqCapabilities.groupParticipationEnabled, false);
  assert.deepEqual(delivery, { persona: qqPersona(), channel: 'qq', conversationType: 'group', computerCommandAuthorized: false, stickersEnabled: true, idiomInput: 'hi' });
  runtime.setStickersEnabled(false);
  await emit('two');
  assert.equal(requests[1].stickersEnabled, false);
  runtime.setStickersEnabled(true);
  await emit('three', 'c2c', 'C2C_MESSAGE_CREATE');
  assert.equal(requests[2].conversationType, 'direct');
});

test('QQ stickers panel switch is controlled, reports limits, and sends a boolean', () => {
  const changes = [];
  let renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(QqUI.StickersToggle, {
    enabled: false, disabled: false, stats: { recorded: 3, rejected: 1 },
    onChange: (enabled) => changes.push(enabled),
  })); });
  const input = renderer.root.findByType('input');
  assert.equal(input.props.checked, false);
  act(() => input.props.onChange({ target: { checked: true } }));
  assert.deepEqual(changes, [true]);
  assert.match(JSON.stringify(renderer.toJSON()), /不启用长期记忆/);
  act(() => renderer.update(React.createElement(QqUI.StickersToggle, { enabled: true, disabled: true })));
  assert.equal(renderer.root.findByType('input').props.checked, true);
  assert.equal(renderer.root.findByType('input').props.disabled, true);
  act(() => renderer.unmount());
});
