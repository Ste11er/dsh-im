import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SEND_CONTROL,
  createDryRunRecorder,
  createQuietQueue,
  evaluateSendGate,
  isWithinQuietHours,
  normalizeSendControl,
  parseSendControlUsage,
  recordSendUsage,
} from '../../../src/channels/shared/send-control.mjs';

const MINUTE = 60_000;

test('send control defaults are all disabled and never throw on bad input', () => {
  for (const value of [undefined, null, 42, 'x', [], { budget: 'nope' }, { quietHours: [] }]) {
    const config = normalizeSendControl(value);
    assert.equal(config.budget.enabled, false);
    assert.equal(config.quietHours.enabled, false);
    assert.equal(config.dryRun.enabled, false);
  }
  assert.deepEqual(normalizeSendControl(undefined), DEFAULT_SEND_CONTROL);
});

test('send control keeps valid values and replaces invalid ones', () => {
  const config = normalizeSendControl({
    budget: { enabled: true, windowMs: 1_000, limit: 3 },
    quietHours: { enabled: true, start: '22:30', end: '07:00', timezone: 'Asia/Shanghai' },
    dryRun: { enabled: true },
  });
  assert.deepEqual(config.budget, { enabled: true, windowMs: 1_000, limit: 3 });
  assert.deepEqual(config.quietHours, {
    enabled: true, start: '22:30', end: '07:00', timezone: 'Asia/Shanghai',
  });
  assert.deepEqual(config.dryRun, { enabled: true });

  const invalid = normalizeSendControl({
    budget: { enabled: true, windowMs: 0, limit: -5 },
    quietHours: { enabled: true, start: '25:00', end: '7:0', timezone: '../../etc/passwd' },
  });
  assert.equal(invalid.budget.windowMs, DEFAULT_SEND_CONTROL.budget.windowMs);
  assert.equal(invalid.budget.limit, DEFAULT_SEND_CONTROL.budget.limit);
  assert.equal(invalid.quietHours.start, DEFAULT_SEND_CONTROL.quietHours.start);
  assert.equal(invalid.quietHours.end, DEFAULT_SEND_CONTROL.quietHours.end);
  assert.equal(invalid.quietHours.timezone, null);
});

test('quiet hours handle same-day and cross-midnight windows', () => {
  const at = (hour, minute = 0) => new Date(2026, 0, 15, hour, minute, 0, 0).getTime();
  const overnight = { start: '23:00', end: '08:00' };
  assert.equal(isWithinQuietHours(at(23), overnight), true);
  assert.equal(isWithinQuietHours(at(2), overnight), true);
  assert.equal(isWithinQuietHours(at(7, 59), overnight), true);
  assert.equal(isWithinQuietHours(at(8), overnight), false);
  assert.equal(isWithinQuietHours(at(12), overnight), false);
  const daytime = { start: '09:00', end: '17:00' };
  assert.equal(isWithinQuietHours(at(9), daytime), true);
  assert.equal(isWithinQuietHours(at(16, 59), daytime), true);
  assert.equal(isWithinQuietHours(at(17), daytime), false);
  assert.equal(isWithinQuietHours(at(12), { start: '09:00', end: '09:00' }), false);
});

test('quiet hours respect the configured platform timezone', () => {
  // 15:00 UTC is 23:00 in Asia/Shanghai — inside the overnight window there.
  const utc = Date.UTC(2026, 0, 15, 15, 0, 0);
  assert.equal(isWithinQuietHours(utc, { start: '23:00', end: '08:00', timezone: 'Asia/Shanghai' }), true);
  assert.equal(isWithinQuietHours(utc, { start: '23:00', end: '08:00', timezone: 'UTC' }), false);
});

test('gate order is dry-run, then budget, then quiet hours', () => {
  const now = new Date(2026, 0, 15, 23, 30, 0, 0).getTime();
  const allOn = {
    dryRun: { enabled: true },
    budget: { enabled: true, windowMs: 10 * MINUTE, limit: 1 },
    quietHours: { enabled: true, start: '23:00', end: '08:00' },
  };
  assert.equal(evaluateSendGate({ config: allOn, now }).action, 'dry-run');

  const budgetFirst = {
    budget: { enabled: true, windowMs: 10 * MINUTE, limit: 1 },
    quietHours: { enabled: true, start: '23:00', end: '08:00' },
  };
  const usage = { events: [{ at: now - MINUTE, segments: 1 }] };
  assert.equal(evaluateSendGate({ config: budgetFirst, usage, now }).action, 'deny-budget');
  assert.equal(evaluateSendGate({ config: { quietHours: budgetFirst.quietHours }, now }).action, 'defer-quiet');
  assert.equal(evaluateSendGate({ config: {}, now }).action, 'allow');
});

test('budget counts segments inside a sliding window and frees expired usage', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const config = { budget: { enabled: true, windowMs: 10 * MINUTE, limit: 5 } };
  let usage = { events: [] };
  usage = recordSendUsage(usage, { now: now - 2 * MINUTE, segments: 3, windowMs: 10 * MINUTE });
  assert.equal(evaluateSendGate({ config, usage, now, segments: 2 }).action, 'allow');
  assert.equal(evaluateSendGate({ config, usage, now, segments: 3 }).action, 'deny-budget');

  // The 3-segment send falls out of the window once it is old enough.
  const later = now + 11 * MINUTE;
  assert.equal(evaluateSendGate({ config, usage, now: later, segments: 3 }).action, 'allow');
  const pruned = recordSendUsage(usage, { now: later, segments: 1, windowMs: 10 * MINUTE });
  assert.equal(pruned.events.length, 1, 'expired events are pruned on write');
});

test('parseSendControlUsage drops damaged events', () => {
  assert.deepEqual(parseSendControlUsage(undefined), { events: [] });
  assert.deepEqual(parseSendControlUsage({ events: 'nope' }), { events: [] });
  assert.deepEqual(parseSendControlUsage({
    events: [{ at: 1, segments: 2 }, { at: 'x' }, null, { at: 5, segments: 0 }],
  }), { events: [{ at: 1, segments: 2 }] });
});

test('dry-run recorder keeps candidates bounded and expires them', () => {
  let clock = 1_000;
  const recorder = createDryRunRecorder({ ttlMs: 10 * MINUTE, max: 2, now: () => clock });
  recorder.record({ conversation: 'group:1' });
  clock += 1;
  recorder.record({ conversation: 'group:2' });
  clock += 1;
  recorder.record({ conversation: 'group:3' });
  assert.equal(recorder.size(), 2, 'bounded by max');
  clock += 11 * MINUTE;
  assert.equal(recorder.size(), 0, 'expired candidates are dropped');
  recorder.record({ conversation: 'group:4' });
  assert.equal(recorder.list().length, 1);
});

test('quiet queue drops the oldest item on overflow and expires stale items', () => {
  let clock = 1_000;
  const queue = createQuietQueue({ maxPerKey: 2, ttlMs: 60 * MINUTE, now: () => clock });
  queue.enqueue('group:1', { text: 'a' });
  clock += 1;
  queue.enqueue('group:1', { text: 'b' });
  clock += 1;
  const result = queue.enqueue('group:1', { text: 'c' });
  assert.equal(result.overflow, true);
  assert.equal(queue.size('group:1'), 2);
  const taken = queue.takeAll('group:1');
  assert.deepEqual(taken.map((entry) => entry.text), ['b', 'c'], 'oldest is dropped first');
  assert.equal(queue.size('group:1'), 0);

  clock += 1;
  queue.enqueue('group:2', { text: 'stale' });
  clock += 61 * MINUTE;
  assert.equal(queue.size('group:2'), 0);
  assert.equal(queue.stats().expired, 1);
});
