import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { QqMessageTraces, qqTraceEvent } from '../../../src/channels/qq/message-trace.mjs';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';
import { PARTICIPATION_WAIT } from '../../../src/channels/qq/group-participation.mjs';
import { ApiError } from '@tencent-connect/qqbot-nodejs';

const message = (id, group = 'secret-group', addressed = true) => ({ messageId: id, senderId: 'secret-sender', kind: 'group', groupOpenid: group,
 content: 'secret-body 203.0.113.10 token=secret', timestamp: new Date().toISOString(), rawEventType: addressed ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
 replyTarget: { scope: 'group', targetId: group, msgId: id } });
function fixture({ judge, ask, send } = {}) {
 const traces = new QqMessageTraces(); traces.setEnabled(true);
 const sessions = new Map(), seen = new Set(), answers = [];
 const bridge = new QqHarnessBridge({ traces, ownerUserOpenid: '*', groupContextEnabled: true,
  groupParticipation: { enabled: true, cooldownSeconds: 1 },
  participationReply: judge ?? (options => options.reply()), logger: { warn() {}, error() {}, info() {} },
  state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key, id) => sessions.set(key, id) },
  harness: { createSession: async () => `secret-session-${sessions.size}`, sessionExists: async () => true,
   ask: ask ?? (async (id, text, options) => { answers.push({ id, text }); options.onTurn?.({ sessionId: id, turn: 12 });
    options.onUpdate?.({ type: 'tool', name: 'secret-tool', arguments: 'secret-arguments' });
    options.onUpdate?.({ type: 'status', toolName: 'secret-tool', text: 'secret-result' }); return 'secret-answer'; }) },
  bot: { sendText: send ?? (async () => ({ id: 'secret-provider-receipt' })) } });
 return { traces, bridge, answers };
}

test('traces are opt-in, bounded, expire, retain evidence after disabling and reject stale async writes', async () => {
 let now = 100; const traces = new QqMessageTraces({ now: () => now });
 await traces.run(message('off'), () => qqTraceEvent('turn', 'started'));
 assert.equal(traces.list().total, 0);
 traces.setEnabled(true);
 let later;
 await traces.run(message('bounded'), () => { for (let i = 0; i < 80; i++) qqTraceEvent('tool', 'completed', { toolName: 'secret' }); later = traces.bind(() => qqTraceEvent('send', 'sent')); });
 let row = traces.detail(traces.list().items[0].id); assert.equal(row.events.length, 64); assert.ok(row.droppedEvents > 0);
 traces.setEnabled(false); const before = JSON.stringify(traces.export()); later(); assert.equal(JSON.stringify(traces.export()), before);
 traces.setEnabled(true); later(); assert.equal(traces.list().items[0].outcome, row.outcome);
 for (let i = 0; i < 300; i++) await traces.run(message(String(i)), () => {});
 assert.equal(traces.list().total, 256); assert.ok(traces.status.evicted > 0);
 now += 86_400_001; assert.equal(traces.status.retained, 0);
});

test('real QQ bridge links receipt, session, turn and tools without retaining raw content or identifiers', async () => {
 const f = fixture(); await f.bridge.accept(message('one')); await f.bridge.accept(message('two', 'other-group'));
 const list = f.traces.list(); assert.equal(list.total, 2);
 const rows = list.items.map(row => f.traces.detail(row.id));
 assert.notEqual(rows[0].routeHash, rows[1].routeHash);
 for (const row of rows) {
  assert.equal(row.outcome, 'sent');
  assert.ok(row.events.some(event => event.sessionHash)); assert.ok(row.events.some(event => event.turnHash));
  assert.ok(row.events.some(event => event.toolHash)); assert.ok(row.events.some(event => event.stage === 'send'));
 }
 const text = JSON.stringify(f.traces.export());
 assert.doesNotMatch(text, /secret|203\.0\.113\.10|token=|arguments|provider-receipt/);
});

test('semantic waiting and declining are different terminal results and do not call the reply model', async () => {
 for (const [decision, expected] of [[null, 'declined'], [PARTICIPATION_WAIT, 'waiting']]) {
  const f = fixture({ judge: async () => decision }); await f.bridge.accept(message('ambient', 'group', false));
  assert.equal(f.traces.list().items[0].outcome, expected); assert.equal(f.answers.length, 0);
 }
});

test('busy drops retain their own trace and never overwrite the active reply trace', async () => {
 let release, entered; const held = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
 const f = fixture({ ask: async () => { entered(); await held; return 'answer'; } });
 const first = f.bridge.accept(message('active')); await started;
 await f.bridge.accept(message('busy')); release(); await first;
 assert.deepEqual(f.traces.list().items.map(row => row.outcome).sort(), ['busy-dropped', 'sent']);
});

test('failed and uncertain QQ sends are not reclassified as success by their error notices', async () => {
 for (const [error, expected] of [[new ApiError('secret failure', 403, '/private'), 'failed'], [new ApiError('secret socket error', 0, '/private'), 'unknown']]) {
  const f = fixture({ send: async () => { throw error; } }); await f.bridge.accept(message('failure'));
  assert.equal(f.traces.list().items[0].outcome, expected);
  assert.doesNotMatch(JSON.stringify(f.traces.export()), /private|secret failure|secret socket/);
 }
});

test('trace capacity evicts metadata without rejecting work or adding model calls', async t => {
 const traces = new QqMessageTraces(); traces.setEnabled(true); let calls = 0;
 const started = performance.now();
 for (let i = 0; i < 1000; i++) await traces.run(message(String(i)), () => { calls++; qqTraceEvent('access', 'allowed'); qqTraceEvent('delivery', 'sent'); });
 t.diagnostic(`1000 local trace operations: ${Math.round(performance.now() - started)} ms`);
 assert.equal(calls, 1000); assert.equal(traces.list().total, 256); assert.ok(Buffer.byteLength(JSON.stringify(traces.export())) < 1_000_000);
});

test('coalesced judgments resume under their own trace without borrowing the older active context', async () => {
 const f = fixture({ judge: async () => null });
 await f.bridge.accept(message('first', 'same-group', false));
 await f.bridge.accept(message('second', 'same-group', false));
 assert.equal(f.traces.list().items[0].outcome, 'coalesced');
 await f.bridge.waitForIdle();
 const rows = f.traces.list().items.map(row => f.traces.detail(row.id));
 assert.deepEqual(rows.map(row => row.outcome), ['declined', 'declined']);
 assert.equal(rows[1].events.filter(event => event.result === 'assessing').length, 1);
 assert.equal(rows[0].events.filter(event => event.result === 'assessing').length, 1);
});

test('autonomous uncertain sending keeps its unknown outcome after the participation runner handles the error', async () => {
 const f = fixture({ send: async () => { throw new ApiError('secret timeout', 0, '/private'); } });
 await f.bridge.accept(message('autonomous-unknown', 'group', false));
 assert.equal(f.traces.list().items[0].outcome, 'unknown');
});
