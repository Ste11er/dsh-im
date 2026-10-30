import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function qqFamiliarityEnabled(value = false) {
  if (typeof value !== 'boolean') throw new TypeError('familiarityEnabled must be a boolean');
  return value;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
function identity(message) {
  const scope = message.kind === 'group' ? 'group' : message.kind === 'c2c' ? 'direct' : null;
  const peer = scope === 'group' ? message.groupOpenid : message.senderId;
  const sender = message.senderId;
  if (!scope || [peer, sender].some(value => typeof value !== 'string' || !value.trim() || value.length > 128 || value.includes('\0'))) {
    throw new TypeError('Familiarity requires a QQ conversation and sender identity');
  }
  return { id: createHash('sha256').update(JSON.stringify([scope, peer, sender])).digest('hex'), scope, peer, sender };
}

// Candidate product curve: daily contact, rather than message volume. The
// coefficients are not psychological measurements. See docs/QQ熟识度.md.
export function familiarityState(row, now = Date.now()) {
  if (![row.active_days, row.addressed_days, row.first_at, row.last_at, now].every(Number.isSafeInteger)
    || row.active_days < 1 || row.addressed_days < 0 || row.addressed_days > row.active_days
    || row.first_at < 0 || row.last_at < row.first_at) throw new TypeError('Invalid persisted familiarity counters');
  const floor = Math.min(0.6, 0.15 * Math.log10(1 + row.active_days));
  const top = Math.max(floor, Math.min(1, 0.28 * Math.log10(1 + row.active_days)
    + 0.15 * Math.log10(1 + row.addressed_days) + 0.02));
  const daysAway = Math.max(0, now - row.last_at) / 86_400_000;
  const strength = floor + (top - floor) * Math.exp(-daysAway / (3 * (1 + row.active_days / 10)));
  return { score: Math.round(strength * 100), stage: strength >= 0.7 ? '熟悉' : strength >= 0.4 ? '眼熟' : row.active_days > 1 ? '有过接触' : '刚认识',
    activeDays: row.active_days, addressedDays: row.addressed_days, firstSeenAt: row.first_at, lastSeenAt: row.last_at };
}

/** Per-bot local counters only: no message text, image, model call or permissions. */
export class QqFamiliarity {
  #path;
  #db = null;
  #enabled = false;
  #error = null;
  #now;
  constructor({ path, now = Date.now }) { this.#path = path; this.#now = now; }

  get status() {
    return { enabled: this.#enabled, members: this.#db ? this.#db.prepare('SELECT count(*) AS n FROM members').get().n : null,
      lastError: this.#error ? { code: 'familiarity-unavailable', message: '熟识度本地记录暂不可用，请检查本地日志后重新启用。' } : null };
  }

  prepare() {
    if (this.#db) return;
    let db;
    try {
      mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
      db = new DatabaseSync(this.#path);
      chmodSync(this.#path, 0o600);
      db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, peer TEXT NOT NULL, sender TEXT NOT NULL,
          name TEXT, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS days (
          member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          day TEXT NOT NULL, addressed INTEGER NOT NULL CHECK(addressed IN (0,1)),
          PRIMARY KEY(member_id,day));`);
      // Exercise the persisted schema here; an incompatible/corrupt file is a
      // feature failure, never an empty/new relationship archive.
      db.prepare('SELECT id,scope,peer,sender,name,first_at,last_at FROM members LIMIT 1').all();
      db.prepare('SELECT member_id,day,addressed FROM days LIMIT 1').all();
      this.#db = db; this.#error = null;
    } catch (error) {
      db?.close(); this.#error = error; throw error;
    }
  }

  setEnabled(value) {
    const enabled = qqFamiliarityEnabled(value);
    if (enabled) this.prepare();
    this.#enabled = enabled;
  }

  #row(id) {
    return this.#db.prepare(`SELECT m.*,count(d.day) AS active_days,coalesce(sum(d.addressed),0) AS addressed_days
      FROM members m LEFT JOIN days d ON d.member_id=m.id WHERE m.id=? GROUP BY m.id`).get(id);
  }

  observe(message, addressed) {
    if (!this.#enabled) return;
    if (typeof addressed !== 'boolean') throw new TypeError('Familiarity addressed flag must be boolean');
    const member = identity(message);
    const now = this.#now();
    const day = dayFormat.format(new Date(now));
    const name = typeof message.senderName === 'string' ? message.senderName.slice(0, 80) : null;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare(`INSERT INTO members(id,scope,peer,sender,name,first_at,last_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name,members.name),last_at=max(members.last_at,excluded.last_at)`)
        .run(member.id, member.scope, member.peer, member.sender, name, now, now);
      this.#db.prepare(`INSERT INTO days(member_id,day,addressed) VALUES(?,?,?)
        ON CONFLICT(member_id,day) DO UPDATE SET addressed=max(days.addressed,excluded.addressed)`)
        .run(member.id, day, addressed ? 1 : 0);
      this.#db.exec('COMMIT'); this.#error = null;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); }
      catch (rollbackError) { this.#error = new AggregateError([error, rollbackError], 'Familiarity update and rollback failed'); throw this.#error; }
      this.#error = error; throw error;
    }
  }

  context(message) {
    if (!this.#enabled) return null;
    if (this.#error) return { unavailable: true };
    try {
      const row = this.#row(identity(message).id);
      return row ? familiarityState(row, this.#now()) : null;
    } catch (error) { this.#error = error; throw error; }
  }

  list({ offset = 0 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('Invalid familiarity page offset');
    this.prepare();
    const rows = this.#db.prepare(`SELECT m.*,count(d.day) AS active_days,coalesce(sum(d.addressed),0) AS addressed_days
      FROM members m LEFT JOIN days d ON d.member_id=m.id GROUP BY m.id ORDER BY m.last_at DESC,m.id LIMIT 21 OFFSET ?`).all(offset);
    return { items: rows.slice(0, 20).map(row => ({ id: row.id, scope: row.scope,
      label: `${row.scope === 'group' ? `群 …${row.peer.slice(-4)}` : '私聊'} / ${row.name ?? '成员'} …${row.sender.slice(-4)}`,
      ...familiarityState(row, this.#now()) })), nextOffset: rows.length > 20 ? offset + 20 : null };
  }

  clear(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new TypeError('Invalid familiarity record id');
    this.prepare();
    return { removed: this.#db.prepare('DELETE FROM members WHERE id=?').run(id).changes > 0 };
  }

  close() { this.#enabled = false; this.#db?.close(); this.#db = null; }
}
