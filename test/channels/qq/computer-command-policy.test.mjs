import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { qqComputerCommandOwners, isQqComputerCommandOwner } from '../../../src/channels/qq/computer-command-owner.mjs';
import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
import { installQqComputerCommandPolicy } from '../../../plugin-src/host/channels/qq/computer-command-policy.mjs';
import { rememberParticipationSticker } from '../../../plugin-src/host/channels/qq/participation-context.mjs';

test('computer owner identities are explicit, scope-specific and never wildcard', () => {
  const owners = qqComputerCommandOwners({ direct: 'direct-owner', group: 'group-owner' });
  assert.equal(isQqComputerCommandOwner(owners, 'group', 'group-owner'), true);
  assert.equal(isQqComputerCommandOwner(owners, 'group', 'direct-owner'), false);
  assert.equal(isQqComputerCommandOwner(owners, 'direct', 'direct-owner'), true);
  assert.equal(isQqComputerCommandOwner(undefined, 'group', 'anyone'), false);
  assert.throws(() => qqComputerCommandOwners({ direct: 'old-owner' }, 'new-owner'), /match/);
  for (const invalid of [{ group: '*' }, { direct: '' }, { group: ' owner ' }, { group: null }, { other: 'owner' }]) {
    assert.throws(() => qqComputerCommandOwners(invalid));
  }
});

test('computer owner identities survive config reload and credential rebinding', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { QqConfigStore, deriveQqBotIdentity } = await import('../../../src/channels/qq/config-store.mjs');
  const { QqController } = await import('../../../src/channels/qq/qq-controller.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'qq-computer-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json'); const store = await new QqConfigStore(path).load();
  const identity = deriveQqBotIdentity('owner-app');
  const owners = { direct: 'dm-owner', group: 'group-owner' };
  await store.save({ ...identity, appId: 'owner-app', ownerUserOpenid: '*', computerCommandOwners: owners });
  const controller = new QqController({ configStore: store, qrAuth: { start: () => () => {} },
    credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
    createRuntime: async () => ({ status: { ready: true, qqConnectionState: 'connected', harnessReachable: true }, start: async () => {}, stop: async () => {} }) });
  t.after(() => controller.close()); await controller.initialize();
  await controller.bindCredentials({ appId: 'owner-app', appSecret: 'new-secret' });
  const reloaded = await new QqConfigStore(path).load();
  assert.deepEqual(reloaded.get(identity.botId).computerCommandOwners, owners);
});

test('QR owner change does not retain the previous owner group mapping', async t => {
  const { QqController } = await import('../../../src/channels/qq/qq-controller.mjs');
  const { deriveQqBotIdentity } = await import('../../../src/channels/qq/config-store.mjs');
  for (const [scanner, expected] of [['old-direct', { direct: 'old-direct', group: 'old-group' }], ['new-direct', undefined]]) {
    let callbacks;
    let config = { ...deriveQqBotIdentity('owner-app'), appId: 'owner-app', ownerUserOpenid: '*',
      computerCommandOwners: { direct: 'old-direct', group: 'old-group' } };
    const controller = new QqController({ qrAuth: { start: next => {
      callbacks = next;
      queueMicrotask(() => next.onQrDisplayed('https://q.qq.com/connect?task=owner-test'));
      return () => {};
    } },
      credentials: { resolve: async () => ({ value: 'secret' }), set: async () => {}, unset: async () => {} },
      configStore: { list: () => [config], get: () => config, getByAppId: () => config, save: async value => { config = value; }, remove: async () => null },
      createRuntime: async () => ({ status: { ready: true, qqConnectionState: 'connected', harnessReachable: true }, start: async () => {}, stop: async () => {} }) });
    t.after(() => controller.close());
    const started = await controller.startProvisioning();
    callbacks.onSuccess([{ appId: 'owner-app', appSecret: 'secret', userOpenid: scanner }]);
    for (let n = 0; n < 100 && !['connected', 'failed'].includes(controller.registrationStatus(started.attemptId).status); n++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.registrationStatus(started.attemptId).status, 'connected');
    assert.deepEqual(config.computerCommandOwners, expected);
  }
});

test('non-owner turn blocks all unapproved tools until the Host turn ends', async () => {
  const registry = new OutboundArtifactRegistry(); const hooks = new Map(); let guard; let cleanup; let context; let mode = 'ptc';
  const definitions = ['bash', 'pwsh', 'run_code', 'spawn_teammate', 'read_file', 'web_search', 'web_fetch',
    'dsh_qq_sticker', 'dsh_im_return_file', 'dsh_qq_memory'].map(name => ({ name }));
  const tools = { guard: fn => { guard = fn; }, schemas: () => definitions, modeFor: () => mode,
    presentAs: value => { mode = value; return () => { mode = 'ptc'; }; } };
  const ctx = { tools, systemPrompt: { context: value => { context = value; } },
    on: (name, handler) => hooks.set(name, handler), effect: setup => { cleanup = setup(); } };
  installQqComputerCommandPolicy(ctx, { registry });
  const session = { id: 'group', snapshot: { turn: 1 } };
  const agent = { session, ctx: { get: () => tools }, cancel: () => {} };
  const assembly = { sections: [], tools: definitions };
  const assemble = () => hooks.get('system-prompt/assemble')(assembly, { agent }, async () => assembly);
  const close = registry.openConsumer('group', 'rpc', { channel: 'qq', conversationType: 'group', computerCommandAuthorized: false, memoryLookup: () => {} });
  registry.observeSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
  registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  hooks.get('agent/inbox/claimed')({ agent, turn: 1 });
  assert.equal(mode, 'native');
  const restricted = await assemble();
  assert.deepEqual(restricted.tools.map(tool => tool.name), ['web_search', 'web_fetch', 'dsh_qq_sticker', 'dsh_im_return_file', 'dsh_qq_memory']);
  for (const name of ['bash', 'pwsh', 'run_code', 'spawn_teammate', 'read_file', 'unknown_plugin_tool']) {
    assert.equal(typeof guard({ agent, name }), 'string', name);
  }
  for (const name of ['web_search', 'web_fetch', 'dsh_qq_sticker', 'dsh_qq_memory']) assert.equal(guard({ agent, name }), undefined);
  assert.equal(typeof guard({ agent, name: 'dsh_im_return_file', arguments: { path: '/other' } }), 'string');
  rememberParticipationSticker(registry, session, '/cached/sticker');
  assert.equal(guard({ agent, name: 'dsh_im_return_file', arguments: { path: '/cached/sticker' } }), undefined);
  close();
  assert.equal(typeof guard({ agent, name: 'web_search' }), 'string', 'closed consumer cannot authorize a still-running turn');
  hooks.get('session/event')(session, { type: 'turn/end', data: { turn: 1 } });
  assert.equal(mode, 'ptc'); assert.equal(guard({ agent, name: 'bash' }), undefined);
  const ownerClose = registry.openConsumer('group', 'owner-rpc', { channel: 'qq', computerCommandAuthorized: true });
  registry.observeSessionEvent(session, { type: 'turn/start', data: { turn: 2 } });
  registry.observeClaimedMessage(session, { source: { rpcId: 'owner-rpc' } }, 2);
  hooks.get('agent/inbox/claimed')({ agent, turn: 2 });
  assert.equal(await assemble(), assembly); assert.equal(guard({ agent, name: 'bash' }), undefined);
  assert.match(context.text({ agent }), /当前拥有者本人/);
  ownerClose(); cleanup();
});

test('running QQ bridge binds computer authority to the actual message sender', async t => {
  class Bot extends EventEmitter {
    use() {} async sendText() {}
    async start(signal) { queueMicrotask(() => this.emit('ready', {})); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); }
    stop() {}
  }
  const bot = new Bot(); const contexts = []; const sessions = new Map();
  const runtime = new QqRuntime({ config: { botId: 'qq_test', appId: 'app', ownerUserOpenid: '*',
    computerCommandOwners: { direct: 'dm-owner', group: 'group-owner' } }, appSecret: 'secret',
    harness: { ensureRunning: async () => true, createSession: async () => 'session', sessionExists: async () => true,
      ask: async (_id, _text, options) => { contexts.push(options.deliveryContext); return '好'; } },
    state: { hasSeen: () => false, markSeen: async () => {}, sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    createBot: () => bot, typingMiddleware: () => async (_ctx, next) => next() });
  t.after(() => runtime.stop()); await runtime.start();
  const emit = async (id, kind, senderId) => {
    bot.emit('message', {}, { kind, groupOpenid: 'g', senderId, content: '你好', messageId: id,
      rawEventType: kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE', replyTarget: { scope: kind, targetId: 'g', msgId: id } });
    for (let n = 0; n < 30; n++) await new Promise(resolve => setImmediate(resolve));
  };
  await emit('member', 'group', 'member'); await emit('owner', 'group', 'group-owner');
  await emit('dm', 'c2c', 'dm-owner');
  assert.deepEqual(contexts.map(context => context.computerCommandAuthorized), [false, true, true]);
});
