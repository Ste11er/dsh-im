// Independent, re-runnable verification for the QQ send-control slice
// (WG-QQ-04 budget, WG-QQ-05 quiet hours, WG-QQ-06 dry-run).
// Prints PASS/FAIL; exits non-zero on any failure.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { QqStateStore } from '../../src/channels/qq/state-store.mjs';
import { QqRuntime } from '../../src/channels/qq/qq-runtime.mjs';
import { evaluateDeferredOutbound } from '../../src/channels/qq/qq-bridge.mjs';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error?.message ?? String(error)}`);
  }
}

const HARNESS = {
  ensureRunning: async () => true,
  currentWorkspace: () => process.cwd(),
  currentConversationWorkspace: () => process.cwd(),
  assertWorkspaceScope: () => {},
};
const CONFIG = { botId: 'qq_verify', appId: '102345678', ownerUserOpenid: '*' };
const quietAllDay = { quietHours: { enabled: true, start: '00:00', end: '23:59' } };

function fakeBot() {
  const handlers = new Map();
  const sent = [];
  const bot = {
    use() { return bot; },
    on(event, handler) { handlers.set(event, handler); return bot; },
    async start() { queueMicrotask(() => handlers.get('ready')?.()); },
    stop() {},
    sendText: async (target, text) => { sent.push({ target, text }); return { sent: true }; },
  };
  return { bot, sent };
}

async function openRuntime(root, sendControl, { state } = {}) {
  const store = state ?? await new QqStateStore(join(root, 'state.json'), {
    logger: { warn() {}, error() {}, info() {}, debug() {} },
  }).load();
  const { bot, sent } = fakeBot();
  const runtime = new QqRuntime({
    config: { ...CONFIG, ...(sendControl ? { sendControl } : {}) },
    appSecret: 'secret',
    harness: HARNESS,
    state: store,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    connectTimeoutMs: 200,
    createBot: () => bot,
  });
  await runtime.start();
  return { runtime, store, sent };
}
const send = (runtime, text = 'hi') => runtime.sendProactiveText(
  { kind: 'user', route: { userOpenId: 'u1' } }, text,
).then(() => null, (error) => error);

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'qq-verify-send-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

await check('A defaults-off keeps sending unchanged and writes no usage', () => withRoot(async (root) => {
  const { runtime, store, sent } = await openRuntime(root, null);
  try {
    assert.equal(await send(runtime), null);
    assert.equal(sent.length, 1);
    assert.deepEqual(store.sendControlUsage(), { events: [] });
    assert.equal(runtime.sendControlDiagnostics().dryRunCandidates, 0);
  } finally { await runtime.stop(); }
}));

await check('B dry-run suppresses L3, records a candidate and never calls the platform', () => withRoot(async (root) => {
  const { runtime, sent, store } = await openRuntime(root, { dryRun: { enabled: true } });
  try {
    const error = await send(runtime);
    assert.equal(error?.code, 'send-dry-run');
    assert.equal(sent.length, 0);
    assert.equal(runtime.sendControlDiagnostics().dryRunCandidates, 1);
    assert.deepEqual(store.sendControlUsage(), { events: [] });
  } finally { await runtime.stop(); }
}));

await check('C budget rejects over-limit segments and survives a runtime restart', () => withRoot(async (root) => {
  const config = { budget: { enabled: true, windowMs: 600_000, limit: 1 } };
  const first = await openRuntime(root, config);
  try {
    assert.equal(await send(first.runtime, 'one'), null);
    const denied = await send(first.runtime, 'two');
    assert.equal(denied?.code, 'send-budget-exhausted');
  } finally { await first.runtime.stop(); }

  // Same state file -> persisted window usage must still block a new process.
  const second = await openRuntime(root, config);
  try {
    assert.equal(second.store.sendControlUsage().events.length, 1, 'window usage persisted');
    const stillDenied = await send(second.runtime, 'three');
    assert.equal(stillDenied?.code, 'send-budget-exhausted', 'restart must not widen the budget');
  } finally { await second.runtime.stop(); }
}));

await check('D quiet hours defer L3 without sending, then deliver on flush', () => withRoot(async (root) => {
  const { runtime, sent } = await openRuntime(root, quietAllDay);
  try {
    const deferred = await send(runtime, 'later');
    assert.equal(deferred?.code, 'send-deferred-quiet');
    assert.equal(sent.length, 0, 'nothing is sent inside the quiet window');
    assert.equal(runtime.sendControlDiagnostics().quietQueued, 1);
    // Leave the quiet window and flush: the deferred item is delivered, not dropped.
    runtime.setSendControl({ dryRun: { enabled: false } });
    await runtime.flushSendControlNow();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'later');
  } finally { await runtime.stop(); }
}));

await check('E live setSendControl applies immediately in both directions', () => withRoot(async (root) => {
  const { runtime, sent } = await openRuntime(root, null);
  try {
    runtime.setSendControl({ dryRun: { enabled: true } });
    assert.equal((await send(runtime))?.code, 'send-dry-run');
    runtime.setSendControl({ dryRun: { enabled: false } });
    assert.equal(await send(runtime), null);
    assert.equal(sent.length, 1);
  } finally { await runtime.stop(); }
}));

await check('F L4 deferred decision shares gate order and segment counting', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  assert.equal(evaluateDeferredOutbound({ sendControl: {}, usage: { events: [] }, text: 'ok', now }).action, 'allow');
  assert.equal(evaluateDeferredOutbound({
    sendControl: { dryRun: { enabled: true } }, usage: { events: [] }, text: 'ok', now,
  }).action, 'dry-run');
  assert.equal(evaluateDeferredOutbound({
    sendControl: { budget: { enabled: true, windowMs: 60_000, limit: 1 } },
    usage: { events: [{ at: now - 1_000, segments: 1 }] }, text: 'ok', now,
  }).action, 'deny-budget');
  assert.equal(evaluateDeferredOutbound({ sendControl: quietAllDay, usage: { events: [] }, text: 'ok', now }).action, 'defer-quiet');
});

await check('G L4 wiring uses the shared decision and keeps rows pending', async () => {
  const source = await readFile('src/channels/qq/qq-bridge.mjs', 'utf8');
  const method = source.slice(source.indexOf('async #deliverDeferredOutcome('), source.indexOf('async #recordSendControlUsage('));
  assert.match(method, /evaluateDeferredOutbound\(/, 'four-gate decision is used');
  assert.match(method, /deferredNotAttempted\(/, 'budget/quiet keep the row pending without an attempt');
  assert.match(method, /#dryRun\.record\(/, 'dry-run records a candidate instead of sending');
  const runtimeSource = await readFile('src/channels/qq/qq-runtime.mjs', 'utf8');
  const l3 = runtimeSource.slice(runtimeSource.indexOf('async sendProactiveText('), runtimeSource.indexOf('async start()'));
  assert.match(l3, /evaluateProactiveOutbound\(/);
  assert.match(l3, /send-dry-run/);
  assert.match(l3, /send-budget-exhausted/);
  assert.match(l3, /send-deferred-quiet/);
});

const failed = results.filter((row) => !row.ok);
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
if (failed.length > 0) process.exitCode = 1;
