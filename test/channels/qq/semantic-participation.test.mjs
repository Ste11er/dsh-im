import assert from 'node:assert/strict';
import test from 'node:test';
import { QqGroupContext } from '../../../src/channels/qq/group-context.mjs';
import { QqGroupParticipation } from '../../../src/channels/qq/group-participation.mjs';
import { createGroupParticipationReply } from '../../../plugin-src/host/channels/qq/group-participation-reply.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';

test('semantic utterances retain unresolved fragments by speaker, not by gaps or other speakers', () => {
  const context = new QqGroupContext();
  context.record('g', { messageId: '1', senderId: 'a', content: '大肥鱼，我有个问题' }, 1000);
  const first = context.utterance('g', 'a', { now: 1000 });
  context.record('g', { messageId: '2', senderId: 'b', content: '今天好热' }, 2000);
  context.record('g', { messageId: '3', senderId: 'a', content: '这张图里的公式' }, 60000);
  const next = context.utterance('g', 'a', { now: 60000 });
  assert.deepEqual(next.messages.map(row => row.text), ['大肥鱼，我有个问题', '这张图里的公式']);
  context.consumeUtterance(first);
  assert.deepEqual(context.utterance('g', 'a', { now: 60000 }).messages.map(row => row.text), ['这张图里的公式']);
  assert.deepEqual(context.utterance('g', 'b', { now: 60000 }).messages.map(row => row.text), ['今天好热']);
  context.clear();
  assert.equal(context.utterance('g', 'a'), null);
});

test('new input invalidates a judgment in flight, coalesces latest input and never flushes WAIT on a timer', async () => {
  const p = new QqGroupParticipation(); p.set({ enabled: true, cooldownSeconds: 1 });
  let release; const held = new Promise(resolve => { release = resolve; });
  const observed = [];
  const first = p.consider('g', async (signal, control) => {
    observed.push('first'); await held;
    if (control.beginReply()) observed.push('stale reply');
    signal.throwIfAborted();
  }, { coalesce: true });
  await p.consider('g', async () => { observed.push('middle'); return '[[QQ_WAIT_MORE]]'; }, { coalesce: true });
  await p.consider('g', async () => { observed.push('latest'); return '[[QQ_WAIT_MORE]]'; }, { coalesce: true });
  release(); await first; await p.whenIdle();
  assert.deepEqual(observed, ['first', 'latest']);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.deepEqual(observed, ['first', 'latest'], 'waiting alone must never trigger a reply or re-assessment');
  assert.equal(p.status.replied, 0);
});

test('native judge accepts semantic WAIT without replying or treating it as failure', async () => {
  let system; let replied = 0;
  const ctx = { get: name => name === 'agents' ? { create: async options => {
    options.setup({ get: key => key === 'tools' ? { guard() {}, presentAs() {}, restrict() {} } : { section: value => { system = value.text; } }, on() {} });
    return { agent: { followup() {}, whenIdle: async () => {}, cancel() {}, session: { snapshotEvents: () => [
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '[[QQ_WAIT_MORE]]' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ] } }, dispose: async () => {} };
  } } : undefined };
  const judge = createGroupParticipationReply(ctx, () => ({ provider: 'p', model: 'm' }));
  assert.equal(await judge({ content: '大肥鱼，如果', signal: new AbortController().signal, deliveryContext: {}, reply: async () => { replied++; } }), '[[QQ_WAIT_MORE]]');
  assert.equal(replied, 0); assert.match(system, /语义/); assert.match(system, /停顿/);
});

test('a new candidate replaces a queued assessment even when its cooldown timer wakes late', async () => {
  let offset = 0; const calls = [];
  const p = new QqGroupParticipation({ now: () => Date.now() + offset });
  p.set({ enabled: true, cooldownSeconds: 1 });
  await p.consider('g', async () => { calls.push('first'); return '[[QQ_WAIT_MORE]]'; }, { coalesce: true });
  await p.consider('g', async () => { calls.push('outdated'); return '[[QQ_WAIT_MORE]]'; }, { coalesce: true });
  offset = 2000;
  await p.consider('g', async () => { calls.push('latest'); return '[[QQ_WAIT_MORE]]'; }, { coalesce: true });
  await p.whenIdle();
  assert.deepEqual(calls, ['first', 'latest']);
});

const textOf = content => typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n');
const currentOf = content => JSON.parse(textOf(content).match(/<dsh_im_qq_current_message>\n(.*?)\n<\/dsh_im_qq_current_message>/s)[1]);
const message = (id, content, senderId = 'a', extra = {}) => ({ messageId: id, content, senderId, kind: 'group', groupOpenid: 'g',
  timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', replyTarget: { scope: 'group', targetId: 'g', msgId: id }, ...extra });
function bridgeFixture(judge, extra = {}) {
  const seen = new Set(); const sessions = new Map(); const prompts = []; const sent = [];
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', groupContextEnabled: true,
    groupParticipation: { enabled: true, cooldownSeconds: 1 },
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
    harness: { createSession: async () => 'shared', sessionExists: async () => true,
      ask: async (_id, content) => { prompts.push(content); return '合并后的回答'; } },
    bot: { sendText: async (target, text) => { sent.push({ target, text }); return { message: { id: 'sent' } }; } },
    participationReply: judge, ...extra,
  });
  return { bridge, prompts, sent };
}

test('bridge waits semantically, combines later fragments even across gaps, and consumes answered speech', async () => {
  const judged = [];
  const f = bridgeFixture(async options => {
    judged.push(currentOf(options.content));
    return judged.length === 1 ? '[[QQ_WAIT_MORE]]' : options.reply();
  });
  await f.bridge.accept(message('1', '大肥鱼，我想问一下'));
  assert.equal(f.bridge.participationStats.waiting, 1);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(judged.length, 1); assert.equal(f.sent.length, 0, 'silence cannot flush an incomplete utterance');
  await f.bridge.accept(message('2', '这张图的公式为什么这样算？'));
  assert.deepEqual(judged[1].map(row => row.text), ['大肥鱼，我想问一下', '这张图的公式为什么这样算？']);
  assert.equal(f.prompts.length, 1); assert.equal(f.sent.length, 1);
  await f.bridge.accept(message('3', '懂了，谢谢'));
  await f.bridge.waitForIdle();
  assert.deepEqual(judged[2].map(row => row.text), ['懂了，谢谢']);
  assert.match(textOf(f.prompts[1]), /"role":"assistant".*合并后的回答/);
});

test('native vision judgment uses admitted image blocks and text-only models receive explicit vision descriptions', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  for (const judgeVision of [true, false]) for (const replyVision of [true, false]) {
    let prompt; let admitted = 0; let described = 0; let replyOptions;
    const services = {
      llm: { resolveModelInfo: async (_provider, model) => ({ inputModalities: (model === 'judge' ? judgeVision : replyVision) ? ['text', 'image'] : ['text'] }) },
      attachments: { admitPromptContent: async content => { admitted++; return content.map(block => block.type === 'image' ? { type: 'image', attachment: { attachmentId: 'image' } } : block); } },
      agents: { create: async options => {
        options.setup({ get: key => key === 'tools' ? { guard() {}, presentAs() {}, restrict() {} } : { section() {} }, on() {} });
        return { agent: { followup: value => { prompt = value.content; }, whenIdle: async () => {}, cancel() {}, session: { snapshotEvents: () => [
          { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '[[QQ_REPLY]]' }] } } },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ] } }, dispose: async () => {} };
      } },
    };
    const judge = createGroupParticipationReply({ get: key => services[key] }, () => ({ provider: 'p', model: 'reply' }), {
      selectedJudgeModel: () => ({ provider: 'p', model: 'judge' }),
      describeImages: async () => { described++; return { text: '图片 1：蓝色鲸鱼' }; },
    });
    await judge({ content: [{ type: 'text', text: '看看这张图' }], images: [{ data: png }], signal: new AbortController().signal,
      deliveryContext: {}, reply: async options => { replyOptions = options; return {}; } });
    assert.equal(admitted, judgeVision ? 1 : 0);
    assert.equal(prompt.filter(block => block.type === 'image').length, judgeVision ? 1 : 0);
    if (!judgeVision) assert.match(textOf(prompt), /蓝色鲸鱼/);
    assert.equal(described, judgeVision && replyVision ? 0 : 1);
    assert.deepEqual(replyOptions, replyVision ? undefined : { imageDescription: '图片 1：蓝色鲸鱼' });
  }
});

test('image download failures remain failures and never become successful judgments', async () => {
  let created = 0;
  const services = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) },
    agents: { create: async () => { created++; } }, attachments: { admitPromptContent: async blocks => blocks } };
  const judge = createGroupParticipationReply({ get: key => services[key] }, () => ({ provider: 'p', model: 'm' }));
  await assert.rejects(judge({ content: '图', images: [{ load: async () => { throw new Error('403'); } }],
    signal: new AbortController().signal, deliveryContext: {}, reply: () => assert.fail('failed image must not reply') }), { code: 'image-download-failed' });
  assert.equal(created, 0);
});

test('bridge invalidates a real in-flight judgment and ignores its late approval', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  let started; const entered = new Promise(resolve => { started = resolve; });
  const judged = [];
  const f = bridgeFixture(async options => {
    judged.push(currentOf(options.content));
    if (judged.length === 1) { started(); await held; }
    return options.reply();
  });
  const first = f.bridge.accept(message('1', '如果把这个'));
  await entered;
  await f.bridge.accept(message('2', '分母改成零呢？'));
  release(); await first; await f.bridge.waitForIdle();
  assert.equal(f.sent.length, 1); assert.equal(f.prompts.length, 1);
  assert.deepEqual(currentOf(f.prompts[0]).map(row => row.text), ['如果把这个', '分母改成零呢？']);
});

test('an answered mention remains background rather than becoming a new unresolved question', async () => {
  const judged = [];
  const f = bridgeFixture(async options => { judged.push(currentOf(options.content)); return null; });
  await f.bridge.accept(message('mention', '你叫什么', 'a', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }));
  await f.bridge.accept(message('later', '今天很热'));
  await f.bridge.waitForIdle();
  assert.deepEqual(judged[0].map(row => row.text), ['今天很热']);
});

test('waiting candidates are removed on disable, pause or shutdown without delayed replies', async () => {
  for (const stop of ['disable', 'pause', 'abort']) {
    let calls = 0; const controller = new AbortController();
    const f = bridgeFixture(async () => { calls++; return '[[QQ_WAIT_MORE]]'; }, { signal: controller.signal });
    await f.bridge.accept(message('1', '我想问一下'));
    await f.bridge.accept(message('2', '这个'));
    if (stop === 'disable') f.bridge.setGroupParticipation({ enabled: false, cooldownSeconds: 1 });
    if (stop === 'pause') f.bridge.setPaused(true);
    if (stop === 'abort') controller.abort();
    await f.bridge.waitForIdle();
    assert.equal(calls, 1); assert.equal(f.sent.length, 0);
  }
});
