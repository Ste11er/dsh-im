import { QQ_GROUP_CONTEXT_LIMITS } from './group-context.mjs';
import { normalizeModelSelection } from '../shared/model-setting.mjs';
export const PARTICIPATION_SKIP = '[[QQ_KEEP_SILENT]]';
export const PARTICIPATION_WAIT = '[[QQ_WAIT_MORE]]';
// QQ's documented group passive-reply window; based on the source event time,
// not local receipt time (sleep/resume and gateway replay can deliver old events).
// https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/server-inter/message/send-receive/send.md
export const QQ_GROUP_REPLY_WINDOW_MS = 5 * 60_000;
export function qqGroupReplyExpired(message, now = Date.now()) {
  if (typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp))) throw new TypeError('Invalid QQ group message timestamp');
  return now - Date.parse(message.timestamp) >= QQ_GROUP_REPLY_WINDOW_MS;
}
export function qqGroupParticipation(value) {
  if (value === undefined) return Object.freeze({ enabled: false, cooldownSeconds: 180, judgeModel: null });
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['enabled', 'cooldownSeconds', 'judgeModel', 'probability'].includes(key))
    || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.cooldownSeconds)
    || value.cooldownSeconds < 1 || !Number.isSafeInteger(value.cooldownSeconds * 1000)) {
    throw new TypeError('群聊自主参与需提供 enabled 和正整数 cooldownSeconds。');
  }
  // Deployed configurations contained probability. Validate then discard it on read/save.
  if (Object.hasOwn(value, 'probability') && (typeof value.probability !== 'number'
    || !Number.isFinite(value.probability) || value.probability < 0 || value.probability > 1)) throw new TypeError('Invalid legacy participation probability');
  let judgeModel = null;
  if (value.judgeModel !== undefined && value.judgeModel !== null) {
    const model = value.judgeModel;
    if (typeof model !== 'object' || Array.isArray(model)
      || Object.keys(model).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))
      || !(judgeModel = normalizeModelSelection(model))) throw new TypeError('Invalid participation judgment model');
  }
  return Object.freeze({ enabled: value.enabled, cooldownSeconds: value.cooldownSeconds, judgeModel });
}

/** One candidate at a time per group; cooldown budgets model assessments, including declines. */
export class QqGroupParticipation {
  #settings = qqGroupParticipation(); #pending = new Map(); #last = new Map(); #queued = new Map(); #now; #signal; #logger;
  #stats = { candidates: 0, declined: 0, replied: 0, waiting: 0, skipped: 0, errors: 0, lastError: null };
  constructor({ now = Date.now, signal, logger = console } = {}) {
    this.#now = now; this.#signal = signal; this.#logger = logger;
    signal?.addEventListener('abort', () => this.cancelAll(), { once: true });
  }
  set(value) { this.#settings = qqGroupParticipation(value); this.cancelAll(); }
  cancelAll() { for (const key of new Set([...this.#pending.keys(), ...this.#queued.keys()])) this.cancel(key); }
  cancel(key) {
    const queued = this.#queued.get(key);
    if (queued) { clearTimeout(queued.timer); this.#queued.delete(key); queued.resolve(); }
    this.#pending.get(key)?.controller.abort();
    if ((this.#settings.enabled || this.#pending.has(key)) && (this.#last.size < QQ_GROUP_CONTEXT_LIMITS.groups || this.#last.has(key))) this.#last.set(key, this.#now()); this.#prune();
  }
  #prune() {
    const now = this.#now();
    for (const [key, at] of this.#last) if (!this.#pending.has(key) && now - at >= this.#settings.cooldownSeconds * 1000) this.#last.delete(key);
    // Matches the existing short-context group capacity. Eviction must not bypass a live cooldown.
  }
  isBusy(key) { return this.#pending.has(key); }
  isReplying(key) { return this.#pending.get(key)?.replying === true; }
  get status() { return { ...this.#stats }; }
  #queue(key, run) {
    const existing = this.#queued.get(key);
    if (existing) { existing.run = run; return; }
    if (this.#queued.size >= QQ_GROUP_CONTEXT_LIMITS.groups) return;
    let resolve;
    const task = new Promise(done => { resolve = done; });
    this.#queued.set(key, { run, task, resolve, timer: null });
    this.#schedule(key);
  }
  #schedule(key) {
    const queued = this.#queued.get(key);
    if (!queued || this.#pending.has(key) || queued.timer) return;
    // This timer only enforces the configured model-call cooldown. It never
    // infers semantic completion and never re-evaluates WAIT without new input.
    const remaining = Math.max(0, (this.#last.get(key) ?? -Infinity) + this.#settings.cooldownSeconds * 1000 - this.#now());
    queued.timer = setTimeout(() => {
      this.#queued.delete(key);
      const task = this.consider(key, queued.run, { coalesce: true });
      task.finally(queued.resolve);
    }, Math.min(remaining, 2_147_483_647));
  }
  consider(key, run, { coalesce = false } = {}) {
    this.#prune();
    if (!this.#settings.enabled || this.#signal?.aborted) return Promise.resolve();
    const pending = this.#pending.get(key);
    if (pending || this.#last.has(key) || this.#queued.has(key)) {
      if (coalesce && !pending?.replying) {
        this.#queue(key, run);
        pending?.controller.abort();
      }
      return Promise.resolve();
    }
    if (this.#last.size >= QQ_GROUP_CONTEXT_LIMITS.groups) return Promise.resolve();
    const controller = new AbortController();
    const signal = this.#signal ? AbortSignal.any([this.#signal, controller.signal]) : controller.signal;
    const entry = { controller, task: null, replying: false };
    this.#last.set(key, this.#now()); this.#pending.set(key, entry); this.#stats.candidates++;
    entry.task = (async () => {
      try {
        const receipt = await run(signal, { beginReply: () => {
          if (signal.aborted || this.#queued.has(key)) return false;
          entry.replying = true; return true;
        } });
        if (receipt === null) this.#stats.declined++;
        else if (receipt === PARTICIPATION_WAIT) this.#stats.waiting++;
        else if (receipt === undefined) this.#stats.skipped++;
        else this.#stats.replied++;
        this.#stats.lastError = null;
      } catch (error) {
        if (signal.aborted && !error.deliveryOutcome) { this.#stats.skipped++; return; }
        this.#stats.errors++; this.#stats.lastError = {
          code: error.code === 'qq-connect-timeout' ? 'qq-connect-timeout'
            : error.code === 'qq-judgment-invalid' ? 'qq-judgment-invalid'
            : Number(error.bizCode) === 40_034_005 ? 'qq-reply-expired' : 'participation-failed',
        };
        this.#logger.error?.('[dsh-im:qq] autonomous participation failed:', error);
      } finally { if (this.#pending.get(key) === entry) this.#pending.delete(key); this.#schedule(key); }
    })();
    return entry.task;
  }
  async whenIdle() {
    while (this.#pending.size || this.#queued.size) await Promise.allSettled([
      ...[...this.#pending.values()].map(entry => entry.task), ...[...this.#queued.values()].map(entry => entry.task),
    ]);
  }
}
