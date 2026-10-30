import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { QqGroupReception } from '../../../src/channels/qq/group-reception.mjs';
import { QqRuntime } from '../../../src/channels/qq/qq-runtime.mjs';

test('group reception separates raw gateway delivery from locally recognized mentions without storing content', () => {
  let now = 123;
  const reception = new QqGroupReception({ now: () => now });
  reception.gateway({ eventType: 'GROUP_AT_MESSAGE_CREATE', data: { group_openid: 'private-group-1234', content: 'private text' } });
  reception.processed({ kind: 'group', groupOpenid: 'private-group-1234' }, true);
  reception.decision('private-group-1234', 'mention-accepted');
  const first = reception.status[0];
  assert.equal(first.gatewayMentions, 1); assert.equal(first.processedMentions, 1);
  assert.equal(first.ordinaryObserved, false);
  assert.doesNotMatch(JSON.stringify(first), /private-group|private text/);
  reception.gateway({ eventType: 'GROUP_MESSAGE_CREATE', data: { group_openid: 'second-group' } });
  reception.processed({ kind: 'group', groupOpenid: 'second-group' }, false);
  assert.equal(reception.status.length, 2);
  assert.equal(reception.status.find(row => row.id === first.id).gatewayOrdinary, 0);
  assert.equal(reception.status[0].ordinaryObserved, true);
  for (let i = 0; i < 120; i++) reception.decision(`g-${i}`, 'declined');
  assert.equal(reception.status.length, 100);
});

test('real runtime counts SDK message events without assuming rawEvent also fires for handled messages', async t => {
  class Bot extends EventEmitter {
    middlewares = [];
    use(middleware) { this.middlewares.push(middleware); }
    async sendText() {}
    async start(signal) { queueMicrotask(() => this.emit('ready', {})); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); }
    stop() {}
  }
  const bot = new Bot();
  const runtime = new QqRuntime({ config: { botId: 'qq_test', appId: 'app', ownerUserOpenid: '*' }, appSecret: 'secret',
    harness: { ensureRunning: async () => true }, state: { hasSeen: () => false },
    createBot: () => bot, typingMiddleware: () => async (_ctx, next) => next() });
  t.after(() => runtime.stop()); await runtime.start();
  const run = async (eventType, group, mentions) => {
    const ctx = { bot, message: { kind: 'group', groupOpenid: group, rawEventType: eventType, content: 'hello', mentions } };
    for (const middleware of bot.middlewares) await middleware(ctx, async () => {});
  };
  await run('GROUP_MESSAGE_CREATE', 'one', []);
  await run('GROUP_AT_MESSAGE_CREATE', 'two', []);
  await run('GROUP_MESSAGE_CREATE', 'three', [{ is_you: true }]);
  const rows = runtime.status.groupReception;
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.label.endsWith('one')).gatewayOrdinary, 1);
  assert.equal(rows.find(row => row.label.endsWith('two')).gatewayMentions, 1);
  assert.equal(rows.find(row => row.label.endsWith('hree')).processedMentions, 1);
});

test('group diagnostic panel distinguishes missing ordinary delivery from model-declined replies', async () => {
  const React = await import('react'); const { default: Renderer, act } = await import('react-test-renderer');
  const { GroupReceptionStatus } = await import('../../../plugin-src/client/channels/qq/reception-status.js');
  let renderer;
  act(() => { renderer = Renderer.create(React.createElement(GroupReceptionStatus, { groups: [
    { id: 'one', label: '群标识 …1234', gatewayMentions: 2, gatewayOrdinary: 0, processedMentions: 2, processedOrdinary: 0, ordinaryObserved: false, lastDecision: 'mention-accepted' },
    { id: 'two', label: '群标识 …5678', gatewayMentions: 0, gatewayOrdinary: 5, processedMentions: 0, processedOrdinary: 5, ordinaryObserved: true, lastDecision: 'declined' },
  ] })); });
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 1);
  const text = JSON.stringify(renderer.toJSON());
  assert.match(text, /模型决定保持安静/); assert.match(text, /尚未收到此群普通消息/);
  assert.match(text, /群主在手机 QQ/); assert.match(text, /每个群需分别设置/);
  act(() => renderer.unmount());
});
