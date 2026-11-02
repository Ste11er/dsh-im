import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { createAccessPolicy } from '../../../src/channels/shared/access-policy.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { BotWorkspaceStore, createWorkspaceAwareController } from '../../../src/channels/shared/bot-workspace-store.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { QQ_ENDPOINTS as clientEndpoints, normalizeSnapshot } from '../../../plugin-src/client/channels/qq/api.js';
import { EmptyMentionSetting } from '../../../plugin-src/client/channels/qq/index.js';

test('empty mention duration persists via production-style wrapped RPC, preserves other settings and applies live', async t => {
 const root = await mkdtemp(join(tmpdir(), 'qq-empty-mention-setting-')); t.after(() => rm(root, { recursive: true, force: true }));
 const file = join(root,'config.json'), configStore = await new QqConfigStore(file).load();
 const config = { ...deriveQqBotIdentity('empty-app'), appId: 'empty-app', ownerUserOpenid: 'owner', traceEnabled: true, createdAt: new Date().toISOString() };
 await configStore.save(config); const applied = []; let cancelled = 0;
 const controller = new QqController({ configStore, qrAuth: { start() {} },
  credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
  createRuntime: async () => ({ start: async () => {}, stop: async () => {}, status: { ready: true, qqConnectionState: 'connected', harnessReachable: true },
   setEmptyMentionWaitSeconds: seconds => applied.push(seconds), clearEmptyMentions: () => { cancelled++; } }) });
 t.after(() => controller.close()); await controller.initialize();
 const workspaces = await new BotWorkspaceStore(join(root,'workspaces.json'), { defaultWorkspace: root, ungroupedWorkspace: root }).load(); await workspaces.ensure(config.botId);
 const wrapped = createWorkspaceAwareController(controller, { workspaces, stateFor: async () => ({ clearSessions: async () => {} }), modelCatalog: async () => ({ groups: [] }),
  onAccessPolicyChanged: botId => controller.clearEmptyMentions(botId), onWorkspaceChanged: botId => controller.clearEmptyMentions(botId) });
 const rpc = createQqRpcHandler(wrapped);
 assert.equal(QQ_ENDPOINTS.setEmptyMention, clientEndpoints.setEmptyMention);
 assert.equal(normalizeSnapshot(controller.status()).bots[0].emptyMentionWaitSeconds, 30);
 for (const seconds of [null, true, '30', -1, 1, 120]) assert.equal((await rpc(QQ_ENDPOINTS.setEmptyMention, { botId: config.botId, seconds })).ok, false);
 assert.equal((await rpc(QQ_ENDPOINTS.setEmptyMention, { botId: config.botId })).ok, false);
 for (const seconds of [60, 0, 30]) {
  const result = await rpc(QQ_ENDPOINTS.setEmptyMention, { botId: config.botId, seconds }); assert.equal(result.ok, true);
  assert.equal(normalizeSnapshot(result.value).bots[0].emptyMentionWaitSeconds, seconds);
  assert.equal((await new QqConfigStore(file).load()).get(config.botId).emptyMentionWaitSeconds, seconds);
 }
 assert.deepEqual(applied, [60,0,30]); assert.equal(configStore.get(config.botId).traceEnabled, true);
 assert.equal(configStore.get(config.botId).groupMemoryEnabled, undefined);
 await controller.bindCredentials({ appId: config.appId, appSecret: 'secret' }); assert.equal(configStore.get(config.botId).emptyMentionWaitSeconds, 30);
 await wrapped.updateAccessPolicy(config.botId, createAccessPolicy()); assert.equal(cancelled, 1);
 await assert.rejects(wrapped.updateAccessPolicy(config.botId, createAccessPolicy(), () => { throw new Error('projection failure'); }), /projection failure/);
 assert.equal(cancelled, 1, 'failed policy update must not cancel waits');
 await wrapped.updateWorkspace(config.botId, root);
 assert.equal(cancelled, 2, 'workspace commit cancels pending wakes even when paths are restored later');
 await assert.rejects(configStore.save({ ...config, emptyMentionWaitSeconds: 2 }), /emptyMentionWaitSeconds/);
});

test('empty mention settings render configured duration and send exactly the selected option', async () => {
 let renderer; const chosen = [];
 act(() => { renderer = Renderer.create(React.createElement(EmptyMentionSetting, { seconds: 60, status: { pending: 1, merged: 2, expired: 3 }, onChange: value => chosen.push(value) })); });
 assert.equal(renderer.root.findByType('select').props.value, 60);
 act(() => renderer.root.findByType('select').props.onChange({ target: { value: '0' } }));
 assert.deepEqual(chosen,[0]);
 act(() => renderer.unmount());
});
