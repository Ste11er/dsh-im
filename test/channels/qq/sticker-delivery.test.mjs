import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqStickerCatalog } from '../../../src/channels/qq/sticker-catalog.mjs';
import { createQqStickerTool } from '../../../plugin-src/host/channels/qq/sticker-tool.mjs';
import { OutboundArtifactRegistry, createOutboundArtifactTool, materializeOutboundArtifact } from '../../../src/channels/shared/semantic/artifact.mjs';

// A scripted Agent selects a real catalog record through the production tools.
// Only the external catalog HTTP and QQ SDK transport are replaced.
test('QQ group sticker travels from catalog search through authoritative registration to a native image reply', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-sticker-delivery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  const item = { id: 'sticker_happy', slug: 'happy', name: '开心', description: '开心地笑', tags: ['开心'], status: 'published', characterIds: ['deepseek'], categoryIds: ['meme'],
    path: 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/happy.png', sha256: createHash('sha256').update(PNG).digest('hex') };
  let allowNetwork = true;
  const catalog = new QqStickerCatalog({ directory, fetchImpl: async url => {
    assert.equal(allowNetwork, true, 'reply must use the preloaded cache without network');
    url = String(url);
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'a'.repeat(40) });
    if (url.endsWith('/data/works.json')) return Response.json([item]);
    if (url.endsWith('/data/blue-fish-classification.json')) return Response.json([]);
    if (url.endsWith('/data/blue-fish-editorial.json') || url.endsWith('/data/blue-fish-ids.json')) return Response.json({});
    assert.equal(url, item.path);
    return new Response(PNG);
  } });
  const preload = await catalog.prefetch({ maxBytes: 1024 });
  assert.equal(preload.ready, 1); assert.deepEqual(preload.failures, []);
  allowNetwork = false;
  const registry = new OutboundArtifactRegistry();
  t.after(() => registry.clear());
  const sticker = createQqStickerTool({ registry, catalog }).definition;
  const files = createOutboundArtifactTool({ registry });
  const images = []; const texts = [];
  const target = { scope: 'group', targetId: 'group-a', msgId: 'message-one' };
  const seen = new Set(); const sessions = new Map();
  const bridge = new QqHarnessBridge({
    stickersEnabled: true, ownerUserOpenid: '*',
    bot: { sendText: async (_target, text) => { texts.push(text); return { message: { id: 'text' } }; },
      sendImage: async (replyTarget, source) => { images.push({ target: replyTarget, bytes: source.buffer }); return { message: { id: 'image' } }; } },
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    harness: { createSession: async () => 'session-stickers', sessionExists: async () => true,
      materializeArtifact: materializeOutboundArtifact,
      ask: async (id, _text, options) => {
        const agent = { session: { header: { id, cwd: directory }, events: [{ type: 'turn/start', data: { turn: 1 } }] } };
        const close = registry.openConsumer(id, 'rpc-stickers', options.deliveryContext);
        try {
          registry.observeClaimedMessage(agent.session, { source: { rpcId: 'rpc-stickers' } }, 1);
          const exec = { agent, signal: options.signal, token: Symbol('sticker'), callId: 'sticker-call', rootCallId: 'sticker-call', name: 'dsh_qq_sticker' };
          const search = await sticker.execute({ query: '开心' }, exec);
          const cached = search.items[0];
          assert.ok(cached.path, 'search must provide the cached path directly');
          const fileExec = { ...exec, name: 'dsh_im_return_file', callId: 'file-call', rootCallId: 'file-call', token: Symbol('file') };
          await files.definition.execute({ path: cached.path }, fileExec);
          assert.equal(registry.take(id, 1).length, 0, 'no delivery before authoritative tool result');
          files.onResult(fileExec, { isError: false });
          registry.observeSessionEvent(agent.session, { type: 'turn/end', data: { turn: 1 } });
          for (const artifact of registry.take(id, 1)) await options.onArtifact(artifact);
          return '好耶！';
        } finally { close(); }
      } },
  });
  const receipt = await bridge.accept({ kind: 'group', rawEventType: 'GROUP_AT_MESSAGE_CREATE', groupOpenid: 'group-a', senderId: 'member', content: '今天很开心', messageId: 'message-one', replyTarget: target });
  assert.deepEqual(texts, ['好耶！']);
  assert.equal(images.length, 1);
  assert.equal(images[0].target, target);
  assert.deepEqual(images[0].bytes, PNG);
  assert.equal(receipt.artifacts[0].outcome, 'sent');
});
