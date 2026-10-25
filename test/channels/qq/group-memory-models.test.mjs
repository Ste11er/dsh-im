import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QqController } from '../../../src/channels/qq/qq-controller.mjs';
import { QqConfigStore, deriveQqBotIdentity } from '../../../src/channels/qq/config-store.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../../../plugin-src/host/channels/qq/rpc.mjs';
import { normalizeSnapshot } from '../../../plugin-src/client/channels/qq/api.js';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { GroupMemoryModelEditor } from '../../../plugin-src/client/channels/qq/index.js';
import { ModelEditor } from '../../../plugin-src/client/model-setting.js';
import { createProductionController } from '../../../plugin-src/host/channels/qq/production.mjs';

test('memory text and image model settings persist independently without enabling memory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'qq-memory-models-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  const store = await new QqConfigStore(path).load();
  const config = { ...deriveQqBotIdentity('app'), appId: 'app', ownerUserOpenid: '*' };
  await store.save(config);
  const checked = [];
  const controller = new QqController({ configStore: store,
    credentials: { resolve() {}, set() {}, unset() {} }, qrAuth: { start() {} },
    createRuntime() {}, validateGroupMemoryModel: async (kind, model) => {
      checked.push({ kind, model });
      if (kind === 'image' && model.model === 'text-only') throw Error('vision required');
    } });
  const rpc = createQqRpcHandler(controller);
  const text = { provider: 'p', model: 'text-only' };
  const image = { provider: 'q', model: 'vision', reasoningEffort: 'low' };
  for (const [kind, model] of [['text', text], ['image', image]]) {
    const response = await rpc(QQ_ENDPOINTS.setGroupMemoryModel, { botId: config.botId, kind, model });
    assert.equal(response.ok, true);
    assert.equal(normalizeSnapshot(response.value).bots[0].groupMemoryEnabled, false);
  }
  assert.deepEqual((await new QqConfigStore(path).load()).get(config.botId).groupMemoryModels, { text, image });
  assert.equal(checked.length, 2);
  assert.equal((await rpc(QQ_ENDPOINTS.setGroupMemoryModel, { botId: config.botId, kind: 'image', model: text })).ok, false);
  assert.deepEqual(store.get(config.botId).groupMemoryModels.image, image);
  assert.equal((await rpc(QQ_ENDPOINTS.setGroupMemoryModel, { botId: config.botId, kind: 'other', model: null })).ok, false);
  await rpc(QQ_ENDPOINTS.setGroupMemoryModel, { botId: config.botId, kind: 'text', model: null });
  assert.deepEqual(store.get(config.botId).groupMemoryModels, { text: null, image });
  for (const invalid of [null, 'model', { text: '' }, { extra: true }]) {
    await assert.rejects(store.save({ ...config, groupMemoryModels: invalid }));
  }
});

test('QQ memory model controls use independent selectors and remain editable while memory is off', async () => {
  const saved = [];
  let view;
  act(() => { view = TestRenderer.create(React.createElement(GroupMemoryModelEditor, {
    models: { text: { provider: 'p', model: 'text' }, image: null }, disabled: false,
    onSave: (kind, model) => saved.push({ kind, model }),
  })); });
  const editors = view.root.findAllByType(ModelEditor);
  assert.equal(editors.length, 2);
  assert.match(editors[0].props.title, /图片/);
  assert.match(editors[1].props.title, /文本/);
  assert.equal(editors[0].props.disabled, false);
  await editors[0].props.onSave({ provider: 'v', model: 'vision' });
  await editors[1].props.onSave(null);
  assert.deepEqual(saved, [{ kind: 'image', model: { provider: 'v', model: 'vision' } }, { kind: 'text', model: null }]);
  act(() => view.unmount());
});

test('production memory routes image and text jobs to independently selected models and reads later changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'qq-memory-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let models = { image: { provider: 'i', model: 'vision' }, text: { provider: 't', model: 'cheap' } };
  let controllerOptions;
  let runtimeOptions;
  const used = [];
  class ConfigStore { async load() { return this; } list() { return []; } get() { return { groupMemoryModels: models }; } }
  class Controller { constructor(options) { controllerOptions = options; } async close() {} }
  class Runtime { constructor(options) { runtimeOptions = options; } }
  class Harness { stopManagedProcess() {} }
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'host', model: 'default' }) },
    llm: { resolveModelInfo: async (_p, m) => ({ inputModalities: m === 'text-only' ? ['text'] : ['text', 'image'] }),
      stream: async function* (options) { used.push(['text', options.model]); yield { type: 'text-delta', index: 0, text: '周五销量317' }; yield { type: 'finish', reason: { kind: 'stop' } }; } },
    attachments: { admitPromptContent: async parts => parts.map(part => part.type === 'image'
      ? { type: 'image', attachment: { attachmentId: 'fixture', mediaType: part.mediaType, bytes: 68 } } : part) },
    agents: { get: () => undefined, create: async options => {
      used.push(['image', options.agentOptions.model]);
      const model = options.agentOptions;
      options.setup({ get: name => name === 'tools' ? { presentAs() {}, restrict() {}, guard() {} } : { section() {} }, on() {} });
      return { dispose: async () => {}, agent: { id: 'image-session', followup() {}, cancel() {}, whenIdle: async () => {},
        session: { snapshotEvents: () => [
          { type: 'assistant/message', data: { turn: 1, message: { source: model, content: [{ type: 'text', text: '周五销量317' }] } } },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ] } } };
    } },
  };
  const production = await createProductionController({ credentials: {},
    typertGateway: { invoke() {}, stream() {} }, get: name => services[name], logger: () => ({ error() {}, warn() {} }) },
  { dataDir: root, dshHome: root }, { ConfigStore, Controller, Runtime, HarnessClient: Harness,
    createConnectionSupervisor: () => ({ ready: Promise.resolve(), start() { return this; }, async close() {} }) });
  t.after(() => production.close());
  await controllerOptions.createRuntime({ botId: 'qq_models', config: { appId: 'app' }, appSecret: 'secret' });
  const memory = runtimeOptions.groupMemory;
  t.after(() => memory.close());
  memory.setEnabled(true);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await memory.recordImages('group:a', { messageId: 'picture', senderId: 'member', content: '' }, [{ data: png }]);
  await memory.compact({ force: true });
  models = { ...models, text: null };
  memory.record('group:a', { messageId: 'next', senderId: 'member', content: '周五' });
  await memory.compact({ force: true });
  assert.deepEqual(used, [['image', 'vision'], ['text', 'cheap'], ['text', 'default']]);
  await assert.rejects(controllerOptions.validateGroupMemoryModel('image', { provider: 'p', model: 'text-only' }), { code: 'model-selection-invalid' });
});
