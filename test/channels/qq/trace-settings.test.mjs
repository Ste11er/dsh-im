import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { BotWorkspaceStore, createWorkspaceAwareController } from '../../../src/channels/shared/bot-workspace-store.mjs';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { qqTraceEvent } from '../../../src/channels/qq/message-trace.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot, QQ_ENDPOINTS as clientEndpoints } from '../../../plugin-src/client/channels/qq/api.js';
import { TracePanel } from '../../../plugin-src/client/channels/qq/trace-panel.js';

test('trace RPC validates contracts, persists opt-in, survives bot reconnect and exports without secrets', async t => {
 const path = await mkdtemp(join(tmpdir(), 'qq-trace-settings-')); t.after(() => rm(path, { recursive: true, force: true }));
 const configPath = join(path, 'config.json'), configStore = await new QqConfigStore(configPath).load();
 const config = { ...deriveQqBotIdentity('trace-app'), appId: 'trace-app', ownerUserOpenid: 'secret-owner', createdAt: new Date().toISOString() };
 await configStore.save(config);
 let traces;
 const controller = new QqController({ configStore, qrAuth: { start() {} }, credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
  createRuntime: async options => { traces = options.traces; return { start: async () => {}, stop: async () => {}, status: { ready: true, qqConnectionState: 'connected', harnessReachable: true } }; } });
 t.after(() => controller.close()); await controller.initialize();
 const workspaces = await new BotWorkspaceStore(join(path, 'workspaces.json'), { defaultWorkspace: path, ungroupedWorkspace: path }).load();
 await workspaces.ensure(config.botId);
 const wrapped = createWorkspaceAwareController(controller, { workspaces, stateFor: async () => ({}),
  agentPresetCatalog: async () => ({ items: [], private: 'secret-catalog' }), modelCatalog: async () => ({ groups: [], private: 'secret-catalog' }) });
 const rpc = createQqRpcHandler(wrapped);
 for (const key of ['setTrace', 'listTraces', 'traceDetail', 'exportTraces']) assert.equal(QQ_ENDPOINTS[key], clientEndpoints[key]);
 assert.equal(normalizeSnapshot(controller.status()).bots[0].trace.enabled, false);
 for (const enabled of [null, 1, 'true']) assert.equal((await rpc(QQ_ENDPOINTS.setTrace, { botId: config.botId, enabled })).ok, false);
 for (const offset of [-1, 1.2, '0']) assert.equal((await rpc(QQ_ENDPOINTS.listTraces, { botId: config.botId, offset })).ok, false);
 assert.equal((await rpc(QQ_ENDPOINTS.listTraces, { botId: config.botId, result: 'secret' })).ok, false);
 assert.equal((await rpc(QQ_ENDPOINTS.exportTraces, { botId: config.botId, contents: true })).ok, false);
 const empty = await rpc(QQ_ENDPOINTS.exportTraces, { botId: config.botId }); assert.deepEqual(empty.value.traces, []);
 assert.equal((await rpc(QQ_ENDPOINTS.setTrace, { botId: config.botId, enabled: true })).ok, true);
 assert.equal((await new QqConfigStore(configPath).load()).get(config.botId).traceEnabled, true);
 const msg = { messageId: 'secret-id', kind: 'group', groupOpenid: 'secret-group', senderId: 'secret-owner' };
 await traces.run(msg, () => qqTraceEvent('delivery', 'unknown'));
 const page = await rpc(QQ_ENDPOINTS.listTraces, { botId: config.botId, result: 'unknown' }); assert.equal(page.value.items.length, 1);
 const id = page.value.items[0].id;
 const detail = await rpc(QQ_ENDPOINTS.traceDetail, { botId: config.botId, id }); assert.equal(detail.value.outcome, 'unknown');
 assert.equal((await rpc(QQ_ENDPOINTS.traceDetail, { botId: config.botId, id: 'f'.repeat(24) })).value, null);
 await controller.reconnectBot(config.botId); assert.equal(traces.list().total, 1);
 await controller.bindCredentials({ appId: config.appId, appSecret: 'secret' }); assert.equal(configStore.get(config.botId).traceEnabled, true);
 await rpc(QQ_ENDPOINTS.setTrace, { botId: config.botId, enabled: false });
 const bundle = await rpc(QQ_ENDPOINTS.exportTraces, { botId: config.botId }); assert.equal(bundle.value.traces.length, 1);
 assert.doesNotMatch(JSON.stringify(bundle), /secret|token|appId|\.\d+\.\d+\.\d+/);
 await assert.rejects(configStore.save({ ...config, traceEnabled: 'true' }), /traceEnabled/);
 assert.equal(configStore.get(config.botId).groupMemoryEnabled, undefined);
});

test('trace panel browses details, filters and downloads exactly the redacted RPC payload; errors remain visible', async () => {
 let renderer; const queries = [], downloads = [], changes = [];
 const row = { id: 'a'.repeat(24), startedAt: 1, updatedAt: 2, endedAt: 2, outcome: 'unknown', events: [{ stage: 'delivery', result: 'unknown', elapsedMs: 1 }] };
 const bundle = { contentIncluded: false, traces: [row] };
 let missing = false;
 act(() => { renderer = Renderer.create(React.createElement(TracePanel, { status: { enabled: false },
  onChange: async enabled => changes.push(enabled), onList: async query => { queries.push(query); return { items: [row], nextOffset: null }; },
  onDetail: async () => missing ? null : row, onExport: async () => bundle, download: data => downloads.push(data) })); });
 const button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
 await act(async () => renderer.root.findByProps({ 'aria-label': '采集消息轨迹' }).props.onChange({ target: { value: 'on' } })); assert.deepEqual(changes, [true]);
 await act(async () => button('查看／刷新轨迹').props.onClick());
 await act(async () => button('查看时间线').props.onClick()); assert.equal(renderer.root.findAllByType('ol').length, 1);
 await act(async () => button('导出脱敏诊断 JSON').props.onClick()); assert.deepEqual(downloads, [bundle]);
 act(() => renderer.root.findAllByType('select')[1].props.onChange({ target: { value: 'unknown' } }));
 await act(async () => button('查看／刷新轨迹').props.onClick()); assert.equal(queries.at(-1).result, 'unknown');
 missing = true; await act(async () => button('查看时间线').props.onClick()); assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /轨迹已过期/);
 act(() => renderer.unmount());
});
