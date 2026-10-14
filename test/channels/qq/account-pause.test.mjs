import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { deriveQqBotIdentity, QqConfigStore } from '../../../src/channels/qq/config-store.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import {
  DEFERRED_NOT_ATTEMPTED,
  createDeferredDeliveryCoordinator,
  deferredNotAttempted,
} from '../../../src/channels/shared/deferred-delivery-coordinator.mjs';
import { QQ_ENDPOINTS, createQqRpcHandler } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot } from '../../../plugin-src/client/channels/qq/api.js';

const MESSAGE_ID = 'pause-msg';

function stateFixture() {
  const sessions = new Map();
  const seen = new Set();
  return {
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => sessions.set(key, sessionId),
      clearSession: async (key) => sessions.delete(key),
    },
  };
}

function message(overrides = {}) {
  return {
    kind: 'c2c',
    rawEventType: 'C2C_MESSAGE_CREATE',
    senderId: 'owner-openid',
    senderIsBot: false,
    content: '/status',
    messageId: MESSAGE_ID,
    replyTarget: { scope: 'c2c', targetId: 'owner-openid', msgId: MESSAGE_ID },
    ...overrides,
  };
}

function controllerFixture() {
  const configs = [{
    botId: 'qq_bot',
    appId: '102345678',
    secretRef: 'DSH_QQBOT_APP_SECRET_000000000000000000000000',
    ownerUserOpenid: 'owner-openid',
    createdAt: '2026-08-15T00:00:00.000Z',
    connectedAt: '2026-08-15T00:00:00.000Z',
  }];
  const controller = new QqController({
    qrAuth: { start: () => () => {} },
    credentials: {
      resolve: async () => undefined,
      set: async () => {},
      unset: async () => {},
    },
    configStore: {
      list: () => [...configs],
      get: (id) => configs.find((value) => value.botId === id) ?? null,
      getByAppId: (id) => configs.find((value) => value.appId === id) ?? null,
      save: async (value) => {
        const index = configs.findIndex((entry) => entry.botId === value.botId);
        if (index === -1) configs.push(value);
        else configs[index] = value;
      },
      remove: async () => null,
    },
    createRuntime: async () => ({
      status: { ready: true, qqConnectionState: 'connected', harnessReachable: true },
      start: async () => {},
      stop: async () => {},
      setPaused: () => {},
      sendProactiveText: async () => {},
    }),
  });
  return { controller, configs };
}

test('QQ account pause persists only when explicitly enabled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-im-qq-pause-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  const identity = deriveQqBotIdentity('102345678');
  const store = await new QqConfigStore(path).load();
  await store.save({
    ...identity,
    appId: '102345678',
    ownerUserOpenid: 'owner-openid',
    createdAt: '2026-08-15T00:00:00.000Z',
  });

  // Default: the field is absent, so an existing document keeps its shape.
  assert.equal(store.get(identity.botId).paused, undefined);
  assert.doesNotMatch(await readFile(path, 'utf8'), /"paused"/);

  const pausedStore = await new QqConfigStore(path).load();
  await pausedStore.save({ ...pausedStore.get(identity.botId), paused: true });
  assert.equal((await new QqConfigStore(path).load()).get(identity.botId).paused, true);
  assert.match(await readFile(path, 'utf8'), /"paused":\s*true/);

  // Resuming deletes the field instead of persisting a false value.
  const resumedStore = await new QqConfigStore(path).load();
  await resumedStore.save({ ...resumedStore.get(identity.botId), paused: false });
  assert.equal((await new QqConfigStore(path).load()).get(identity.botId).paused, undefined);
  assert.doesNotMatch(await readFile(path, 'utf8'), /"paused"/);
});

test('QQ controller projects the pause state and resumes only when asked', async () => {
  const { controller, configs } = controllerFixture();
  assert.equal(controller.status().bots[0].paused, false);

  await controller.setPaused('qq_bot', true);
  assert.equal(configs[0].paused, true);
  assert.equal(controller.status().bots[0].paused, true);

  // Status reports stay redacted: no secret material is projected.
  assert.doesNotMatch(JSON.stringify(controller.status()), /DSH_QQBOT_APP_SECRET|102345678/);

  await controller.setPaused('qq_bot', false);
  assert.equal(configs[0].paused, undefined);
  assert.equal(controller.status().bots[0].paused, false);
});

test('QQ pause blocks proactive delivery while passive replies keep working', async () => {
  const { controller } = controllerFixture();
  await controller.setPaused('qq_bot', true);
  const paused = await controller.sendProactiveText('qq_bot', { scope: 'c2c', targetId: 'owner-openid' }, 'hello')
    .then(() => null, (error) => error);
  assert.equal(paused?.code, 'account-paused');

  // Unpaused the same call reaches the runtime gate instead, proving the pause
  // (not a missing runtime) is what blocked it above.
  await controller.setPaused('qq_bot', false);
  const unpaused = await controller.sendProactiveText('qq_bot', { scope: 'c2c', targetId: 'owner-openid' }, 'hello')
    .then(() => null, (error) => error);
  assert.equal(unpaused?.code, 'bot-not-connected');

  // L2 stays open: a paused bridge still answers a command in the conversation.
  const fixture = stateFixture();
  const sent = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async (_target, text) => sent.push(text) },
    ownerUserOpenid: '*',
    harness: { ensureRunning: async () => true },
    state: fixture.state,
    paused: true,
  });
  assert.equal(bridge.setPaused(true), true);
  await bridge.accept(message());
  assert.equal(sent.length, 1, 'a paused account must still answer passive messages');
  assert.match(sent[0], /连接/);
});

test('paused QQ deferred delivery stays pending without consuming an attempt', async () => {
  const entries = [{
    id: 'p2p:owner owner-openid 1',
    key: 'p2p:owner',
    sessionId: 'owner-openid',
    turn: 1,
    afterSeq: -1,
    status: 'pending',
    attempts: 0,
    target: { scope: 'c2c', targetId: 'owner-openid' },
  }];
  const patches = [];
  const state = {
    deferredEntries: async () => structuredClone(entries),
    putDeferred: async () => {},
    patchDeferred: async (id, patch) => {
      patches.push(patch);
      Object.assign(entries.find((entry) => entry.id === id) ?? {}, patch);
    },
    removeDeferred: async (id) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index >= 0) entries.splice(index, 1);
    },
    sessionFor: () => 'owner-openid',
  };
  const harness = {
    rpc: async () => ({
      hasMore: false,
      events: [
        { seq: 1, type: 'turn/start', data: { turn: 1 } },
        { seq: 2, type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: '答复' }] } } },
        { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
      ],
    }),
  };
  let deliverCalls = 0;
  const coordinator = createDeferredDeliveryCoordinator({
    harness,
    state,
    signal: new AbortController().signal,
    logger: { warn() {} },
    watch: false,
    pollDelayMs: 5,
    retryDelayMs: 5,
    finalAnswerOnly: true,
    deliver: () => {
      deliverCalls += 1;
      throw deferredNotAttempted('QQ account is paused');
    },
  });

  // The coordinator already drives one resume from its own startup; waiting for
  // idle is enough to observe the paused gate being reached.
  await coordinator.whenIdle();

  assert.ok(deliverCalls >= 1, 'the paused gate must be reached through the real coordinator path');
  assert.equal(entries.length, 1, 'a paused delivery must not be dropped');
  assert.equal(entries[0].status, 'pending');
  assert.equal(entries[0].attempts ?? 0, 0, 'a local gate must not consume an attempt');
  assert.equal(patches.some((patch) => patch.status === 'failed'), false);
  assert.equal(patches.some((patch) => patch.deliveryOutcome === 'unknown'), false);

  // The marker is deliberately not one of the existing failure outcomes.
  const marker = deferredNotAttempted('paused');
  assert.equal(marker.code, DEFERRED_NOT_ATTEMPTED);
  assert.notEqual(marker.deliveryOutcome, 'unknown');
});

test('QQ account-pause RPC validates the payload and returns a redacted snapshot', async () => {
  const seen = [];
  const handler = createQqRpcHandler({
    status: () => ({ bots: [{ botId: 'qq_bot', paused: true, connected: true }], totals: { configured: 1, connected: 1 } }),
    startProvisioning: async () => ({}),
    registrationStatus: () => null,
    cancelProvisioning: async () => ({}),
    bindCredentials: async () => ({}),
    reconnectBot: async () => ({}),
    deleteBot: async () => ({}),
    setPaused: async (botId, paused) => {
      seen.push({ botId, paused });
      return { bots: [{ botId, paused, connected: true }], totals: { configured: 1, connected: 1 } };
    },
  });

  const paused = await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: true });
  assert.equal(paused.ok, true);
  assert.deepEqual(seen, [{ botId: 'qq_bot', paused: true }]);
  assert.equal(paused.value.bots[0].paused, true);
  assert.doesNotMatch(JSON.stringify(paused), /secret|appSecret|openid/i);

  const resumed = await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: false });
  assert.equal(resumed.ok, true);
  assert.deepEqual(seen.at(-1), { botId: 'qq_bot', paused: false });

  assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot' })).ok, false);
  assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: 'yes' })).ok, false);
  assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: true, extra: 1 })).ok, false);
});

test('QQ client snapshots default the pause flag to off', () => {
  const snapshot = normalizeSnapshot({
    bots: [
      { botId: 'qq_bot', connected: true, state: 'connected' },
      { botId: 'qq_paused', connected: true, state: 'connected', paused: true },
    ],
  });
  assert.equal(snapshot.bots[0].paused, false);
  assert.equal(snapshot.bots[1].paused, true);
});
