import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { deriveQqBotIdentity, QqConfigStore } from '../../../src/channels/qq/config-store.mjs';
import { QqStateStore } from '../../../src/channels/qq/state-store.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { evaluateDeferredOutbound } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqRuntime, evaluateProactiveOutbound } from '../../../src/channels/qq/qq-runtime.mjs';
import { QQ_ENDPOINTS, createQqRpcHandler } from '../../../plugin-src/host/channels/qq/rpc.mjs';

const HARNESS = {
  ensureRunning: async () => true,
  currentWorkspace: () => process.cwd(),
  currentConversationWorkspace: () => process.cwd(),
  assertWorkspaceScope: () => {},
};
const CONFIG = {
  botId: 'qq_send_control', appId: '102345678', ownerUserOpenid: '*',
  createdAt: '2026-08-15T00:00:00.000Z', connectedAt: null,
};

const quietAllDay = { quietHours: { enabled: true, start: '00:00', end: '23:59' } };

function fakeBot() {
  const handlers = new Map();
  const sent = [];
  const bot = {
    use() { return bot; },
    on(event, handler) { handlers.set(event, handler); return bot; },
    async start() { queueMicrotask(() => handlers.get('ready')?.()); },
    stop() {},
    sendText: async (target, text) => { sent.push({ target, text }); return { sent: true }; },
  };
  return { bot, sent };
}

async function withRuntime(sendControl, fn) {
  const root = await mkdtemp(join(tmpdir(), 'qq-send-control-'));
  const { bot, sent } = fakeBot();
  const state = await new QqStateStore(join(root, 'state.json'), {
    logger: { warn() {}, error() {}, info() {}, debug() {} },
  }).load();
  const runtime = new QqRuntime({
    config: { ...CONFIG, ...(sendControl ? { sendControl } : {}) },
    appSecret: 'secret',
    harness: HARNESS,
    state,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    connectTimeoutMs: 200,
    createBot: () => bot,
  });
  try {
    await runtime.start();
    await fn({ runtime, state, sent, bot });
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
}

test('proactive L3 decision counts real segments and honours all gates', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  assert.equal(evaluateProactiveOutbound({ sendControl: {}, usage: { events: [] }, text: 'hi', now }).action, 'allow');
  const long = 'x'.repeat(9_000);   // above the 4,500-character chunk limit
  const markdown = evaluateProactiveOutbound({
    sendControl: {}, usage: { events: [] }, text: long, format: 'markdown', now,
  });
  assert.ok(markdown.segments > 1, 'a long markdown reply counts as several segments');
  const plain = evaluateProactiveOutbound({ sendControl: {}, usage: { events: [] }, text: long, now });
  assert.equal(plain.segments, 1, 'plain sendText is one platform message');

  assert.equal(evaluateProactiveOutbound({
    sendControl: { dryRun: { enabled: true } }, usage: { events: [] }, text: 'hi', now,
  }).action, 'dry-run');
  assert.equal(evaluateProactiveOutbound({
    sendControl: { quietHours: { enabled: true, start: '00:00', end: '23:59' } },
    usage: { events: [] }, text: 'hi', now,
  }).action, 'defer-quiet');
});

test('deferred L4 decision uses the same gate order and segment counting', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  assert.equal(evaluateDeferredOutbound({ sendControl: {}, usage: { events: [] }, text: 'ok', now }).action, 'allow');
  assert.equal(evaluateDeferredOutbound({
    sendControl: { dryRun: { enabled: true } }, usage: { events: [] }, text: 'ok', now,
  }).action, 'dry-run');
  assert.equal(evaluateDeferredOutbound({
    sendControl: { budget: { enabled: true, windowMs: 60_000, limit: 1 } },
    usage: { events: [{ at: now - 1_000, segments: 1 }] }, text: 'ok', now,
  }).action, 'deny-budget');
  assert.equal(evaluateDeferredOutbound({
    sendControl: quietAllDay, usage: { events: [] }, text: 'ok', now,
  }).action, 'defer-quiet');
});

test('defaults-off configuration keeps proactive sending unchanged', async () => {
  await withRuntime(null, async ({ runtime, sent, state }) => {
    await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'hello');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'hello');
    assert.equal(runtime.dryRunCandidates().length, 0);
    assert.deepEqual(state.sendControlUsage(), { events: [] }, 'no usage written while the budget is off');
  });
});

test('dry-run suppresses proactive sending but records a candidate', async () => {
  await withRuntime({ dryRun: { enabled: true } }, async ({ runtime, sent, state }) => {
    const error = await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'hello')
      .then(() => null, (cause) => cause);
    assert.equal(error?.code, 'send-dry-run');
    assert.equal(sent.length, 0);
    assert.equal(runtime.dryRunCandidates().length, 1);
    assert.deepEqual(state.sendControlUsage(), { events: [] });
  });
});

test('budget rejects the over-limit segment and persists window usage', async () => {
  await withRuntime({ budget: { enabled: true, windowMs: 600_000, limit: 1 } }, async ({ runtime, sent, state }) => {
    await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'first');
    assert.equal(sent.length, 1);
    assert.equal(state.sendControlUsage().events.length, 1, 'usage is persisted for the window');
    const error = await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'second')
      .then(() => null, (cause) => cause);
    assert.equal(error?.code, 'send-budget-exhausted');
    assert.equal(sent.length, 1, 'over-budget sends are not queued');
  });
});

test('quiet hours defer proactive sending and queue it without sending', async () => {
  await withRuntime(quietAllDay, async ({ runtime, sent }) => {
    const error = await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'later')
      .then(() => null, (cause) => cause);
    assert.equal(error?.code, 'send-deferred-quiet');
    assert.equal(sent.length, 0);
  });
});

test('live setSendControl applies immediately and unblocks the next send', async () => {
  await withRuntime({ dryRun: { enabled: true } }, async ({ runtime, sent }) => {
    const blocked = await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'a')
      .then(() => null, (cause) => cause);
    assert.equal(blocked?.code, 'send-dry-run');
    const next = runtime.setSendControl({ dryRun: { enabled: false } });
    assert.equal(next.dryRun.enabled, false);
    await runtime.sendProactiveText({ kind: 'user', route: { userOpenId: 'u1' } }, 'b');
    assert.equal(sent.length, 1);
  });
});

test('QQ config store persists sendControl and only when explicitly set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-send-config-'));
  try {
    const path = join(root, 'config.json');
    const identity = deriveQqBotIdentity('102345678');
    const store = await new QqConfigStore(path).load();
    await store.save({
      ...identity, appId: '102345678', ownerUserOpenid: 'owner',
      createdAt: '2026-08-15T00:00:00.000Z',
    });
    assert.equal(store.get(identity.botId).sendControl, undefined);
    const config = {
      budget: { enabled: true, windowMs: 60_000, limit: 5 },
      quietHours: { enabled: true, start: '23:00', end: '08:00', timezone: 'Asia/Shanghai' },
      dryRun: { enabled: true },
    };
    await store.save({ ...store.get(identity.botId), sendControl: config });
    const reloaded = (await new QqConfigStore(path).load()).get(identity.botId);
    assert.deepEqual(reloaded.sendControl, config);
    assert.match(await readFile(path, 'utf8'), /"sendControl"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('QQ controller persists sendControl and projects it in status', async () => {
  const configs = [{
    ...CONFIG, botId: 'qq_bot', paused: undefined,
  }];
  const controller = new QqController({
    qrAuth: { start: () => () => {} },
    credentials: { resolve: async () => undefined, set: async () => {}, unset: async () => {} },
    configStore: {
      list: () => [...configs],
      get: (id) => configs.find((value) => value.botId === id) ?? null,
      getByAppId: () => null,
      save: async (value) => {
        const index = configs.findIndex((entry) => entry.botId === value.botId);
        if (index === -1) configs.push(value); else configs[index] = value;
      },
      remove: async () => null,
    },
    createRuntime: async () => ({ status: { ready: true }, start: async () => {}, stop: async () => {} }),
  });
  assert.equal(controller.status().bots[0].sendControl.dryRun.enabled, false);
  await controller.setSendControl('qq_bot', { dryRun: { enabled: true } });
  assert.equal(configs[0].sendControl.dryRun.enabled, true);
  assert.equal(controller.status().bots[0].sendControl.dryRun.enabled, true);
});

test('send-control RPC validates the payload and dispatches to the controller', async () => {
  const seen = [];
  const handler = createQqRpcHandler({
    status: () => ({ bots: [], totals: { configured: 0, connected: 0 } }),
    startProvisioning: async () => ({}),
    registrationStatus: () => null,
    cancelProvisioning: async () => ({}),
    bindCredentials: async () => ({}),
    reconnectBot: async () => ({}),
    deleteBot: async () => ({}),
    setSendControl: async (botId, value) => {
      seen.push({ botId, value });
      return { bots: [{ botId, sendControl: value }], totals: { configured: 1, connected: 1 } };
    },
  });
  const ok = await handler(QQ_ENDPOINTS.setSendControl, { botId: 'qq_bot', sendControl: { dryRun: { enabled: true } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(seen, [{ botId: 'qq_bot', value: { dryRun: { enabled: true } } }]);
  for (const bad of [
    { botId: 'qq_bot' },
    { botId: 'qq_bot', sendControl: 'nope' },
    { botId: 'qq_bot', sendControl: {} , extra: 1 },
  ]) {
    assert.equal((await handler(QQ_ENDPOINTS.setSendControl, bad)).ok, false, JSON.stringify(bad));
  }
});
