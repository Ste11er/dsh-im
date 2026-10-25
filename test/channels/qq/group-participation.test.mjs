import assert from 'node:assert/strict';
import test from 'node:test';
import { QqGroupParticipation, qqGroupParticipation } from '../../../src/channels/qq/group-participation.mjs';
test('participation settings have no probability and migrate the deployed legacy setting', () => {
  assert.deepEqual(qqGroupParticipation(), { enabled: false, cooldownSeconds: 180, judgeModel: null });
  for (const value of [null, {}, { enabled: true, cooldownSeconds: 0 }, { enabled: true, cooldownSeconds: 1.5 }, { enabled: true, cooldownSeconds: 42, other: true }]) assert.throws(() => qqGroupParticipation(value));
  assert.deepEqual(qqGroupParticipation({ enabled: true, probability: 0.2, cooldownSeconds: 37 }), { enabled: true, cooldownSeconds: 37, judgeModel: null });
  assert.throws(() => qqGroupParticipation({ enabled: true, probability: -1, cooldownSeconds: 37 }));
});
test('every eligible message reaches the model; cooldown includes silent decisions and groups stay independent', async () => {
  let now = 1000; let judged = 0; let replied = 0;
  const p = new QqGroupParticipation({ now: () => now });
  const callbacks = async () => { judged++; return null; };
  await p.consider('a', callbacks); assert.equal(judged, 0);
  // Existing low-probability configuration must no longer randomly skip eligible messages.
  p.set({ enabled: true, probability: 0, cooldownSeconds: 10 });
  await p.consider('a', callbacks); await p.consider('a', callbacks);
  assert.equal(judged, 1); assert.equal(replied, 0);
  await p.consider('b', callbacks); assert.equal(judged, 2);
  now += 10000; await p.consider('a', async () => { replied++; return {}; }); assert.equal(replied, 1);
  assert.deepEqual(p.status, { candidates: 3, declined: 2, replied: 1, waiting: 0, skipped: 0, errors: 0, lastError: null });
});
test('disabling or a mention cancels an in-flight decision without replying', async () => {
  const p = new QqGroupParticipation(); p.set({ enabled: true, cooldownSeconds: 180, judgeModel: null });
  let finish; let replied = false;
  const pending = p.consider('a', async signal => { await new Promise(resolve => { finish = resolve; }); signal.throwIfAborted(); replied = true; return {}; });
  p.cancel('a'); finish(true); await pending; assert.equal(replied, false);
  p.set({ enabled: false, cooldownSeconds: 180, judgeModel: null }); await p.whenIdle();
});

test('ordinary QQ messages can reply without entering command handling; duplicates, pauses and mentions retain their semantics', async () => {
  const { QqHarnessBridge } = await import('../../../src/channels/qq/qq-bridge.mjs');
  const seen = new Set(); const sessions = new Map(); const sent = []; const calls = []; let ordinaryAsks = 0;
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', groupContextEnabled: true,
    groupParticipation: { enabled: true, cooldownSeconds: 1 },
    bot: { sendText: async (target, text) => { sent.push({ target, text }); return { message: { id: 'reply' } }; } },
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    harness: { createSession: async () => 's', sessionExists: async () => true, ask: async () => { ordinaryAsks++; return 'mentioned answer'; } },
    participationReply: async options => { calls.push(options); return options.deliver({ text: '我也觉得好笑', artifacts: [] }); } });
  const msg = (id, group = 'g', content = '这梗也太好笑了') => ({ messageId: id, senderId: 'u', kind: 'group', groupOpenid: group,
    timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', content, replyTarget: { scope: 'group', targetId: group, msgId: id } });
  await bridge.accept(msg('one')); assert.equal(calls.length, 1); assert.equal(sent.length, 1); assert.equal(ordinaryAsks, 0);
  assert.equal(calls[0].deliveryContext.autonomous, true); assert.match(calls[0].content, /这梗也太好笑了/);
  await bridge.accept(msg('one')); await bridge.accept(msg('two')); assert.equal(calls.length, 1);
  await bridge.accept(msg('command', 'other', '/new')); assert.equal(calls.length, 1); assert.equal(sessions.size, 0);
  bridge.setPaused(true); await bridge.accept(msg('paused', 'third')); assert.equal(calls.length, 1);
  bridge.setPaused(false); await bridge.accept({ ...msg('mention'), rawEventType: 'GROUP_AT_MESSAGE_CREATE' }); assert.equal(ordinaryAsks, 1);
  bridge.setGroupParticipation({ enabled: false, cooldownSeconds: 1 });
  await bridge.accept(msg('disabled', 'fourth')); assert.equal(calls.length, 1);
});

test('native judgment has no tools, keeps silence off QQ and delegates approved replies to the shared conversation', async () => {
  const { createGroupParticipationReply, PARTICIPATION_SKIP } = await import('../../../plugin-src/host/channels/qq/group-participation-reply.mjs');
  const { OutboundArtifactRegistry } = await import('../../../src/channels/shared/semantic/artifact.mjs');
  const registry = new OutboundArtifactRegistry(); let allowed; let mode; let guard; let disposed = 0; let output = PARTICIPATION_SKIP;
  const ctx = { get: name => name === 'agents' ? { create: async options => {
    options.setup({ get: key => key === 'tools' ? { presentAs: value => { mode = value; }, restrict: value => { allowed = value; }, guard: value => { guard = value; } } : { section: () => {} }, on: () => {} });
    const session = { id: options.sessionId, events: [{ type: 'turn/start', data: { turn: 1 } }], snapshotEvents: () => [...session.events, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: output }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] };
    return { agent: { session, followup: message => { assert.ok(Array.isArray(message.content), 'Host Agent requires content blocks, not a string'); assert.equal(message.content[0].type, 'text'); registry.observeClaimedMessage(session, message, 1); }, whenIdle: async () => {}, cancel: () => {} }, dispose: async () => { disposed++; } };
  } } : undefined };
  const reply = createGroupParticipationReply(ctx, () => ({ provider: 'p', model: 'm' }), { registry });
  let delivered = 0;
  const options = { content: '群聊引用', cwd: '/tmp', signal: new AbortController().signal,
    deliveryContext: { channel: 'qq', autonomous: true }, reply: async () => { assert.equal(disposed, 2); delivered++; return { text: '哈哈，确实' }; } };
  assert.equal(await reply(options), null); assert.equal(delivered, 0); assert.equal(disposed, 1);
  assert.equal(mode, 'native'); assert.deepEqual(allowed.allow, []); assert.equal(typeof guard, 'function');
  output = '[[QQ_REPLY]]'; assert.deepEqual(await reply(options), { text: '哈哈，确实' }); assert.equal(delivered, 1);
});
test('autonomous tool guard rejects commands, PTC and arbitrary file paths, permits only selected sticker returns', async () => {
  const { OutboundArtifactRegistry } = await import('../../../src/channels/shared/semantic/artifact.mjs');
  const { participationToolGuard, rememberParticipationSticker } = await import('../../../plugin-src/host/channels/qq/participation-context.mjs');
  const registry = new OutboundArtifactRegistry(); const session = { id: 'guard', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  const close = registry.openConsumer(session.id, 'rpc', { channel: 'qq', autonomous: true }); registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  const exec = { agent: { session }, arguments: { path: '/private/key' } };
  for (const name of ['run_code', 'terminal', 'read_file', 'dsh_im_return_file']) assert.equal(typeof participationToolGuard(registry, { ...exec, name }), 'string');
  rememberParticipationSticker(registry, session, '/cache/selected.png');
  assert.equal(participationToolGuard(registry, { ...exec, name: 'dsh_im_return_file', arguments: { path: '/cache/selected.png' } }), undefined);
  close();
  assert.equal(typeof participationToolGuard(registry, { ...exec, name: 'dsh_qq_sticker' }), 'string');
  registry.clear();
});
test('management RPC persists adjustable cooldown, applies live, preserves other settings and rebinds', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { QqConfigStore, deriveQqBotIdentity } = await import('../../../src/channels/qq/config-store.mjs');
  const { QqController } = await import('../../../src/channels/qq/qq-controller.mjs');
  const { createQqRpcHandler, QQ_ENDPOINTS } = await import('../../../plugin-src/host/channels/qq/rpc.mjs');
  const { QQ_ENDPOINTS: client, normalizeSnapshot } = await import('../../../plugin-src/client/channels/qq/api.js');
  const root = await mkdtemp(join(tmpdir(), 'qq-participation-settings-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json'); const store = await new QqConfigStore(path).load();
  const config = { ...deriveQqBotIdentity('participation'), appId: 'participation', ownerUserOpenid: '*', groupContextEnabled: true, stickersEnabled: true, createdAt: '2026-10-24T00:00:00.000Z' };
  await store.save(config); const applied = []; const validated = [];
  const controller = new QqController({ configStore: store, credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} }, qrAuth: { start: () => () => {} },
    validateParticipationModel: async model => { validated.push(model); },
    createRuntime: async () => ({ status: { ready: true, qqConnectionState: 'connected', harnessReachable: true }, start: async () => {}, stop: async () => {}, setGroupParticipation: value => applied.push(value) }) });
  t.after(() => controller.close()); await controller.initialize(); const rpc = createQqRpcHandler(controller);
  assert.equal(QQ_ENDPOINTS.setGroupParticipation, client.setGroupParticipation);
  assert.equal(normalizeSnapshot(controller.status()).bots[0].groupParticipation.enabled, false);
  const settings = { enabled: true, cooldownSeconds: 42, judgeModel: { provider: 'p', model: 'judge' } };
  for (const settings of [null, {}, { enabled: true, probability: -1, cooldownSeconds: 42 }]) assert.equal((await rpc(client.setGroupParticipation, { botId: config.botId, settings })).ok, false);
  const result = await rpc(client.setGroupParticipation, { botId: config.botId, settings }); assert.equal(result.ok, true);
  assert.deepEqual(validated, [settings.judgeModel]); assert.deepEqual(applied, [settings]); assert.deepEqual(normalizeSnapshot(result.value).bots[0].groupParticipation, settings);
  const loaded = await new QqConfigStore(path).load(); assert.deepEqual(loaded.get(config.botId), { ...config, connectedAt: null, groupParticipation: settings });
  await controller.bindCredentials({ appId: config.appId, appSecret: 'new' }); assert.deepEqual(store.get(config.botId).groupParticipation, settings);
});
test('participation editor saves a custom cooldown and preserves the draft during background refresh', async () => {
  const React = await import('react'); const { default: Renderer, act } = await import('react-test-renderer');
  const { ParticipationEditor } = await import('../../../plugin-src/client/channels/qq/participation-editor.js');
  const { ModelEditor } = await import('../../../plugin-src/client/model-setting.js');
  const saved = []; const props = { settings: qqGroupParticipation(), contextEnabled: true, onSave: value => saved.push(value) }; let renderer;
  act(() => { renderer = Renderer.create(React.createElement(ParticipationEditor, props)); });
  assert.equal(renderer.root.findByType(ModelEditor).props.model, null);
  await act(async () => { await renderer.root.findByType(ModelEditor).props.onSave({ provider: 'p', model: 'judge' }); });
  assert.deepEqual(saved.pop(), { enabled: false, cooldownSeconds: 180, judgeModel: { provider: 'p', model: 'judge' } });
  act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'on' } }));
  assert.equal(renderer.root.findAllByType('input').length, 1);
  act(() => renderer.root.findAllByType('input')[0].props.onChange({ target: { value: '42' } }));
  act(() => renderer.update(React.createElement(ParticipationEditor, { ...props, settings: { ...props.settings } })));
  assert.equal(renderer.root.findAllByType('input')[0].props.value, '42');
  await act(async () => { await renderer.root.findAllByType('button').find(b => b.children.includes('保存自主参与设置')).props.onClick(); });
  assert.deepEqual(saved, [{ enabled: true, cooldownSeconds: 42, judgeModel: null }]);
  act(() => renderer.root.findAllByType('input')[0].props.onChange({ target: { value: '' } }));
  await act(async () => { await renderer.root.findAllByType('button').find(b => b.children.includes('保存自主参与设置')).props.onClick(); });
  assert.equal(saved.length, 1); assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /冷却/);
  act(() => renderer.unmount());
});

test('independent judgment uses its own model without tools and invokes the reply model only after approval', async () => {
  const { createGroupParticipationReply } = await import('../../../plugin-src/host/channels/qq/group-participation-reply.mjs');
  const { OutboundArtifactRegistry } = await import('../../../src/channels/shared/semantic/artifact.mjs');
  const registry = new OutboundArtifactRegistry(); const calls = []; let decision = '[[QQ_KEEP_SILENT]]';
  const ctx = { get: name => name === 'agents' ? { create: async options => {
    const record = { model: options.agentOptions.model }; calls.push(record);
    options.setup({ get: key => key === 'tools' ? { presentAs() {}, restrict: value => { record.allow = value.allow; }, guard() {} } : { section() {} }, on() {} });
    const session = { id: options.sessionId, events: [{ type: 'turn/start', data: { turn: 1 } }], snapshotEvents: () => [...session.events,
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: record.model === 'judge' ? decision : '有道理' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] };
    return { agent: { session, followup: message => { assert.ok(Array.isArray(message.content), 'Host Agent requires content blocks, not a string'); assert.equal(message.content[0].type, 'text'); registry.observeClaimedMessage(session, message, 1); }, whenIdle: async () => {}, cancel() {} }, dispose: async () => {} };
  } } : undefined };
  const reply = createGroupParticipationReply(ctx, () => ({ provider: 'p', model: 'reply' }), { registry, selectedJudgeModel: () => ({ provider: 'p', model: 'judge' }) });
  let sent = 0; const args = { content: '群聊', cwd: '/tmp', deliveryContext: { channel: 'qq', autonomous: true }, signal: new AbortController().signal, reply: async () => { sent++; return {}; } };
  assert.equal(await reply(args), null); assert.equal(sent, 0); assert.deepEqual(calls, [{ model: 'judge', allow: [] }]);
  decision = '[[QQ_REPLY]]'; await reply(args); assert.equal(sent, 1);
  assert.deepEqual(calls.map(x => x.model), ['judge', 'judge']); assert.deepEqual(calls[1].allow, []);
  decision = '也许'; await assert.rejects(reply(args), /decision/); assert.equal(sent, 1);
});

test('judgment has no reply guidance and scoped Host tools cannot enter either Agent surface', async () => {
  const { createGroupParticipationReply } = await import('../../../plugin-src/host/channels/qq/group-participation-reply.mjs');
  const { OutboundArtifactRegistry } = await import('../../../src/channels/shared/semantic/artifact.mjs');
  const registry = new OutboundArtifactRegistry(); const observed = [];
  const replyTools = ['dsh_qq_sticker', 'dsh_im_return_file', 'dsh_qq_memory'];
  const ctx = { get: name => name === 'agents' ? { create: async options => {
    const hooks = new Map(); const judge = options.agentOptions.model === 'judge';
    options.setup({ get: key => key === 'tools' ? { presentAs() {}, restrict() {}, guard() {} } : { section() {} }, on: (name, handler) => hooks.set(name, handler) });
    const session = { id: options.sessionId, events: [{ type: 'turn/start', data: { turn: 1 } }], snapshotEvents: () => [...session.events,
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: judge ? '[[QQ_REPLY]]' : '来了' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] };
    return { agent: { session, followup: message => { registry.observeSessionEvent(session, { type: 'turn/start', data: { turn: 1 } }); registry.observeClaimedMessage(session, message, 1); }, whenIdle: async () => {
      // Host team tools are registered directly on a new Agent; tools.restrict
      // only filters inherited tools, so the final schema surface must agree.
      const assembly = { tools: [...replyTools, 'spawn_teammate', 'team_task_create'].map(name => ({ name })), contexts: [] };
      const hook = hooks.get('system-prompt/assemble');
      const result = hook ? await hook(assembly, { agent: { session } }, async () => assembly) : assembly;
      observed.push({ judge, activeReplyContext: !!registry.activeDeliveryContext(session), tools: result.tools.map(tool => tool.name) });
    }, cancel() {} }, dispose: async () => {} };
  } } : undefined };
  const reply = createGroupParticipationReply(ctx, () => ({ provider: 'p', model: 'reply' }), { registry, selectedJudgeModel: () => ({ provider: 'p', model: 'judge' }) });
  let delivered = 0;
  await reply({ content: '大肥鱼发个表情包', cwd: '/tmp', signal: new AbortController().signal,
    deliveryContext: { channel: 'qq', conversationType: 'group', autonomous: true, stickersEnabled: true }, reply: async () => { delivered++; return {}; } });
  assert.deepEqual(observed, [
    { judge: true, activeReplyContext: false, tools: [] },
  ]);
  assert.equal(delivered, 1);
});

test('mentioned and autonomous replies share the group Session, and judges see completed assistant replies with an explicit current message', async () => {
  const sessions = new Map(); const seen = new Set(); const turns = []; const judged = []; let created = 0;
  const bridge = new (await import('../../../src/channels/qq/qq-bridge.mjs')).QqHarnessBridge({
    ownerUserOpenid: '*', groupContextEnabled: true, groupParticipation: { enabled: true, cooldownSeconds: 1 },
    bot: { sendText: async () => ({ message: { id: 'sent' } }) },
    state: { sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id), hasSeen: id => seen.has(id), markSeen: async id => seen.add(id) },
    harness: { createSession: async () => `shared-${++created}`, sessionExists: async () => true, ask: async (id, content, options) => {
      turns.push({ id, content, autonomous: options.deliveryContext.autonomous === true });
      return turns.length === 1 ? '我叫大肥鱼' : turns.length === 2 ? '表情包来了' : '刚刚已经告诉你了';
    } },
    participationReply: async options => { judged.push(options.content); return options.reply(); },
  });
  const msg = (id, text, addressed) => ({ messageId: id, senderId: 'member', kind: 'group', groupOpenid: 'g', content: text,
    timestamp: new Date().toISOString(), rawEventType: addressed ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE', replyTarget: { scope: 'group', targetId: 'g', msgId: id } });
  await bridge.accept(msg('name', '你叫什么', true));
  await new Promise(resolve => setTimeout(resolve, 1010));
  await bridge.accept(msg('sticker', '大肥鱼发个表情包', false));
  await bridge.accept(msg('followup', '你刚才说叫什么', true));
  assert.equal(created, 1); assert.deepEqual(turns.map(turn => turn.id), ['shared-1', 'shared-1', 'shared-1']);
  assert.deepEqual(turns.map(turn => turn.autonomous), [false, true, false]);
  assert.match(judged[0], /"role":"assistant".*我叫大肥鱼/);
  assert.match(judged[0], /<dsh_im_qq_current_message>.*大肥鱼发个表情包/s);
  assert.match(turns[2].content, /"role":"assistant".*表情包来了/);
});

test('delayed QQ group events outside the five-minute reply window never invoke the model or enter fresh context', async () => {
  const { QqHarnessBridge } = await import('../../../src/channels/qq/qq-bridge.mjs');
  const seen = new Set(); const candidates = []; let archiveCount = 0;
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', groupContextEnabled: true, groupParticipation: { enabled: true, cooldownSeconds: 1 },
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id) }, harness: { ask: async () => assert.fail('old input must not ask') }, bot: { sendText: async () => assert.fail('old input must not send') },
    groupMemory: { capture: () => 0, record: () => { archiveCount++; } },
    participationReply: async options => { candidates.push(options.content); return null; }, logger: { info() {} },
  });
  const msg = (id, text, age) => ({ messageId: id, senderId: 'member', kind: 'group', groupOpenid: 'g', content: text,
    timestamp: new Date(Date.now() - age).toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', replyTarget: { scope: 'group', targetId: 'g', msgId: id } });
  const delayed = msg('old', 'yesterday stale message', 6 * 60_000);
  await bridge.accept(delayed); assert.equal(candidates.length, 0); assert.equal(seen.has('old'), true);
  assert.equal(archiveCount, 1, 'existing archival still retains an allowed delayed message');
  await bridge.accept(msg('new', 'current message', 1000));
  assert.equal(candidates.length, 1); assert.doesNotMatch(candidates[0], /yesterday stale message/);
});

test('reply-window boundary uses the original QQ timestamp and explicit invalid values fail', async () => {
  const { qqGroupReplyExpired, QQ_GROUP_REPLY_WINDOW_MS } = await import('../../../src/channels/qq/group-participation.mjs');
  const sentAt = Date.parse('2026-10-25T12:00:00+08:00'); const message = { timestamp: new Date(sentAt).toISOString() };
  assert.equal(qqGroupReplyExpired(message, sentAt + QQ_GROUP_REPLY_WINDOW_MS - 1), false);
  assert.equal(qqGroupReplyExpired(message, sentAt + QQ_GROUP_REPLY_WINDOW_MS), true);
  for (const timestamp of [undefined, null, 0, '', 'invalid']) assert.throws(() => qqGroupReplyExpired({ timestamp }, sentAt), /timestamp/);
});

test('participation failures retain a safe actionable cause without exposing raw group identifiers', async () => {
  const p = new QqGroupParticipation({ now: () => 1000, logger: { error() {} } });
  p.set({ enabled: true, cooldownSeconds: 1 });
  await p.consider('network', async () => { const error = new Error('private endpoint and request'); error.code = 'qq-connect-timeout'; throw error; });
  assert.deepEqual(p.status.lastError, { code: 'qq-connect-timeout' });
  await p.consider('expired', async () => { const error = new Error('private group id'); error.bizCode = 40034005; throw error; });
  assert.deepEqual(p.status.lastError, { code: 'qq-reply-expired' });
});
