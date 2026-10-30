import { createHash } from 'node:crypto';

/** Bounded, content-free evidence at the gateway, middleware and bridge seams.
 * A lack of ordinary events is unknown platform delivery, not proof of a deny.
 */
export class QqGroupReception {
  #groups = new Map();
  #now;
  constructor({ now = Date.now } = {}) { this.#now = now; }
  #row(groupId) {
    if (typeof groupId !== 'string' || !groupId.trim() || groupId.length > 128) return null;
    let row = this.#groups.get(groupId);
    if (!row) {
      row = { id: createHash('sha256').update(groupId).digest('hex').slice(0, 12), label: `群标识 …${groupId.slice(-4)}`,
        gatewayMentions: 0, gatewayOrdinary: 0, processedMentions: 0, processedOrdinary: 0,
        lastGatewayAt: null, lastProcessedAt: null, lastDecision: null, lastDecisionAt: null };
      this.#groups.set(groupId, row);
    }
    // Bound diagnostic retention, not message processing or participation.
    this.#groups.delete(groupId); this.#groups.set(groupId, row);
    if (this.#groups.size > 100) this.#groups.delete(this.#groups.keys().next().value);
    return row;
  }
  gateway(event) {
    if (!['GROUP_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE'].includes(event?.eventType)) return;
    const row = this.#row(event.data?.group_openid);
    if (!row) return;
    row[event.eventType === 'GROUP_AT_MESSAGE_CREATE' ? 'gatewayMentions' : 'gatewayOrdinary']++;
    row.lastGatewayAt = this.#now();
  }
  processed(message, addressed) {
    if (message.kind !== 'group') return;
    const row = this.#row(message.groupOpenid);
    if (!row) return;
    row[addressed ? 'processedMentions' : 'processedOrdinary']++;
    row.lastProcessedAt = this.#now();
  }
  decision(groupId, stage) {
    const row = this.#row(groupId);
    if (!row) return;
    row.lastDecision = stage; row.lastDecisionAt = this.#now();
  }
  get status() { return [...this.#groups.values()].reverse().map(row => ({ ...row, ordinaryObserved: row.gatewayOrdinary > 0 })); }
}
