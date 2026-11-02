import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';

const active = new AsyncLocalStorage();
const STAGES = new Set(['received', 'access', 'context', 'judgment', 'turn', 'tool', 'send', 'delivery', 'terminal']);
export const QQ_TRACE_RESULTS = Object.freeze(['empty-waiting', 'empty-expired', 'empty-merged', 'empty-cancelled', 'empty-followup', 'prepared', 'running', 'received', 'allowed', 'access-denied', 'context-off', 'duplicate', 'busy-dropped',
  'ambient-recorded', 'assessing', 'waiting', 'declined', 'reply-started', 'replied', 'mention-accepted', 'image-timeout-dropped',
  'window-expired', 'disabled', 'ineligible', 'coalesced', 'cancelled', 'queued', 'started', 'completed', 'failed', 'unknown', 'sent', 'not-attempted']);
const RESULTS = new Set(QQ_TRACE_RESULTS);
const TERMINAL = new Set(['empty-expired', 'empty-merged', 'empty-cancelled', 'access-denied', 'context-off', 'duplicate', 'busy-dropped', 'waiting', 'declined',
  'image-timeout-dropped', 'window-expired', 'disabled', 'ineligible', 'coalesced', 'cancelled', 'completed', 'failed', 'unknown', 'sent', 'not-attempted']);

/** Only fixed enums, counts and keyed hashes leave this boundary. No raw
 * exception text, content, paths, URLs or identifiers enter the retained rows.
 */
export class QqMessageTraces {
  #rows = new Map(); #secret = randomBytes(32); #enabled = false; #generation = 0; #now;
  #evicted = 0; #droppedEvents = 0;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  setEnabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('Trace enabled must be boolean');
    if (value !== this.#enabled) this.#generation++;
    this.#enabled = value;
  }
  #hash(value) { return createHmac('sha256', this.#secret).update(String(value)).digest('hex').slice(0, 24); }
  get status() { this.#prune(); return { enabled: this.#enabled, retained: this.#rows.size, capacity: 256, maxEvents: 64,
    retentionMs: 86_400_000, evicted: this.#evicted, droppedEvents: this.#droppedEvents }; }
  #prune() {
    for (const [id, row] of this.#rows) if (this.#now() - row.updatedAt >= 86_400_000) { this.#rows.delete(id); this.#evicted++; }
    while (this.#rows.size > 256) { this.#rows.delete(this.#rows.keys().next().value); this.#evicted++; }
  }
  #valid(context) {
    return this.#enabled && context?.owner === this && context.generation === this.#generation
      && this.#rows.get(context.row.id) === context.row;
  }
  event(stage, result, data = {}) {
    const context = active.getStore();
    if (!this.#valid(context)) return;
    if (!STAGES.has(stage) || !RESULTS.has(result)) throw new TypeError('Invalid QQ trace event');
    const row = context.row, at = this.#now();
    const event = { stage, result, at, elapsedMs: Math.max(0, at - row.startedAt) };
    for (const key of ['sourceId', 'sessionId', 'turnId', 'toolName', 'code']) if (typeof data[key] === 'string' || Number.isSafeInteger(data[key])) event[key.replace(/Id$|Name$|^code$/u, 'Hash')] = this.#hash(data[key]);
    for (const key of ['images', 'files', 'count']) if (Number.isSafeInteger(data[key]) && data[key] >= 0) event[key] = data[key];
    row.updatedAt = at;
    if (row.events.length < 64) row.events.push(event);
    else { row.events[63] = event; row.droppedEvents++; this.#droppedEvents++; }
    row.stage = stage; row.result = result;
    if (result === 'empty-waiting') { row.outcome = result; row.endedAt = null; }
    else if (TERMINAL.has(result)) { row.outcome = result; row.endedAt = at; }
    else if (['started', 'assessing', 'reply-started'].includes(result)) { row.outcome = 'running'; row.endedAt = null; }
  }
  run(message, operation) {
    if (!this.#enabled || message?.senderIsBot === true || typeof message?.senderId !== 'string' || typeof message?.messageId !== 'string' || !['group', 'c2c'].includes(message.kind)) return operation();
    this.#prune();
    const route = `${message.kind}:${message.groupOpenid ?? message.senderId}`;
    const id = this.#hash(`${route}:${message.messageId}`);
    let row = this.#rows.get(id);
    if (!row) {
      row = { id, channel: 'qq', conversationType: message.kind === 'group' ? 'group' : 'direct',
        routeHash: this.#hash(route), senderHash: this.#hash(message.senderId), startedAt: this.#now(),
        updatedAt: this.#now(), endedAt: null, attempts: 0, outcome: 'running', stage: 'received', result: 'received', events: [], droppedEvents: 0 };
      this.#rows.set(id, row); this.#prune();
    }
    row.attempts++;
    return active.run({ owner: this, row, generation: this.#generation }, async () => {
      this.event('received', 'received');
      try {
        const result = await operation();
        if (row.outcome === 'running') this.event('terminal', 'completed');
        return result;
      } catch (error) { this.error(error); throw error; }
    });
  }
  bind(operation) {
    const context = active.getStore();
    return (...args) => active.run(context, () => operation(...args));
  }
  error(error) {
    const row = active.getStore()?.row;
    const uncertain = error?.deliveryOutcome === 'unknown' || ['channel-delivery-uncertain', 'delivery-uncertain', 'artifact-delivery-uncertain'].includes(error?.code)
      || row?.outcome === 'unknown' || (row?.stage === 'send' && Number(error?.httpStatus) === 0);
    this.event('terminal', uncertain ? 'unknown' : error?.name === 'AbortError' || error?.code === 'turn-stopped' ? 'cancelled' : 'failed', { code: error?.code });
  }
  list({ result, offset = 0 } = {}) {
    if (result !== undefined && !RESULTS.has(result)) throw new TypeError('Invalid trace filter');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('Invalid trace offset');
    this.#prune();
    const rows = [...this.#rows.values()].reverse().filter(row => result === undefined || row.outcome === result);
    const items = rows.slice(offset, offset + 20).map(({ events, ...row }) => ({ ...row, eventCount: events.length }));
    return { items, nextOffset: offset + 20 < rows.length ? offset + 20 : null, total: rows.length, status: this.status };
  }
  detail(id) { this.#prune(); return structuredClone(this.#rows.get(id) ?? null); }
  export() {
    this.#prune();
    return { schemaVersion: 1, kind: 'qq-message-diagnostics', exportedAt: this.#now(), contentIncluded: false,
      persistence: 'memory', status: this.status, traces: structuredClone([...this.#rows.values()].slice(-50)),
      limitations: ['qq-only', 'no-chat-content', 'no-config-or-credentials', 'last-50-traces', 'cleared-on-host-restart'] };
  }
}

export function qqTraceEvent(stage, result, data) { active.getStore()?.owner.event(stage, result, data); }
export function qqTraceError(error) { active.getStore()?.owner.error(error); }
export function bindQqTrace(operation) {
  const context = active.getStore();
  return (...args) => active.run(context, () => operation(...args));
}
