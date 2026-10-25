import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot, QQ_ENDPOINTS as CLIENT_ENDPOINTS } from '../../../plugin-src/client/channels/qq/api.js';
import * as UI from '../../../plugin-src/client/channels/qq/index.js';

test('long memory settings persist, reject invalid values and apply through the real RPC controller', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'qq-memory-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  const store = await new QqConfigStore(path).load();
  const config = { ...deriveQqBotIdentity('app'), appId: 'app', ownerUserOpenid: '*', groupContextEnabled: true };
  await store.save(config);
  for (const value of [null, 'yes', 1, []]) {
    await assert.rejects(store.save({ ...config, groupMemoryEnabled: value }), /groupMemoryEnabled/);
  }
  const toggles = [];
  let compactions = 0;
  let finishSummary;
  const summaryPending = new Promise((resolve) => { finishSummary = resolve; });
  t.after(() => finishSummary({ created: 1 }));
  const controller = new QqController({
    qrAuth: { start() {} }, configStore: store,
    credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
    createRuntime: async () => ({
      start: async () => {}, stop: async () => {},
      status: { ready: true, qqConnectionState: 'connected', harnessReachable: true,
        groupMemory: { enabled: true, archived: 40, summaries: 2, pending: 0, lastError: null } },
      setGroupMemoryEnabled: (enabled) => toggles.push(enabled),
      compactGroupMemory: () => { compactions++; return summaryPending; },
    }),
  });
  t.after(() => controller.close());
  await controller.initialize();
  const rpc = createQqRpcHandler(controller);
  assert.equal(CLIENT_ENDPOINTS.setGroupMemory, 'bot.group-memory.set');
  const enabled = await rpc(QQ_ENDPOINTS.setGroupMemory, { botId: config.botId, enabled: true });
  assert.equal(enabled.ok, true);
  assert.equal((await new QqConfigStore(path).load()).get(config.botId).groupMemoryEnabled, true);
  assert.deepEqual(toggles, [true]);
  assert.equal(normalizeSnapshot(enabled.value).bots[0].groupMemory.archived, 40);
  const request = rpc(QQ_ENDPOINTS.compactGroupMemory, { botId: config.botId });
  let acknowledged = false;
  void request.then(() => { acknowledged = true; });
  await new Promise(setImmediate);
  assert.equal(acknowledged, true, 'manual summary acknowledges before the model finishes');
  const compacted = await request;
  assert.equal(compacted.ok, true);
  assert.equal(compactions, 1);
  await rpc(QQ_ENDPOINTS.setGroupMemory, { botId: config.botId, enabled: false });
  assert.equal(store.get(config.botId).groupMemoryEnabled, undefined);
  assert.deepEqual(toggles, [true, false], 'an unfinished summary does not hold the account transition lock');
});

test('long memory panel makes persistence/model calls explicit and submits controlled settings', () => {
  let view;
  const values = [];
  act(() => { view = TestRenderer.create(React.createElement(UI.GroupMemoryToggle, {
    enabled: false, contextEnabled: true, disabled: false,
    onChange: (enabled) => values.push(enabled), onCompact() {},
    status: { archived: 40, summaries: 2, pending: 0, lastError: { code: 'summary-failed' } },
  })); });
  const input = view.root.findByType('input');
  assert.equal(input.props.checked, false);
  act(() => input.props.onChange({ target: { checked: true } }));
  assert.deepEqual(values, [true]);
  assert.match(JSON.stringify(view.toJSON()), /本地|摘要|模型/);
  act(() => view.update(React.createElement(UI.GroupMemoryToggle, { enabled: false, contextEnabled: false })));
  assert.equal(view.root.findByType('input').props.disabled, true);
  act(() => view.unmount());
});
