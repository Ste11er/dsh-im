import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { withQqImageDownloadBudget, isQqImageDownloadTimeout, QQ_IMAGE_DOWNLOAD_TIMEOUT_MS } from '../../../src/channels/qq/image-download.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { loadDeferredImages } from '../../helpers/deferred-images.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { stageInboundFiles } from '../../../src/channels/shared/inbound-file.mjs';
import { inboundImagesAsFiles } from '../../../src/channels/shared/image-input.mjs';
import { imageInputLimits } from '../../../src/channels/shared/image-input-policy.mjs';

test('a QQ image timeout aborts the actual download and ignores bytes arriving later', async () => {
  let networkSignal, complete;
  const images = withQqImageDownloadBudget([{ load({ signal }) { networkSignal = signal; return new Promise(resolve => { complete = resolve; }); } }], { timeoutMs: 20 });
  await assert.rejects(images[0].load(), isQqImageDownloadTimeout);
  assert.equal(networkSignal.aborted, true);
  complete(Buffer.from('late image'));
  await assert.rejects(images[0].load(), isQqImageDownloadTimeout);
  assert.equal(QQ_IMAGE_DOWNLOAD_TIMEOUT_MS, 5000);
});

test('the whole image batch shares its deadline instead of renewing it for each image', async () => {
  let lastCalled = false;
  const images = withQqImageDownloadBudget([
    { load: async () => { await new Promise(resolve => setTimeout(resolve, 18)); return Buffer.from('first'); } },
    { load: async ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) },
    { load: async () => { lastCalled = true; return Buffer.from('third'); } },
  ], { timeoutMs: 35 });
  assert.equal((await images[0].load()).toString(), 'first');
  await assert.rejects(images[1].load(), isQqImageDownloadTimeout);
  await assert.rejects(images[2].load(), isQqImageDownloadTimeout);
  assert.equal(lastCalled, false);
});

test('a stalled real HTTP response body is aborted after its headers have arrived', async t => {
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png' }); response.write(Buffer.from('partial'));
    response.on('close', closed);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const images = withQqImageDownloadBudget([{ load: async ({ signal }) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { signal });
    return Buffer.from(await response.arrayBuffer());
  } }], { timeoutMs: 75 });
  await assert.rejects(images[0].load(), isQqImageDownloadTimeout);
  await disconnected;
});

test('timeout survives the real image-as-file ingress wrapper and removes partial staging', async t => {
  const workspace = await mkdtemp('/tmp/qq-image-stage-timeout-');
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const images = withQqImageDownloadBudget([{ load: async () => new Promise(() => {}) }], { timeoutMs: 20 });
  const files = inboundImagesAsFiles(images, imageInputLimits());
  await assert.rejects(stageInboundFiles({ files }, { workspace }), error => {
    assert.equal(error.code, 'inbound-file-download-failed');
    assert.equal(isQqImageDownloadTimeout(error), true); return true;
  });
  assert.deepEqual(await readdir(`${workspace}/.dsh-im/inbound`), []);
});

function fixture({ participationReply, ...options } = {}) {
  const seen = new Set(), sessions = new Map(), sent = [], accepted = [], signals = [];
  const bridge = new QqHarnessBridge({ bot: { sendText: async (_target, text) => sent.push(text) }, ownerUserOpenid: '*',
    groupContextEnabled: true, imageDownloadTimeoutMs: 20, logger: { info() {}, error() {} },
    ...(participationReply ? { participationReply, groupParticipation: { enabled: true, cooldownSeconds: 1 } } : {}),
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    harness: { createSession: async () => 'session', sessionExists: async () => true, getImageInputLimits: async () => imageInputLimits(),
      ask: async (_id, content, config) => { await loadDeferredImages(content, config); accepted.push(content); return 'answer'; } },
    fetchImpl: async (_url, { signal }) => { signals.push(signal); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
    ...options });
  return { bridge, seen, sent, accepted, signals };
}
const message = (id, { kind = 'group', ambient = false, image = false } = {}) => ({ messageId: id, senderId: 'member', kind,
  groupOpenid: 'group', timestamp: new Date().toISOString(), content: image ? '看图' : '现在继续聊天',
  rawEventType: kind === 'c2c' ? 'C2C_MESSAGE_CREATE' : ambient ? 'GROUP_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE',
  replyTarget: { scope: kind === 'group' ? 'group' : 'c2c', targetId: kind === 'group' ? 'group' : 'member', msgId: id },
  ...(image ? { attachments: [{ content_type: 'image/png', filename: 'picture.png', url: 'https://multimedia.nt.qq.com.cn/download/fixture' }] } : {}) });

test('a timed-out group image is silently dropped, deduplicated and removed from future context', async () => {
  const f = fixture();
  await f.bridge.accept(message('stuck', { image: true }));
  assert.equal(f.sent.length, 0); assert.equal(f.accepted.length, 0); assert.equal(f.seen.has('stuck'), true);
  assert.equal(f.signals[0].aborted, true);
  await f.bridge.accept(message('text'));
  assert.deepEqual(f.sent, ['answer']); assert.equal(f.signals.length, 1, 'expired image must not be downloaded from history again');
  await f.bridge.accept(message('stuck', { image: true })); assert.equal(f.signals.length, 1);
});

test('a timed-out private image releases the queue for the next private message', async () => {
  const f = fixture();
  const slow = f.bridge.accept(message('private-image', { kind: 'c2c', image: true }));
  const next = f.bridge.accept(message('private-text', { kind: 'c2c' }));
  await Promise.all([slow, next]); await f.bridge.waitForIdle();
  assert.equal(f.sent.filter(text => text === 'answer').length, 1);
  assert.equal(f.sent.some(text => /下载失败|MF-/.test(text)), false);
  assert.equal(f.accepted.length, 1); assert.equal(f.signals[0].aborted, true);
});

test('ambient judgment image timeout ends participation without sending a failure reply', async () => {
  let judgments = 0;
  const f = fixture({ participationReply: async options => { judgments++; await loadDeferredImages(options.content, options); return options.reply(); } });
  await f.bridge.accept(message('ambient-image', { ambient: true, image: true }));
  assert.equal(judgments, 1); assert.equal(f.sent.length, 0); assert.equal(f.seen.has('ambient-image'), true);
  await f.bridge.accept(message('next-mention'));
  assert.equal(f.signals.length, 1); assert.deepEqual(f.sent, ['answer']);
});
