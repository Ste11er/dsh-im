// Independent mechanical verification for the QQ P0' slice (WG-QQ-01 + WG-QQ-03).
// Every check prints PASS/FAIL and the process exits non-zero on any failure.
// Run: node outputs/qq-impl/verify.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BotWorkspaceStore } from '../../src/channels/shared/bot-workspace-store.mjs';
import {
  createAccessPolicy,
  createAccessPolicyScope,
} from '../../src/channels/shared/access-policy.mjs';
import { evaluateInboundAccess } from '../../src/channels/shared/inbound-access.mjs';
import {
  accessPolicyProvider,
  initialAccessPolicyFor,
  newBotAccessPolicyFor,
  privilegedSenderIdsFor,
} from '../../plugin-src/host/channels/shared/access-policy-production.mjs';
import { deriveQqBotIdentity, QqConfigStore } from '../../src/channels/qq/config-store.mjs';
import { QqHarnessBridge } from '../../src/channels/qq/qq-bridge.mjs';
import { QqController } from '../../src/channels/qq/qq-controller.mjs';
import {
  DEFERRED_NOT_ATTEMPTED,
  createDeferredDeliveryCoordinator,
  deferredNotAttempted,
} from '../../src/channels/shared/deferred-delivery-coordinator.mjs';
import { QQ_ENDPOINTS, createQqRpcHandler } from '../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot } from '../../plugin-src/client/channels/qq/api.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error?.message ?? String(error)}`);
  }
}
async function acheck(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error?.message ?? String(error)}`);
  }
}

const openScope = () => createAccessPolicyScope({
  mode: 'open',
  open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
  allowlist: { users: [] },
});
const qqConfig = { ownerUserOpenid: 'owner-openid' };
const newPolicy = (legacy = false) => initialAccessPolicyFor('qq', qqConfig, { legacy });
const legacyPolicy = () => initialAccessPolicyFor('qq', qqConfig, { legacy: true });

async function withStore(document, fn, { missing = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qq-verify-'));
  const path = join(root, 'workspaces.json');
  try {
    if (!missing) await writeFile(path, JSON.stringify(document));
    const store = await new BotWorkspaceStore(path, {
      defaultWorkspace: root, ungroupedWorkspace: root,
    }).load();
    return await fn(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- B. policy

await acheck('B1 legacy v1 document backfills EVERY bot with the legacy (open) group default', async () => {
  await withStore({ version: 1, workspaces: {} }, async (store) => {
    const ids = ['qq_legacy_a', 'qq_legacy_b'];
    for (const botId of ids) {
      await store.ensure(botId, {
        initialAccessPolicy: newPolicy(),
        legacyInitialAccessPolicy: legacyPolicy(),
      });
    }
    for (const botId of ids) {
      const policy = store.accessPolicyFor(botId);
      assert.equal(policy?.group?.mode, 'open', `${botId} group must stay open`);
      // Legacy open scope keeps its historical command default (true).
      assert.equal(policy?.group?.open?.defaultCanExecuteCommands, true);
    }
  });
});

await acheck('B2 modern document seeds the tightened group default (allowlist, empty, no commands)', async () => {
  await withStore({ version: 2, workspaces: {}, accessPolicies: {} }, async (store) => {
    await store.ensure('qq_modern', {
      initialAccessPolicy: newPolicy(),
      legacyInitialAccessPolicy: legacyPolicy(),
    });
    const policy = store.accessPolicyFor('qq_modern');
    assert.equal(policy.group.mode, 'allowlist');
    assert.deepEqual(policy.group.allowlist.users, []);
    assert.equal(policy.group.open.defaultCanExecuteCommands, false);
    // The startup path has always seeded QQ direct as owner-allowlist; this
    // slice only tightens the group scope, so direct must stay unchanged.
    assert.equal(policy.direct.mode, 'allowlist');
  });
});

await acheck('B3 an already saved group=open policy is never rewritten', async () => {
  const saved = createAccessPolicy({ direct: openScope(), group: openScope() });
  await withStore({ version: 2, workspaces: {}, accessPolicies: { qq_saved: saved } }, async (store) => {
    await store.ensure('qq_saved', {
      initialAccessPolicy: newPolicy(),
      legacyInitialAccessPolicy: legacyPolicy(),
    });
    assert.deepEqual(store.accessPolicyFor('qq_saved'), saved);
    assert.equal(store.accessPolicyFor('qq_saved').group.mode, 'open');
  });
});

await acheck('B4 fresh install (no file) seeds the tightened group default', async () => {
  await withStore(null, async (store) => {
    await store.ensure('qq_fresh', {
      initialAccessPolicy: newPolicy(),
      legacyInitialAccessPolicy: legacyPolicy(),
    });
    assert.equal(store.accessPolicyFor('qq_fresh').group.mode, 'allowlist');
  }, { missing: true });
});

check('B5 feishu and other channels keep their previous defaults', () => {
  const feishuNew = newBotAccessPolicyFor('feishu', { ownerOpenIds: ['ou_owner'] });
  assert.equal(feishuNew.direct.mode, 'open');
  assert.equal(feishuNew.group.mode, 'open');
  const feishuInitial = initialAccessPolicyFor('feishu', { ownerOpenIds: ['ou_owner'] });
  assert.equal(feishuInitial.direct.mode, 'allowlist');
  assert.equal(feishuInitial.group.mode, 'allowlist');
  for (const channel of ['weixin', 'dingtalk', 'wecom', 'slack', 'discord', 'telegram', 'whatsapp']) {
    assert.deepEqual(newBotAccessPolicyFor(channel), initialAccessPolicyFor(channel), channel);
  }
  const qqNew = newBotAccessPolicyFor('qq', qqConfig);
  assert.equal(qqNew.direct.mode, 'open');
  assert.equal(qqNew.group.mode, 'allowlist');
});

await acheck('B6 owner bypass still applies to a closed QQ group', async () => {
  assert.deepEqual(privilegedSenderIdsFor('qq', qqConfig), ['owner-openid']);
  await withStore({ version: 2, workspaces: {}, accessPolicies: {} }, async (store) => {
    await store.ensure('qq_owner', { initialAccessPolicy: newPolicy() });
    const provider = accessPolicyProvider(store, 'qq_owner', { channel: 'qq', config: qqConfig });
    assert.deepEqual(
      evaluateInboundAccess(provider, { conversationType: 'group', senderIds: 'owner-openid', text: 'hi' }),
      { allowed: true, reason: 'privileged-sender' },
    );
    const other = evaluateInboundAccess(provider, { conversationType: 'group', senderIds: 'someone-else', text: 'hi' });
    assert.equal(other.allowed, false);
    assert.equal(other.reason, 'sender-not-allowed');
  });
});

// ----------------------------------------------------------------- C. pause

await acheck('C1 pause persists only when explicitly enabled and resumes by deleting the field', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qq-pause-verify-'));
  try {
    const path = join(root, 'config.json');
    const identity = deriveQqBotIdentity('102345678');
    const store = await new QqConfigStore(path).load();
    await store.save({
      ...identity, appId: '102345678', ownerUserOpenid: 'owner-openid',
      createdAt: '2026-08-15T00:00:00.000Z',
    });
    assert.equal(store.get(identity.botId).paused, undefined);
    await store.save({ ...store.get(identity.botId), paused: true });
    assert.equal((await new QqConfigStore(path).load()).get(identity.botId).paused, true);
    const reloaded = await new QqConfigStore(path).load();
    await reloaded.save({ ...reloaded.get(identity.botId), paused: false });
    assert.equal((await new QqConfigStore(path).load()).get(identity.botId).paused, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await acheck('C2 a paused bridge still answers passive messages (L2 is not gated)', async () => {
  const sessions = new Map();
  const seen = new Set();
  const sent = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async (_target, text) => sent.push(text) },
    ownerUserOpenid: '*',
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, value) => sessions.set(key, value),
      clearSession: async (key) => sessions.delete(key),
    },
    harness: { ensureRunning: async () => true },
    paused: true,
  });
  assert.equal(bridge.setPaused(true), true);
  await bridge.accept({
    kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', senderId: 'owner-openid',
    senderIsBot: false, content: '/status', messageId: 'verify-pause-1',
    replyTarget: { scope: 'c2c', targetId: 'owner-openid', msgId: 'verify-pause-1' },
  });
  assert.equal(sent.length, 1, 'passive reply must still be sent while paused');
});

function controllerFixture() {
  const configs = [{
    botId: 'qq_bot', appId: '102345678',
    secretRef: 'DSH_QQBOT_APP_SECRET_000000000000000000000000',
    ownerUserOpenid: 'owner-openid',
    createdAt: '2026-08-15T00:00:00.000Z', connectedAt: '2026-08-15T00:00:00.000Z',
  }];
  const controller = new QqController({
    qrAuth: { start: () => () => {} },
    credentials: { resolve: async () => undefined, set: async () => {}, unset: async () => {} },
    configStore: {
      list: () => [...configs],
      get: (id) => configs.find((value) => value.botId === id) ?? null,
      getByAppId: (id) => configs.find((value) => value.appId === id) ?? null,
      save: async (value) => {
        const index = configs.findIndex((entry) => entry.botId === value.botId);
        if (index === -1) configs.push(value); else configs[index] = value;
      },
      remove: async () => null,
    },
    createRuntime: async () => ({
      status: { ready: true }, start: async () => {}, stop: async () => {},
      setPaused: () => {}, sendProactiveText: async () => {},
    }),
  });
  return { controller, configs };
}

await acheck('C3 pause blocks L3 proactive delivery but not for a missing runtime', async () => {
  const { controller, configs } = controllerFixture();
  await controller.setPaused('qq_bot', true);
  assert.equal(configs[0].paused, true);
  assert.equal(controller.status().bots[0].paused, true);
  const paused = await controller.sendProactiveText('qq_bot', { scope: 'c2c', targetId: 'owner-openid' }, 'hi')
    .then(() => null, (error) => error);
  assert.equal(paused?.code, 'account-paused');
  await controller.setPaused('qq_bot', false);
  const unpaused = await controller.sendProactiveText('qq_bot', { scope: 'c2c', targetId: 'owner-openid' }, 'hi')
    .then(() => null, (error) => error);
  assert.equal(unpaused?.code, 'bot-not-connected', 'the pause (not the runtime) must be what blocked L3');
});

await acheck('C4 paused deferred delivery stays pending without consuming an attempt', async () => {
  const entries = [{
    id: 'p2p:owner owner-openid 1', key: 'p2p:owner', sessionId: 'owner-openid',
    turn: 1, afterSeq: -1, status: 'pending', attempts: 0,
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
  let deliverCalls = 0;
  const coordinator = createDeferredDeliveryCoordinator({
    harness: {
      rpc: async () => ({
        hasMore: false,
        events: [
          { seq: 1, type: 'turn/start', data: { turn: 1 } },
          { seq: 2, type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'done' }] } } },
          { seq: 3, type: 'turn/end', data: { turn: 1, reason: 'completed' } },
        ],
      }),
    },
    state,
    signal: new AbortController().signal,
    logger: { warn() {} },
    watch: false,
    pollDelayMs: 5,
    retryDelayMs: 5,
    finalAnswerOnly: true,
    deliver: () => { deliverCalls += 1; throw deferredNotAttempted('paused'); },
  });
  await coordinator.whenIdle();
  assert.ok(deliverCalls >= 1, 'the paused gate must be reached');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'pending');
  assert.equal(entries[0].attempts ?? 0, 0);
  assert.equal(patches.some((patch) => patch.status === 'failed'), false);
  assert.equal(patches.some((patch) => patch.deliveryOutcome === 'unknown'), false);
  assert.equal(deferredNotAttempted('paused').code, DEFERRED_NOT_ATTEMPTED);
});

await acheck('C5 account-pause RPC validates payload and returns a redacted snapshot', async () => {
  const seen = [];
  const handler = createQqRpcHandler({
    status: () => ({ bots: [], totals: { configured: 0, connected: 0 } }),
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
  assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: true })).ok, true);
  assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: false })).ok, true);
  assert.deepEqual(seen, [{ botId: 'qq_bot', paused: true }, { botId: 'qq_bot', paused: false }]);
  for (const bad of [{ botId: 'qq_bot' }, { botId: 'qq_bot', paused: 'yes' }, { botId: 'qq_bot', paused: true, x: 1 }]) {
    assert.equal((await handler(QQ_ENDPOINTS.setAccountPause, bad)).ok, false, JSON.stringify(bad));
  }
  assert.doesNotMatch(JSON.stringify(await handler(QQ_ENDPOINTS.setAccountPause, { botId: 'qq_bot', paused: true })), /secret|openid/i);
});

check('C6 client snapshot defaults the pause flag to off', () => {
  const snapshot = normalizeSnapshot({
    bots: [
      { botId: 'qq_bot', connected: true, state: 'connected' },
      { botId: 'qq_paused', connected: true, state: 'connected', paused: true },
    ],
  });
  assert.equal(snapshot.bots[0].paused, false);
  assert.equal(snapshot.bots[1].paused, true);
});

const failed = results.filter((row) => !row.ok);
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
if (failed.length > 0) process.exitCode = 1;
