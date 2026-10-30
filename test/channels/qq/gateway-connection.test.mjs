import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { QqGatewayConnection, QqConnectedBot } from '../../../src/channels/qq/gateway-connection.mjs';
const require = createRequire(import.meta.resolve('@tencent-connect/qqbot-nodejs'));
const { WebSocketServer } = require('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, { ack = true, hello = true } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const abort = new AbortController(); const states = [];
  let connections = 0, heartbeats = 0;
  server.on('connection', socket => {
    connections++;
    if (hello) socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 25 } }));
    socket.on('message', data => {
      const frame = JSON.parse(data);
      if (frame.op === 2) socket.send(JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'fixture' } }));
      if (frame.op === 6) socket.send(JSON.stringify({ op: 0, s: 2, t: 'RESUMED', d: {} }));
      if (frame.op === 1) { heartbeats++; if (ack) socket.send(JSON.stringify({ op: 11 })); }
    });
  });
  const gateway = new QqGatewayConnection({ account: { accountId: 'offline-fixture' }, abortSignal: abort.signal,
    getAccessToken: async () => 'fixture', getGatewayUrl: async () => `ws://127.0.0.1:${server.address().port}`,
    onMessage() {} }, { connectTimeoutMs: 100, onState: status => states.push(status) });
  const task = gateway.start();
  t.after(async () => { abort.abort(); for (const socket of server.clients) socket.terminate(); await task; await new Promise(resolve => server.close(resolve)); });
  const until = async predicate => { const deadline = Date.now() + 2500; while (!predicate()) { assert.ok(Date.now() < deadline, 'gateway condition timed out'); await delay(5); } };
  return { gateway, states, until, get connections() { return connections; }, get heartbeats() { return heartbeats; }, server };
}

test('missing ACK disconnects a silently dead socket and recovers through the SDK reconnect loop', async t => {
  const f = await fixture(t, { ack: false });
  await f.until(() => f.states.some(row => row.disconnectReason === 'gateway-heartbeat-timeout'));
  assert.equal(f.gateway.health.state, 'reconnecting');
  await f.until(() => f.connections >= 2);
  assert.ok(f.heartbeats >= 1);
});

test('quiet groups with successful heartbeat ACKs stay connected', async t => {
  const f = await fixture(t);
  await f.until(() => f.heartbeats >= 4 && f.gateway.health.lastHeartbeatAckAt >= f.gateway.health.lastHeartbeatAt);
  assert.equal(f.connections, 1); assert.equal(f.gateway.health.state, 'connected');
  assert.ok(f.gateway.health.lastFrameAt >= f.gateway.health.lastHeartbeatAt);
});

test('a socket that never sends HELLO is not allowed to remain connected forever', async t => {
  const f = await fixture(t, { hello: false });
  await f.until(() => f.states.some(row => row.disconnectReason === 'gateway-hello-timeout'));
  assert.equal(f.gateway.health.state, 'reconnecting');
});

test('late close from an old socket cannot tear down its replacement', async t => {
  const f = await fixture(t);
  await f.until(() => f.gateway.health.state === 'connected');
  const retired = f.gateway.currentWs;
  await f.gateway.connect();
  const replacement = f.gateway.currentWs;
  assert.notEqual(replacement, retired);
  retired.emit('close', 1006, Buffer.alloc(0));
  assert.equal(f.gateway.currentWs, replacement);
  await f.until(() => f.gateway.health.state === 'connected' && f.connections === 2);
});

test('the real QQBot facade delivers successive group and private events through the monitored gateway', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  let socket; const messages = [], health = [];
  server.on('connection', peer => {
    socket = peer; peer.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 25 } }));
    peer.on('message', data => {
      const frame = JSON.parse(data);
      if (frame.op === 2) peer.send(JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'facade', user: { id: 'bot' } } }));
      if (frame.op === 1) peer.send(JSON.stringify({ op: 11 }));
    });
  });
  const bot = new QqConnectedBot({ appId: 'fixture', appSecret: 'fixture', onConnectionState: state => health.push(state) });
  bot.initToken = async () => {};
  bot.tokenManager.getAccessToken = async () => 'fixture';
  bot.messageApi.getGatewayUrl = async () => `ws://127.0.0.1:${server.address().port}`;
  bot.on('message', (_ctx, message) => messages.push(message));
  const ready = new Promise(resolve => bot.on('ready', resolve));
  const task = bot.start();
  t.after(async () => { bot.stop(); for (const peer of server.clients) peer.terminate(); await task; await new Promise(resolve => server.close(resolve)); });
  await ready;
  for (const [index, event] of ['GROUP_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE'].entries()) {
    socket.send(JSON.stringify({ op: 0, s: index + 2, t: event, d: { id: `m${index}`, group_openid: 'group',
      author: { member_openid: 'member', user_openid: 'member' }, content: 'fixture', timestamp: new Date().toISOString() } }));
  }
  const deadline = Date.now() + 1000;
  while (messages.length < 3) { assert.ok(Date.now() < deadline); await delay(5); }
  assert.deepEqual(messages.map(message => message.kind), ['group', 'group', 'c2c']);
  assert.equal(bot.gateway.health.messageEventsReceived, 3);
  assert.equal(bot.gateway.health.dispatchesReceived, 4);
  assert.ok(bot.gateway.health.lastMessageEventAt >= bot.gateway.health.lastReadyAt);
  assert.ok(health.some(row => row.state === 'connected'));
});

test('server-requested reconnect keeps a reason and counts recovery after RESUMED', async t => {
  const f = await fixture(t);
  await f.until(() => f.gateway.health.state === 'connected');
  [...f.server.clients][0].send(JSON.stringify({ op: 7 }));
  await f.until(() => f.connections === 2 && f.gateway.health.state === 'connected');
  assert.equal(f.gateway.health.reconnects, 1, 'server reconnect must not disappear because cleanup retires its socket');
  assert.equal(f.gateway.health.lastDisconnect.reason, 'gateway-server-reconnect');
  assert.ok(f.gateway.health.events.some(event => event.reason === 'gateway-server-reconnect'));
  assert.ok(f.gateway.health.events.some(event => event.state === 'connected' && event.at >= f.gateway.health.lastDisconnect.at));
});

test('socket closure code and cause remain visible after successful recovery', async t => {
  const f = await fixture(t);
  await f.until(() => f.gateway.health.state === 'connected');
  [...f.server.clients][0].terminate();
  await f.until(() => f.connections === 2 && f.gateway.health.state === 'connected');
  assert.equal(f.gateway.health.lastDisconnect.closeCode, 1006);
  assert.equal(f.gateway.health.lastDisconnect.reason, 'gateway-socket-closed');
  assert.equal(f.gateway.health.disconnectReason, null, 'current state and last failure are distinct');
  const snapshot = f.gateway.health;
  snapshot.events.length = 0;
  assert.ok(f.gateway.health.events.length > 0, 'public snapshots cannot erase retained evidence');
});
