import assert from 'node:assert/strict';
import test from 'node:test';
import { QqEmptyMentionWaits, qqEmptyMentionWaitSeconds } from '../../../src/channels/qq/empty-mention.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { QqMessageTraces } from '../../../src/channels/qq/message-trace.mjs';

const message = (id, { text = '', addressed = true, sender = 'member', group = 'group', ...rest } = {}) => ({ messageId: id,
 senderId: sender, groupOpenid: group, kind: 'group', content: text, timestamp: new Date().toISOString(),
 rawEventType: addressed ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
 replyTarget: { scope: 'group', targetId: group, msgId: id }, ...rest });
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(t, options = {}) {
 const abort = new AbortController(), asks = [], sent = [], seen = new Set(), sessions = new Map();
 const traces = new QqMessageTraces(); traces.setEnabled(true);
 const scope = { generation: 0, cwd: '/tmp/first', policy: { test: 'initial' } };
 const bridge = new QqHarnessBridge({ bot: { appId: 'bot', sendText: async (target, text) => { sent.push({ target, text }); return { id: 'sent' }; } },
  traces, signal: abort.signal, ownerUserOpenid: '*', groupContextEnabled: false,
  state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key) ?? null, setSession: async (key,id) => sessions.set(key,id), ...options.state },
  harness: { createSession: async () => 'session', sessionExists: async () => true,
   currentWorkspace: () => scope.cwd, conversationWorkspaceGeneration: () => scope.generation,
   ask: async (id, text, config) => { asks.push({ id, text, config }); return 'answer'; }, ...options.harness },
  logger: { info() {}, warn() {}, error() {} }, ...Object.fromEntries(Object.entries(options).filter(([key]) => !['state', 'harness'].includes(key))) });
 t.after(() => abort.abort());
 return { bridge, asks, sent, seen, sessions, traces, scope, abort };
}

test('empty mention waits silently and same-speaker follow-up creates exactly one turn with a combined input', async t => {
 const f = fixture(t);
 await f.bridge.accept(message('empty'));
 assert.equal(f.sent.length, 0); assert.equal(f.asks.length, 0); assert.equal(f.bridge.emptyMentionStatus.pending, 1);
 await f.bridge.accept(message('follow', { addressed: false, text: '问题在这里' }));
 assert.equal(f.asks.length, 1); assert.equal(f.sent.length, 1);
 assert.match(JSON.stringify(f.asks[0].text), /先单独 @/); assert.match(JSON.stringify(f.asks[0].text), /问题在这里/);
 assert.equal(f.asks[0].config.deliveryContext.idiomInput, '问题在这里');
 assert.equal(f.sent[0].target.msgId, 'follow', 'reply uses the new message passive window');
 assert.equal(f.bridge.emptyMentionStatus.pending, 0); assert.equal(f.bridge.emptyMentionStatus.merged, 1);
 await f.bridge.accept(message('empty')); await f.bridge.accept(message('follow', { text: 'duplicate' }));
 assert.equal(f.asks.length, 1);
 const results = f.traces.export().traces.flatMap(row => row.events.map(event => event.result));
 assert.ok(results.includes('empty-merged')); assert.ok(results.includes('empty-followup'));
});

test('wait is scoped to the group and actor, while a later explicit mention replaces it', async t => {
 const f = fixture(t); await f.bridge.accept(message('empty'));
 await f.bridge.accept(message('other-person', { addressed: false, text: '别人的话', sender: 'other' }));
 await f.bridge.accept(message('other-group', { addressed: false, text: '另一个群', group: 'other-group' }));
 assert.equal(f.asks.length, 0); assert.equal(f.bridge.emptyMentionStatus.pending, 1);
 await f.bridge.accept(message('new-explicit', { text: '直接问题', sender: 'other' }));
 assert.equal(f.asks.length, 1);
 await f.bridge.accept(message('late', { addressed: false, text: '后续', sender: 'member' })); assert.equal(f.asks.length, 1);
});

test('expiration is silent and does not create a prompt or retain a pending route', async t => {
 const f = fixture(t, { emptyMentionWaitMs: 10 }); await f.bridge.accept(message('empty'));
 await new Promise(resolve => setTimeout(resolve, 30));
 assert.equal(f.bridge.emptyMentionStatus.pending, 0); assert.equal(f.bridge.emptyMentionStatus.expired, 1);
 assert.equal(f.asks.length, 0); assert.equal(f.sent.length, 0);
 await f.bridge.accept(message('late', { addressed: false, text: '太晚' })); assert.equal(f.asks.length, 0);
 assert.equal(f.traces.export().traces[0].outcome, 'empty-expired');
});

test('commands, other mentions, pause, session/workspace changes and abort never inherit an old wake', async t => {
 for (const change of ['command', 'other-mention', 'pause', 'session', 'workspace', 'generation', 'abort', 'disable']) {
  const f = fixture(t); await f.bridge.accept(message('empty'));
  if (change === 'command') await f.bridge.accept(message('command', { addressed: false, text: '/stop' }));
  if (change === 'other-mention') await f.bridge.accept(message('mention', { addressed: false, text: '<@other> hello' }));
  if (change === 'pause') f.bridge.setPaused(true);
  if (change === 'session') f.sessions.set('group:group', 'another-session');
  if (change === 'workspace') f.scope.cwd = '/tmp/another';
  if (change === 'generation') f.scope.generation++;
  if (change === 'abort') f.abort.abort();
  if (change === 'disable') f.bridge.setEmptyMentionWaitMs(0);
  await f.bridge.accept(message('after', { addressed: false, text: '后续内容' }));
  assert.equal(f.asks.length, 0, change); assert.equal(f.bridge.emptyMentionStatus.pending, 0, change);
 }
});

test('empty input with attachments or a quote never becomes an empty wake', async t => {
 for (const body of [{ attachments: [{ content_type: 'image/png', url: 'https://multimedia.nt.qq.com.cn/p.png' }] },
  { attachments: [{ content_type: 'application/octet-stream', filename: 'f.txt', url: 'https://multimedia.nt.qq.com.cn/f.txt' }] },
  { refMsgIdx: 'quoted', msgElements: [{ content: '引用内容' }] }]) {
  const f = fixture(t); await f.bridge.accept(message('media', body));
  assert.equal(f.bridge.emptyMentionStatus.started, 0);
  assert.equal(f.asks.length, 1);
 }
});

test('only first follow-up inherits the wake and a plain private empty input keeps its existing behavior', async t => {
 const f = fixture(t); await f.bridge.accept(message('empty'));
 await Promise.all([f.bridge.accept(message('first', { addressed: false, text: '第一条' })), f.bridge.accept(message('second', { addressed: false, text: '第二条' }))]);
 assert.equal(f.asks.length, 1);
 await f.bridge.accept({ messageId: 'direct', kind: 'c2c', senderId: 'member', content: '', replyTarget: { scope: 'c2c', targetId: 'member', msgId: 'direct' } });
 assert.equal(f.bridge.emptyMentionStatus.started, 1); assert.match(f.sent.at(-1).text, /目前支持/);
});

test('manager rechecks deadline after suspend and never consumes another actor or a replaced claim', () => {
 let now = 0; const waits = new QqEmptyMentionWaits({ waitMs: 30, now: () => now });
 const events = [], options = { senderId: 'a', messageId: 'one', context: 'scope', ready: Promise.resolve(), onFinish: value => events.push(value) };
 const first = waits.start('g', options); assert.equal(waits.take('g','b'), null);
 const claim = waits.take('g','a'); assert.equal(claim, first); assert.equal(waits.take('g','a'), null);
 waits.start('g', { ...options, messageId: 'two' }); assert.equal(waits.current(claim), false);
 waits.finish(claim, 'merged'); assert.equal(waits.status.pending, 1);
 now = 31; assert.equal(waits.take('g','a'), null); assert.equal(waits.status.expired, 1); assert.deepEqual(events, ['cancelled','expired']);
 waits.clear();
});

test('capacity limits only wait metadata and configuration rejects unsupported durations', () => {
 const waits = new QqEmptyMentionWaits();
 for (let i=0;i<100;i++) assert.ok(waits.start('g'+i, { senderId: 'a', messageId: String(i), context: '', ready: Promise.resolve() }));
 assert.equal(waits.start('overflow', { senderId: 'a' }), null); assert.equal(waits.status.capacitySkipped, 1); waits.clear();
 assert.equal(qqEmptyMentionWaitSeconds(),30);
 for (const value of [null, false, '30', -1, 1, 120]) assert.throws(() => qqEmptyMentionWaitSeconds(value), /emptyMentionWaitSeconds/);
});

test('same follow-up redelivery cannot bypass an uncommitted wake or start two turns', async t => {
 const disk = defer(); let committed = false;
 const f = fixture(t, { state: { markSeen: async id => { if (id === 'empty') { await disk.promise; committed = true; } } } });
 const empty = f.bridge.accept(message('empty'));
 const first = f.bridge.accept(message('follow', { addressed: false, text: '补充' }));
 const duplicate = f.bridge.accept(message('follow', { addressed: false, text: '补充' }));
 await new Promise(setImmediate); assert.equal(f.asks.length, 0); assert.equal(committed, false);
 disk.resolve(); await Promise.all([empty, first, duplicate]);
 assert.equal(f.asks.length, 1); assert.equal(f.bridge.emptyMentionStatus.merged, 1);
});

test('new empty mention supersedes an older claim while its state write is pending', async t => {
 const disk = defer();
 const f = fixture(t, { state: { markSeen: async id => { if (id === 'old-empty') await disk.promise; } } });
 const old = f.bridge.accept(message('old-empty'));
 const oldFollow = f.bridge.accept(message('old-follow', { addressed: false, text: '旧补充' }));
 await f.bridge.accept(message('new-empty'));
 disk.resolve(); await Promise.all([old, oldFollow]);
 assert.equal(f.asks.length, 0); assert.equal(f.bridge.emptyMentionStatus.pending, 1);
 await f.bridge.accept(message('new-follow', { addressed: false, text: '新补充' }));
 assert.equal(f.asks.length, 1); assert.match(JSON.stringify(f.asks[0].text), /新补充/); assert.doesNotMatch(JSON.stringify(f.asks[0].text), /旧补充/);
});

test('failure to persist the wake fails its waiting follow-up without invoking the model', async t => {
 const disk = defer(); const f = fixture(t, { state: { markSeen: async id => { if (id === 'empty') await disk.promise; } } });
 const empty = f.bridge.accept(message('empty')); const follow = f.bridge.accept(message('follow', { addressed: false, text: '补充' }));
 const checked = Promise.all([assert.rejects(empty, /disk failure/), assert.rejects(follow, /disk failure/)]);
 disk.reject(new Error('disk failure')); await checked;
 assert.equal(f.asks.length, 0); assert.equal(f.bridge.emptyMentionStatus.pending, 0);
});

test('busy group empty mentions follow the existing busy-drop rule without arming a wait', async t => {
 const held = defer(), entered = defer();
 const f = fixture(t, { harness: { ask: async () => { entered.resolve(); await held.promise; return 'answer'; } } });
 const active = f.bridge.accept(message('active', { text: '正常问题' })); await entered.promise;
 await f.bridge.accept(message('empty')); assert.equal(f.bridge.emptyMentionStatus.pending, 0);
 held.resolve(); await active;
 assert.equal(f.bridge.status.messagesDroppedBusy, 1);
});

test('an empty mention replayed beyond the passive reply window cannot wake a later conversation', async t => {
 const f = fixture(t); await f.bridge.accept(message('old', { timestamp: new Date(Date.now()-301000).toISOString() }));
 assert.equal(f.bridge.emptyMentionStatus.started,0); assert.equal(f.sent.length,0);
});

test('a platform-normalized self mention with no text also arms exactly one wait', async t => {
 const f = fixture(t); await f.bridge.accept(message('raw', { addressed: false, text: '<@bot>' }));
 assert.equal(f.bridge.emptyMentionStatus.pending,1);
 await f.bridge.accept(message('actual-follow', { addressed: false, text: '问题' }));
 assert.equal(f.asks.length,1);
});
