import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.resolve('@tencent-connect/qqbot-nodejs'));
const { WebSocketServer } = require('ws');
import test from 'node:test';
import { QqConnectedBot } from '../../../src/channels/qq/gateway-connection.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function service(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
function botAt(baseUrl) {
  const bot = new QqConnectedBot({ appId: 'fixture', appSecret: 'fixture', baseUrl, tokenBaseUrl: baseUrl,
    connectionTokenTimeoutMs: 40, connectionGatewayTimeoutMs: 40 });
  bot.abortController = new AbortController();
  return bot;
}

test('token body timeout aborts the actual HTTP request and permits a fresh singleflight fetch', { timeout: 2000 }, async t => {
  let requests = 0, closed = 0;
  const base = await service(t, (req, res) => {
    requests++; req.resume();
    if (requests === 1) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"access_token":'); res.once('close', () => closed++); }
    else res.end(JSON.stringify({ access_token: 'fixture-token', expires_in: 7200 }));
  });
  const bot = botAt(base);
  t.after(() => bot.abortController.abort());
  const fetch = () => bot.tokenManager.getAccessToken('fixture', 'fixture');
  const result = await Promise.race([fetch().then(() => 'success', error => error), delay(350).then(() => 'stuck')]);
  assert.notEqual(result, 'stuck', 'SDK token body must not hang beyond the full request timeout');
  assert.equal(result.code, 'qq-token-timeout');
  for (let i = 0; closed === 0 && i < 20; i++) await delay(5);
  assert.equal(closed, 1, 'timeout must terminate the real response body');
  assert.equal(await fetch(), 'fixture-token');
  assert.equal(await fetch(), 'fixture-token');
  assert.equal(requests, 2, 'SDK cache and singleflight remain in control');
});

test('gateway body timeout ends discovery and releases its real HTTP socket', { timeout: 2000 }, async t => {
  let closed = false;
  const base = await service(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"url":'); res.once('close', () => { closed = true; });
  });
  const bot = botAt(base); bot.tokenManager.getAccessToken = async () => 'fixture';
  t.after(() => bot.abortController.abort());
  const result = await Promise.race([bot.messageApi.getGatewayUrl(bot.creds).then(() => 'success', error => error), delay(350).then(() => 'stuck')]);
  assert.notEqual(result, 'stuck', 'discovery cannot remain in recovering forever while reading the body');
  assert.equal(result.code, 'qq-gateway-timeout');
  for (let i = 0; !closed && i < 20; i++) await delay(5);
  assert.equal(closed, true);
});

test('stopping the bot cancels token body reads before the deadline', { timeout: 2000 }, async t => {
  let received; const started = new Promise(resolve => { received = resolve; });
  const base = await service(t, (req, res) => { req.resume(); res.writeHead(200); res.write('{'); received(); });
  const bot = botAt(base);
  const pending = bot.tokenManager.getAccessToken('fixture', 'fixture');
  await started; bot.abortController.abort();
  const result = await pending.catch(error => error);
  assert.equal(result.name, 'AbortError');
});

test('gateway and token responses validate required data and preserve API failure identity', { timeout: 2000 }, async t => {
  let response = { url: 0 };
  const base = await service(t, (_req, res) => res.end(JSON.stringify(response)));
  const bot = botAt(base); bot.tokenManager.getAccessToken = async () => 'fixture';
  t.after(() => bot.abortController.abort());
  await assert.rejects(bot.messageApi.getGatewayUrl(bot.creds), { code: 'qq-gateway-invalid-response' });
  response = { access_token: 'fixture', expires_in: 0 };
  await assert.rejects(bot.tokenManager.doFetchToken('fixture', 'fixture'), { code: 'qq-token-invalid-response' });
});

test('a real bot stopped during token initialization finishes its start task', { timeout: 2000 }, async t => {
  let received; const started = new Promise(resolve => { received = resolve; });
  const base = await service(t, (req, res) => { req.resume(); res.writeHead(200); res.write('{'); received(); });
  const bot = new QqConnectedBot({ appId: 'fixture', appSecret: 'fixture', tokenBaseUrl: base, tokenPrefetch: 'async',
    connectionTokenTimeoutMs: 500, connectionGatewayTimeoutMs: 500 });
  let settled = false;
  const task = bot.start().finally(() => { settled = true; });
  t.after(() => bot.stop());
  await started; bot.stop();
  await Promise.race([task, delay(150)]);
  assert.equal(settled, true, 'stop cannot leave start() waiting on an abort event that already happened');
});

test('real QQBot resumes message delivery after a dropped socket and a stalled discovery body', { timeout: 6000 }, async t => {
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => ws.once('listening', resolve));
  let peer, connections = 0, discovery = 0, bodyClosed = false;
  ws.on('connection', socket => {
    peer = socket; connections++;
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 100 } }));
    socket.on('message', bytes => {
      const frame = JSON.parse(bytes);
      if ([2, 6].includes(frame.op)) socket.send(JSON.stringify({ op: 0, s: connections, t: frame.op === 2 ? 'READY' : 'RESUMED',
        d: frame.op === 2 ? { session_id: 'local-fixture', user: { id: 'bot' } } : {} }));
      if (frame.op === 1) socket.send(JSON.stringify({ op: 11 }));
    });
  });
  const base = await service(t, (req, res) => {
    req.resume();
    if (req.url === '/app/getAppAccessToken') { res.end(JSON.stringify({ access_token: 'fixture-token', expires_in: '7200' })); return; }
    discovery++;
    if (discovery === 2) { res.writeHead(200); res.write('{"url":'); res.once('close', () => { bodyClosed = true; }); }
    else res.end(JSON.stringify({ url: `ws://127.0.0.1:${ws.address().port}` }));
  });
  const states = [], messages = [];
  const bot = new QqConnectedBot({ appId: 'fixture', appSecret: 'fixture', baseUrl: base, tokenBaseUrl: base,
    connectionGatewayTimeoutMs: 100, onConnectionState: state => states.push(state) });
  bot.on('message', (_ctx, message) => messages.push(message));
  const task = bot.start();
  t.after(async () => { bot.stop(); for (const socket of ws.clients) socket.terminate(); await task; await new Promise(resolve => ws.close(resolve)); });
  const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'recovery did not complete'); await delay(5); } };
  await until(() => bot.gateway?.health.state === 'connected');
  peer.terminate();
  await until(() => discovery >= 3 && connections === 2 && bot.gateway.health.state === 'connected');
  assert.equal(bodyClosed, true);
  assert.ok(states.some(state => state.lastDisconnect?.reason === 'qq-gateway-timeout'));
  assert.equal(bot.gateway.health.lastDisconnect.reason, 'qq-gateway-timeout', 'cause survives RESUMED');
  assert.equal(bot.gateway.health.reconnects, 2);
  peer.send(JSON.stringify({ op: 0, s: 3, t: 'GROUP_MESSAGE_CREATE', d: { id: 'group-fixture', group_openid: 'group', author: { member_openid: 'member' }, content: 'fixture' } }));
  peer.send(JSON.stringify({ op: 0, s: 4, t: 'C2C_MESSAGE_CREATE', d: { id: 'private-fixture', author: { user_openid: 'member' }, content: 'fixture' } }));
  await until(() => messages.length === 2);
  assert.deepEqual(messages.map(message => message.kind), ['group', 'c2c']);
  assert.ok(bot.gateway.health.events.length <= 32);
});

test('gateway rate limits retain the SDK sixty second backoff', { timeout: 2000 }, async t => {
  const base = await service(t, (_req, res) => { res.writeHead(429); res.end(JSON.stringify({ code: 100001 })); });
  const bot = botAt(base);
  bot.initToken = async () => {};
  bot.tokenManager.getAccessToken = async () => 'fixture';
  const task = bot.start();
  t.after(async () => { bot.stop(); await task; });
  const end = Date.now() + 1000;
  while (!bot.gateway?.reconnectTimer) { assert.ok(Date.now() < end); await delay(5); }
  assert.equal(bot.gateway.reconnectTimer._idleTimeout, 60000);
  assert.equal(bot.gateway.health.lastDisconnect.httpStatus, 429);
});
