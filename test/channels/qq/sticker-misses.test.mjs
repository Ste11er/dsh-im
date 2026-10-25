import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QqStickerMisses } from '../../../src/channels/qq/sticker-misses.mjs';
test('missing expressions persist; downloads run only after reply delivery and idle grace, without sending', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-missing-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 10; let downloads = 0; let searches = 0;
  const activity = { busy: true, idleSince: 10, subscribe: () => () => {} };
  const catalog = { status: { aigengtuCount: 0 }, refresh: async () => {}, search: async (_query, options) => { searches++; assert.equal(options.uncachedOnly, true); return { items: [{ id: 'one' }] }; }, get: async () => { downloads++; } };
  const options = { directory, activity, catalog, getMaxBytes: async () => 1024, idleMs: 30, now: () => now };
  const q = new QqStickerMisses(options); t.after(() => q.close());
  await q.record('委屈'); await q.record('委屈'); await q.runIfIdle(); assert.equal(searches, 0);
  activity.busy = false; now = 39; await q.runIfIdle(); assert.equal(searches, 0);
  now = 40; await q.runIfIdle(); assert.equal(downloads, 1); assert.equal(q.status[0].state, 'done');
  assert.equal(JSON.parse(await readFile(join(directory, 'missing.json'), 'utf8')).jobs[0].count, 2);
  const reload = new QqStickerMisses(options); t.after(() => reload.close()); await reload.runIfIdle(); assert.equal(reload.status[0].state, 'done'); assert.equal(downloads, 1);
});
test('new replies abort idle downloads and leave a resumable pending record', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-missing-abort-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let changed; const activity = { busy: true, idleSince: 0, subscribe: callback => { changed = callback; return () => {}; } };
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const q = new QqStickerMisses({ directory, activity, getMaxBytes: async () => 1024, idleMs: 0, now: () => 0,
    catalog: { status: { aigengtuCount: 0 }, refresh: async () => {}, search: async () => ({ items: [{ id: 'one' }] }),
      get: async (_id, { signal }) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } } });
  q.start(); t.after(() => q.close()); await q.record('吃饭'); activity.busy = false;
  const run = q.runIfIdle(); await started; activity.busy = true; changed(); await run;
  assert.equal(q.status[0].state, 'pending'); assert.equal(q.status[0].downloaded, 0);
});
test('no new catalog match and lookup failure have different persistent outcomes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-missing-result-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let fail = false; const q = new QqStickerMisses({ directory, activity: { busy: false, idleSince: 0 }, now: () => 0, idleMs: 0,
    getMaxBytes: async () => 1024, logger: { error() {} }, catalog: { status: { aigengtuCount: 0 }, refresh: async () => {}, search: async () => { if (fail) throw new Error('offline'); return { items: [] }; } } });
  t.after(() => q.close()); await q.record('喜悦'); await q.runIfIdle(); assert.equal(q.status[0].state, 'not-found');
  fail = true; await q.record('疑惑'); await q.runIfIdle(); assert.equal(q.status[1].state, 'failed'); assert.equal(q.status[1].error, 'offline');
});
