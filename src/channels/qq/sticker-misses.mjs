import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { qqReplyActivity } from './reply-activity.mjs';
const STATES = ['pending', 'running', 'done', 'not-found', 'failed'];
/** Persistent missing-expression queue. No model or QQ send capability. */
export class QqStickerMisses {
  #directory; #catalog; #getMaxBytes; #activity; #idleMs; #now; #jobs = new Map(); #ready; #writes = Promise.resolve();
  #timer; #unsubscribe; #running; #controller; #closed = false; #logger;
  constructor({ directory, catalog, getMaxBytes, activity = qqReplyActivity, idleMs = 30_000, now = Date.now, logger = console }) {
    this.#directory = directory; this.#catalog = catalog; this.#getMaxBytes = getMaxBytes;
    this.#activity = activity; this.#idleMs = idleMs; this.#now = now; this.#logger = logger;
  }
  async #load() {
    let doc;
    try { doc = JSON.parse(await readFile(join(this.#directory, 'missing.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (doc.version !== 1 || !Array.isArray(doc.jobs)) throw new Error('Invalid sticker missing queue');
    for (const job of doc.jobs) {
      if (!job || typeof job.query !== 'string' || !job.query.trim() || job.query.length > 200 || !STATES.includes(job.state)
        || !Number.isSafeInteger(job.count) || job.count < 1 || !Number.isSafeInteger(job.updatedAt)
        || !Number.isSafeInteger(job.downloaded) || job.downloaded < 0 || (job.error !== null && typeof job.error !== 'string')
        || this.#jobs.has(job.query)) throw new Error('Invalid sticker missing record');
      this.#jobs.set(job.query, { ...job, state: job.state === 'running' ? 'pending' : job.state });
    }
  }
  #ensureReady() { return this.#ready ??= this.#load(); }
  #save() {
    const text = JSON.stringify({ version: 1, jobs: [...this.#jobs.values()] });
    const save = this.#writes.catch(() => {}).then(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const temporary = join(this.#directory, `missing.${randomUUID()}.tmp`);
      await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.#directory, 'missing.json'));
    });
    this.#writes = save; return save;
  }
  async record(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new TypeError('Missing sticker query must contain 1–200 characters');
    await this.#ensureReady();
    query = query.trim().toLowerCase();
    const existing = this.#jobs.get(query);
    if (existing) { existing.count++; existing.updatedAt = this.#now(); if (existing.state !== 'running') existing.state = 'pending'; }
    else this.#jobs.set(query, { query, count: 1, updatedAt: this.#now(), state: 'pending', downloaded: 0, error: null });
    await this.#save(); this.#schedule();
    return { recorded: true, query, note: 'Missing sticker recorded. Reply with text now; local library maintenance runs after replies finish and QQ is idle. No image has been sent.' };
  }
  get status() { return [...this.#jobs.values()].map(job => ({ ...job })); }
  start() {
    this.#unsubscribe = this.#activity.subscribe(() => {
      if (this.#activity.busy) { clearTimeout(this.#timer); this.#controller?.abort(new Error('QQ reply has priority')); }
      else this.#schedule();
    });
    void this.#ensureReady().then(() => this.#schedule()).catch(error => this.#logger.error('[dsh-im:qq] missing queue load failed:', error));
  }
  #schedule() {
    clearTimeout(this.#timer);
    if (this.#closed || this.#activity.busy || this.#running || ![...this.#jobs.values()].some(job => job.state === 'pending')) return;
    const delay = Math.max(0, this.#idleMs - (this.#now() - this.#activity.idleSince));
    this.#timer = setTimeout(() => { void this.runIfIdle().catch(error => this.#logger.error('[dsh-im:qq] idle sticker maintenance failed:', error)); }, delay);
    this.#timer.unref?.();
  }
  async runIfIdle() {
    await this.#ensureReady();
    if (this.#closed || this.#running || this.#activity.busy || this.#now() - this.#activity.idleSince < this.#idleMs) return;
    const job = [...this.#jobs.values()].find(job => job.state === 'pending'); if (!job) return;
    this.#controller = new AbortController(); const signal = this.#controller.signal;
    this.#running = (async () => {
      try {
        job.state = 'running'; job.error = null; await this.#save();
        await this.#catalog.refresh({ signal });
        if (this.#catalog.status.aigengtuCount > 0) await this.#catalog.syncAigengtu({ signal });
        const maxBytes = await this.#getMaxBytes();
        const result = await this.#catalog.search(job.query, { signal, maxBytes, uncachedOnly: true });
        if (!result.items.length && result.status?.warning) throw new Error('Sticker source refresh failed; no new match is confirmed');
        for (const item of result.items) { signal.throwIfAborted(); await this.#catalog.get(item.id, { signal, maxBytes }); job.downloaded++; }
        job.state = result.items.length ? 'done' : 'not-found';
      } catch (error) {
        job.state = signal.aborted ? 'pending' : 'failed'; job.error = signal.aborted ? null : error.message;
        if (!signal.aborted) this.#logger.error('[dsh-im:qq] missing sticker lookup failed:', error);
      }
      job.updatedAt = this.#now(); await this.#save();
    })();
    try { await this.#running; }
    finally { this.#running = null; this.#controller = null; this.#schedule(); }
  }
  async close() { this.#closed = true; clearTimeout(this.#timer); this.#unsubscribe?.(); this.#controller?.abort(new Error('Sticker maintenance stopped')); await this.#running; await this.#writes; }
}
