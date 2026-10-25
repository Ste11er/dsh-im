import assert from 'node:assert/strict';
import test from 'node:test';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { loadDeferredImages } from '../../helpers/deferred-images.mjs';
import { imageInputLimits } from '../../../src/channels/shared/image-input-policy.mjs';
import { configuredAccessPolicy } from '../access-policy-fixture.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
let sequence = 0;
function group(content, extra = {}) {
  const messageId = `context-image-${++sequence}`;
  return { kind: 'group', timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', groupOpenid: 'group-a',
    senderId: 'member', senderIsBot: false, content, messageId,
    replyTarget: { scope: 'group', targetId: 'group-a', msgId: messageId }, ...extra };
}

function fixture({ maxImages = 20, onAsk, fetchImpl, ...options } = {}) {
  const seen = new Set();
  const sessions = new Map();
  const prompts = [];
  const sent = [];
  const downloads = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async (_target, text) => sent.push(text) },
    ownerUserOpenid: '*', groupContextEnabled: true,
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id),
      sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id),
      clearSession: async key => sessions.delete(key) },
    harness: { createSession: async () => 'session', sessionExists: async () => true,
      getImageInputLimits: async () => ({ ...imageInputLimits(), maxImages }),
      ask: async (_id, content, options) => {
        prompts.push(await loadDeferredImages(content, options));
        await onAsk?.(prompts.length);
        return 'answer';
      } },
    fetchImpl: async (...args) => { downloads.push(String(args[0])); return fetchImpl ? fetchImpl(...args) : new Response(PNG); },
    ...options,
  });
  return { bridge, prompts, sent, downloads };
}

const image = name => ({ content_type: 'image/png', filename: `${name}.png`,
  url: `https://multimedia.nt.qq.com.cn/download/${name}` });
const question = (extra = {}) => group('图发出来了，解释一下', { rawEventType: 'GROUP_AT_MESSAGE_CREATE', ...extra });
const textOf = content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');

test('autonomous participation considers pure pictures and passes real images into the shared reply', async () => {
  const judged = [];
  const f = fixture({ groupParticipation: { enabled: true, cooldownSeconds: 1 },
    participationReply: async options => {
      judged.push(options);
      const judgeInput = await loadDeferredImages(options.content, options);
      assert.equal(judgeInput.filter(part => part.type === 'image').length, 1);
      return options.reply();
    } });
  await f.bridge.accept(group('', { attachments: [image('autonomous')] }));
  assert.equal(judged.length, 1, 'pure images must reach the semantic judge');
  assert.equal(judged[0].images.length, 1);
  assert.equal(f.prompts[0].filter(part => part.type === 'image').length, 1);
  assert.match(textOf(f.prompts[0]), /imageIndexes/);
  assert.deepEqual(f.downloads, [image('autonomous').url], 'judge and reply share this turn’s downloaded original');
});

test('QQ sends a preceding unmentioned image as a real image on the next group question', async () => {
  const f = fixture();
  const incoming = group('', { attachments: [image('diagram')] });
  await f.bridge.accept(incoming);
  await f.bridge.accept({ ...incoming });
  assert.equal(f.downloads.length, 0, 'ambient collection only remembers a lazy image source');
  assert.equal(f.prompts.length, 0);
  assert.equal(f.sent.length, 0);
  await f.bridge.accept(question());
  const parts = Array.isArray(f.prompts[0]) ? f.prompts[0] : [];
  assert.equal(parts.filter(part => part.type === 'image').length, 1,
    'the preceding group image must reach Harness as an image, not only a textual placeholder');
  assert.equal(f.downloads.length, 1);
  assert.equal(Buffer.from(parts.find(part => part.type === 'image').data, 'base64').equals(PNG), true);
  assert.match(textOf(parts), /"imageIndexes":\[1\]/);
  assert.doesNotMatch(textOf(parts), /multimedia|https:/);
});

test('QQ keeps current images first and includes the newest context images within configured limits', async () => {
  const f = fixture({ maxImages: 2 });
  await f.bridge.accept(group('old', { attachments: [image('old')] }));
  await f.bridge.accept(group('recent', { attachments: [image('recent-1'), image('recent-2')] }));
  await f.bridge.accept(question({ attachments: [image('current')] }));
  assert.deepEqual(f.downloads, [image('current').url, image('recent-2').url]);
  assert.deepEqual(f.prompts[0].filter(part => part.type === 'image').map(part => part.name), ['current.png', 'recent-2.png']);
  const text = textOf(f.prompts[0]);
  assert.match(text, /"text":"old"[^\n]*?"omittedImages":1/);
  assert.match(text, /"text":"recent"[^\n]*?"imageIndexes":\[2\],"omittedImages":1/);
});

test('QQ rejects forbidden image sources before recording and keeps group images isolated', async () => {
  const policy = configuredAccessPolicy({ channel: 'qq', config: { ownerUserOpenid: '*' } });
  policy.getSettings().group.allowlist.users = [{ id: 'member', canExecuteCommands: false }];
  const f = fixture({ accessPolicy: policy });
  await f.bridge.accept(group('', { senderId: 'blocked', attachments: [image('private')] }));
  await f.bridge.accept(group('', { attachments: [image('group-a')] }));
  await f.bridge.accept(question({ groupOpenid: 'group-b' }));
  assert.equal(f.downloads.length, 0);
  await f.bridge.accept(question());
  assert.deepEqual(f.downloads, [image('group-a').url]);
  assert.equal(f.bridge.status.groupContextRejected, 1);
});

test('QQ drops a busy group question without downloading cached-context pictures', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture({ onAsk: async count => { if (count === 1) { started(); await blocked; } } });
  const first = f.bridge.accept(question());
  await entered;
  await f.bridge.accept(group('', { attachments: [image('before')] }));
  const second = f.bridge.accept(question());
  await f.bridge.accept(group('', { attachments: [image('after')] }));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(await second, { outcome: 'dropped', reason: 'busy' });
});

test('QQ local commands and disabled context do not download historical pictures', async () => {
  const f = fixture();
  await f.bridge.accept(group('', { attachments: [image('old')] }));
  await f.bridge.accept(question({ content: '/new' }));
  assert.equal(f.prompts.length, 0);
  assert.equal(f.downloads.length, 0);
  f.bridge.setGroupContextEnabled(false);
  f.bridge.setGroupContextEnabled(true);
  await f.bridge.accept(question());
  assert.equal(f.downloads.length, 0);
  assert.equal(textOf(f.prompts[0]), '图发出来了，解释一下');
});

test('QQ reports a failed historical image download without claiming that a model saw it', async () => {
  const f = fixture({ fetchImpl: async () => new Response(null, { status: 403 }), logger: { error() {} } });
  await f.bridge.accept(group('', { attachments: [image('expired')] }));
  await f.bridge.accept(question());
  assert.equal(f.downloads.length, 1);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0], /图片下载失败/);
});
