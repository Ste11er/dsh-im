import assert from 'node:assert/strict';
import test from 'node:test';
import { qqPersona, DEFAULT_QQ_PERSONA } from '../../../src/channels/qq/persona.mjs';
import { installQqPersonaContext } from '../../../plugin-src/host/channels/qq/persona-context.mjs';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
test('persona defaults disabled, accepts custom baseline and rejects invalid settings', () => {
  assert.deepEqual(qqPersona(), { enabled: false, text: DEFAULT_QQ_PERSONA });
  assert.deepEqual(qqPersona({ enabled: true, text: '温柔，有主见' }), { enabled: true, text: '温柔，有主见' });
  for (const value of [null, {}, { enabled: true, text: '' }, { enabled: 1, text: 'x' }, { enabled: true, text: 'x'.repeat(4001) }, { enabled: true, text: 'x', other: 1 }]) assert.throws(() => qqPersona(value));
});
test('persona context follows the actual QQ turn, clears after close and cannot leak into another channel', () => {
  const registry = new OutboundArtifactRegistry(); let context;
  installQqPersonaContext({ systemPrompt: { context: value => { context = value; } } }, { registry });
  const session = { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  assert.equal(context.text({ agent: { session } }), '');
  for (const [channel, enabled, expected] of [['qq', true, '温柔，有主见'], ['qq', false, ''], ['telegram', true, '']]) {
    const close = registry.openConsumer('s', 'rpc', { channel, persona: { enabled, text: '温柔，有主见' } });
    registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
    const value = context.text({ agent: { session } });
    if (expected) assert.match(value, /温柔，有主见/); else assert.equal(value, '');
    close(); assert.equal(context.text({ agent: { session } }), '');
  }
});

test('persona config, live controller and management RPC persist independently of memory and permissions', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { QqConfigStore, deriveQqBotIdentity } = await import('../../../src/channels/qq/config-store.mjs');
  const { QqController } = await import('../../../src/channels/qq/qq-controller.mjs');
  const { createQqRpcHandler, QQ_ENDPOINTS } = await import('../../../plugin-src/host/channels/qq/rpc.mjs');
  const { normalizeSnapshot, QQ_ENDPOINTS: clientEndpoints } = await import('../../../plugin-src/client/channels/qq/api.js');
  const directory = await mkdtemp(join(tmpdir(), 'qq-persona-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json'); const store = await new QqConfigStore(path).load();
  const config = { ...deriveQqBotIdentity('persona-app'), appId: 'persona-app', ownerUserOpenid: '*', createdAt: '2026-10-24T00:00:00.000Z', stickersEnabled: true };
  await store.save(config); const live = [];
  const controller = new QqController({ configStore: store, qrAuth: { start: () => () => {} }, credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} }, createRuntime: async () => ({ status: { ready: true, qqConnectionState: 'connected', harnessReachable: true }, start: async () => {}, stop: async () => {}, setPersona: value => live.push(value) }) });
  t.after(() => controller.close()); await controller.initialize();
  const rpc = createQqRpcHandler(controller); assert.equal(QQ_ENDPOINTS.setPersona, clientEndpoints.setPersona);
  for (const persona of [null, {}, { enabled: true, text: '' }]) assert.equal((await rpc(QQ_ENDPOINTS.setPersona, { botId: config.botId, persona })).ok, false);
  const persona = { enabled: true, text: '活泼、坦诚，有自己的观点。' };
  const result = await rpc(QQ_ENDPOINTS.setPersona, { botId: config.botId, persona });
  assert.equal(result.ok, true); assert.deepEqual(live, [persona]);
  assert.deepEqual(normalizeSnapshot(result.value).bots[0].persona, persona);
  const loaded = await new QqConfigStore(path).load(); assert.deepEqual(loaded.get(config.botId), { ...config, connectedAt: null, persona });
  await controller.bindCredentials({ appId: config.appId, appSecret: 'new' });
  assert.deepEqual(store.get(config.botId).persona, persona);
});
test('persona editor saves custom text and preserves unsaved edits across status refresh', async () => {
  const React = await import('react'); const { default: Renderer, act } = await import('react-test-renderer');
  const { PersonaEditor } = await import('../../../plugin-src/client/channels/qq/persona-editor.js');
  let renderer; const saved = []; const persona = { enabled: false, text: '原文' };
  act(() => { renderer = Renderer.create(React.createElement(PersonaEditor, { persona, onSave: value => saved.push(value) })); });
  act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '温柔而有主见' } }));
  act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'on' } }));
  act(() => renderer.update(React.createElement(PersonaEditor, { persona: { ...persona }, onSave: value => saved.push(value) })));
  assert.equal(renderer.root.findByType('textarea').props.value, '温柔而有主见');
  await act(async () => { await renderer.root.findAllByType('button')[1].props.onClick(); });
  assert.deepEqual(saved, [{ enabled: true, text: '温柔而有主见' }]);
  act(() => renderer.root.findAllByType('button')[0].props.onClick());
  assert.equal(renderer.root.findByType('textarea').props.value, DEFAULT_QQ_PERSONA);
  act(() => renderer.unmount());
});
test('running QQ runtime applies persona edits to subsequent real bridge requests', async t => {
  const { EventEmitter } = await import('node:events');
  const { QqRuntime } = await import('../../../src/channels/qq/qq-runtime.mjs');
  class Bot extends EventEmitter {
    use() {} async sendText() {}
    async start(signal) { queueMicrotask(() => this.emit('ready', {})); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); }
    stop() {}
  }
  const bot = new Bot(); const contexts = []; const sessions = new Map();
  const baseline = { enabled: true, text: '自然、坦诚，有自己的观点。' };
  const runtime = new QqRuntime({ config: { botId: 'qq_persona', appId: 'app', ownerUserOpenid: '*', persona: baseline }, appSecret: 'secret',
    harness: { ensureRunning: async () => true, createSession: async () => 'session', sessionExists: async () => true,
      ask: async (_id, _text, options) => { contexts.push(options.deliveryContext); return '好呀'; } },
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    createBot: () => bot, typingMiddleware: () => async (_ctx, next) => next() });
  t.after(() => runtime.stop()); await runtime.start();
  const emit = async (id, kind) => { bot.emit('message', {}, { kind, groupOpenid: 'g', senderId: 'member', content: 'hi', messageId: id,
    rawEventType: kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE', replyTarget: { scope: kind, targetId: 'g', msgId: id } });
    for (let n = 0; n < 30; n++) await new Promise(resolve => setImmediate(resolve)); };
  await emit('first', 'group'); assert.deepEqual(contexts[0].persona, baseline);
  const edited = { enabled: true, text: '安静、温柔，但不一味迎合。' }; runtime.setPersona(edited);
  await emit('second', 'c2c'); assert.deepEqual(contexts[1].persona, edited);
  runtime.setPersona({ ...edited, enabled: false }); await emit('third', 'group'); assert.equal(contexts[2].persona.enabled, false);
});

test('failed persona saves keep the draft and display the failure', async () => {
  const React = await import('react'); const { default: Renderer, act } = await import('react-test-renderer');
  const { PersonaEditor } = await import('../../../plugin-src/client/channels/qq/persona-editor.js');
  let renderer;
  act(() => { renderer = Renderer.create(React.createElement(PersonaEditor, { onSave: async () => { throw new Error('保存失败'); } })); });
  act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '保留这份草稿' } }));
  await act(async () => { await renderer.root.findAllByType('button')[1].props.onClick(); });
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), '保存失败');
  assert.equal(renderer.root.findByType('textarea').props.value, '保留这份草稿');
  act(() => renderer.unmount());
});
