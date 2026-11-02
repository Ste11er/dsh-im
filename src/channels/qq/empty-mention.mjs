import { performance } from 'node:perf_hooks';

export { qqEmptyMentionWaitSeconds } from './empty-mention-config.mjs';

/** A bounded one-shot wake-up per route, not a message queue or collector.
 * Retains no message content. Deadlines use monotonic time; timer and take()
 * both check expiration because a suspended process can wake after the timer.
 */
export class QqEmptyMentionWaits {
  #entries = new Map(); #now; #waitMs; #generation = 0;
  #stats = { started: 0, merged: 0, expired: 0, cancelled: 0, capacitySkipped: 0 };
  constructor({ waitMs = 30_000, now = () => performance.now(), signal } = {}) {
    if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new TypeError('Invalid empty mention wait duration');
    this.#waitMs = waitMs; this.#now = now;
    signal?.addEventListener('abort', () => this.clear(), { once: true });
  }
  get status() { return { ...this.#stats, pending: this.#entries.size, capacity: 100, waitMs: this.#waitMs }; }
  setDuration(waitMs) {
    if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new TypeError('Invalid empty mention wait duration');
    this.clear(); this.#waitMs = waitMs;
  }
  #finish(key, outcome) {
    const entry = this.#entries.get(key); if (!entry) return null;
    this.#entries.delete(key); clearTimeout(entry.timer); this.#stats[outcome]++;
    entry.onFinish(outcome);
    return entry;
  }
  cancel(key) { return this.#finish(key, 'cancelled'); }
  clear() { this.#generation++; for (const key of this.#entries.keys()) this.cancel(key); }
  current(entry) { return this.#entries.get(entry.key) === entry && entry.generation === this.#generation && this.#now() < entry.deadline; }
  finish(entry, outcome) { return this.#entries.get(entry.key) === entry ? this.#finish(entry.key, outcome) : null; }
  start(key, { senderId, messageId, context, ready, onFinish = () => {} }) {
    this.cancel(key);
    if (this.#waitMs === 0) return null;
    if (this.#entries.size >= 100) { this.#stats.capacitySkipped++; return null; }
    const entry = { key, claimed: false, senderId, messageId, context, ready, onFinish, generation: this.#generation,
      deadline: this.#now() + this.#waitMs, timer: null };
    this.#entries.set(key, entry); this.#stats.started++;
    entry.timer = setTimeout(() => this.#finish(key, 'expired'), this.#waitMs);
    entry.timer.unref?.();
    return entry;
  }
  take(key, senderId) {
    const entry = this.#entries.get(key); if (!entry) return null;
    if (this.#now() >= entry.deadline) { this.#finish(key, 'expired'); return null; }
    if (entry.senderId !== senderId || entry.claimed) return null;
    entry.claimed = true;
    return entry;
  }
}
