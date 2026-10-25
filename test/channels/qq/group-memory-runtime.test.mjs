import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';
import { QqGroupMemory } from '../../../src/channels/qq/group-memory.mjs';
import { createProductionController } from '../../../plugin-src/host/channels/qq/production.mjs';

test('QQ runtime persists text, applies both switches and cancels its memory lifecycle', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'qq-memory-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  class Bot extends EventEmitter {
    use() {}
    async sendText() { assert.fail('no ambient replies'); }
    async start(signal) {
      queueMicrotask(() => this.emit('ready', {}));
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    }
    stop() {}
  }
  const bot = new Bot();
  const memory = new QqGroupMemory({ path: join(root, 'memory.sqlite'), watch: false,
    summarize: async () => ({ text: 'summary', model: { provider: 'p', model: 'm' }, usage: null }) });
  const runtime = new QqRuntime({
    config: { botId: 'qq_test', appId: 'app', ownerUserOpenid: '*', groupContextEnabled: true, groupMemoryEnabled: true },
    appSecret: 'secret', groupMemory: memory,
    harness: { ensureRunning: async () => true }, state: { hasSeen: () => false }, createBot: () => bot,
    typingMiddleware: () => async (_ctx, next) => next(),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const emit = (messageId) => bot.emit('message', {}, {
    kind: 'group', timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', groupOpenid: 'a', senderId: 'member', messageId, content: '周五发布',
  });
  emit('one');
  assert.equal(runtime.status.groupMemory.archived, 1);
  runtime.setGroupContextEnabled(false);
  emit('two');
  assert.equal(runtime.status.groupMemory.enabled, false);
  assert.equal(runtime.status.groupMemory.archived, 1);
  runtime.setGroupContextEnabled(true);
  emit('three');
  await runtime.compactGroupMemory();
  assert.equal(runtime.status.groupMemory.summaries, 1);
  runtime.setGroupMemoryEnabled(false);
  emit('four');
  assert.equal(runtime.status.groupMemory.archived, 2);
  assert.equal(runtime.status.groupContextRecorded, 3);
  await runtime.stop();
  assert.equal(memory.status.enabled, false);
});

test('removing a QQ bot cleans its memory archive after runtime shutdown', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'qq-memory-delete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let options;
  let runtimeOptions;
  class ConfigStore { async load() { return this; } list() { return []; } }
  class Harness { stopManagedProcess() {} }
  class Controller { constructor(value) { options = value; } async close() {} }
  class Runtime { constructor(value) { runtimeOptions = value; } }
  const production = await createProductionController({
    credentials: {}, typertGateway: { invoke() {}, stream() {} }, logger: () => ({ error() {}, warn() {} }),
  }, { dataDir: root }, {
    ConfigStore, HarnessClient: Harness, Controller, Runtime,
    createConnectionSupervisor: () => ({ ready: Promise.resolve(), start() { return this; }, async close() {} }),
  });
  t.after(() => production.close());
  await options.createRuntime({ botId: 'qq_memory', config: { appId: 'app' }, appSecret: 'secret' });
  runtimeOptions.groupMemory.setEnabled(true);
  runtimeOptions.groupMemory.record('group:a', { messageId: 'one', senderId: 'member', content: 'text' });
  await runtimeOptions.groupMemory.close();
  const path = join(root, 'bots/qq_memory/group-memory.sqlite');
  await stat(path);
  for (const suffix of ['-wal', '-shm']) await writeFile(path + suffix, 'disposable test sidecar');
  await options.deleteState({ botId: 'qq_memory' });
  for (const suffix of ['', '-wal', '-shm']) await assert.rejects(stat(path + suffix), { code: 'ENOENT' });
});
