// Shared outbound send gate for channels (budget, quiet hours, dry-run).
//
// Ordering is fixed by the channel adapters, not here: an account-level pause
// is checked before this gate, then dry-run, then budget, then quiet hours.
// Every decision is a pure function of configuration, usage, time and planned
// segment count, so the behaviour is testable without a platform connection.
//
// Segment counts come from the channel's real send path (QQ: one segment per
// `chunkMarkdownParts` chunk). Counting calls instead of segments would
// under-count long replies.

export const DEFAULT_SEND_CONTROL = Object.freeze({
  budget: Object.freeze({ enabled: false, windowMs: 600_000, limit: 50 }),
  quietHours: Object.freeze({ enabled: false, start: '23:00', end: '08:00', timezone: null }),
  dryRun: Object.freeze({ enabled: false }),
});

export const SEND_CONTROL_BUDGET_MIN_WINDOW_MS = 1_000;
export const SEND_CONTROL_BUDGET_MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const SEND_CONTROL_BUDGET_MAX_LIMIT = 10_000;
export const SEND_CONTROL_USAGE_MAX_EVENTS = 1_000;

function enabled(value) {
  return value === true;
}

function boundedInteger(value, fallback, { min, max }) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.trunc(number);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function clockTime(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value.trim());
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function timezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const zone = value.trim();
  if (zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(zone)) return null;
  return zone;
}

/** Normalize one persisted/UI configuration. Absent or invalid values fall back
 *  to the disabled defaults; this function never throws. */
export function normalizeSendControl(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const budget = source.budget && typeof source.budget === 'object' ? source.budget : {};
  const quietHours = source.quietHours && typeof source.quietHours === 'object' ? source.quietHours : {};
  const dryRun = source.dryRun && typeof source.dryRun === 'object' ? source.dryRun : {};
  return Object.freeze({
    budget: Object.freeze({
      enabled: enabled(budget.enabled),
      windowMs: boundedInteger(budget.windowMs, DEFAULT_SEND_CONTROL.budget.windowMs, {
        min: SEND_CONTROL_BUDGET_MIN_WINDOW_MS, max: SEND_CONTROL_BUDGET_MAX_WINDOW_MS,
      }),
      limit: boundedInteger(budget.limit, DEFAULT_SEND_CONTROL.budget.limit, {
        min: 1, max: SEND_CONTROL_BUDGET_MAX_LIMIT,
      }),
    }),
    quietHours: Object.freeze({
      enabled: enabled(quietHours.enabled),
      start: clockTime(quietHours.start, DEFAULT_SEND_CONTROL.quietHours.start),
      end: clockTime(quietHours.end, DEFAULT_SEND_CONTROL.quietHours.end),
      timezone: timezone(quietHours.timezone),
    }),
    dryRun: Object.freeze({ enabled: enabled(dryRun.enabled) }),
  });
}

function minutesOfDay(now, timeZone) {
  const date = new Date(now);
  if (!timeZone) return date.getHours() * 60 + date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return date.getHours() * 60 + date.getMinutes();
    return (hour % 24) * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

function clockMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/** True when `now` falls inside the configured quiet window (cross-midnight OK). */
export function isWithinQuietHours(now, quietHours, { timeZone } = {}) {
  const config = quietHours && typeof quietHours === 'object' ? quietHours : {};
  const start = clockMinutes(clockTime(config.start, DEFAULT_SEND_CONTROL.quietHours.start));
  const end = clockMinutes(clockTime(config.end, DEFAULT_SEND_CONTROL.quietHours.end));
  const zone = timeZone ?? timezone(config.timezone);
  const current = minutesOfDay(now, zone);
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** Normalize persisted budget usage. Damaged values read as an empty window. */
export function parseSendControlUsage(value) {
  const events = value && Array.isArray(value.events) ? value.events : [];
  const normalized = [];
  for (const event of events.slice(-SEND_CONTROL_USAGE_MAX_EVENTS)) {
    if (!event || typeof event !== 'object') continue;
    const at = Number(event.at);
    const segments = Number(event.segments);
    if (!Number.isFinite(at) || at < 0 || !Number.isFinite(segments) || segments < 1) continue;
    normalized.push({ at: Math.trunc(at), segments: Math.min(Math.trunc(segments), 10_000) });
  }
  return { events: normalized };
}

function windowTotal(usage, now, windowMs) {
  const events = usage && Array.isArray(usage.events) ? usage.events : [];
  const floor = now - windowMs;
  let total = 0;
  for (const event of events) {
    if (event && event.at > floor) total += event.segments;
  }
  return total;
}

/** Append one real send (segment count) and drop events outside the window. */
export function recordSendUsage(usage, { now, segments, windowMs }) {
  const events = (usage && Array.isArray(usage.events) ? usage.events : [])
    .filter((event) => event && event.at > now - windowMs);
  events.push({ at: now, segments: Math.max(1, Math.trunc(segments) || 1) });
  return { events: events.slice(-SEND_CONTROL_USAGE_MAX_EVENTS) };
}

/**
 * Evaluate one outbound attempt. Pause is handled by the channel before this;
 * the policy order here is dry-run -> budget -> quiet hours.
 */
export function evaluateSendGate({ config, usage, now = Date.now(), segments = 1 } = {}) {
  const normalized = normalizeSendControl(config);
  const count = Math.max(1, Math.trunc(Number(segments) || 1));
  if (normalized.dryRun.enabled) return { action: 'dry-run', reason: 'dry-run', segments: count };
  if (normalized.budget.enabled) {
    const used = windowTotal(usage, now, normalized.budget.windowMs);
    if (used + count > normalized.budget.limit) {
      return {
        action: 'deny-budget', reason: 'budget-exhausted', used, limit: normalized.budget.limit, segments: count,
      };
    }
  }
  if (normalized.quietHours.enabled && isWithinQuietHours(now, normalized.quietHours)) {
    return { action: 'defer-quiet', reason: 'quiet-hours', segments: count };
  }
  return { action: 'allow', reason: 'allowed', segments: count };
}

/** In-memory dry-run candidates. Never persisted and never sent. */
export function createDryRunRecorder({ ttlMs = 10 * 60_000, max = 200, now = () => Date.now() } = {}) {
  const entries = [];
  const prune = (current) => {
    while (entries.length > 0 && current - entries[0].at > ttlMs) entries.shift();
    while (entries.length > max) entries.shift();
  };
  return {
    record(entry = {}) {
      const current = now();
      entries.push({ ...entry, at: current });
      prune(current);
    },
    list() {
      prune(now());
      return entries.map((entry) => ({ ...entry }));
    },
    size() {
      prune(now());
      return entries.length;
    },
  };
}

/**
 * In-memory queue for outbound items deferred by quiet hours. Bounded per
 * conversation; expired or overflowing items are dropped and reported so the
 * caller can log a warning instead of silently piling up.
 */
export function createQuietQueue({
  maxPerKey = 20, ttlMs = 6 * 60 * 60_000, now = () => Date.now(),
} = {}) {
  const queues = new Map();
  const dropped = { overflow: 0, expired: 0 };
  function prune(key, current) {
    const queue = queues.get(key);
    if (!queue) return queue;
    while (queue.length > 0 && current - queue[0].at > ttlMs) {
      queue.shift();
      dropped.expired += 1;
    }
    if (queue.length === 0) queues.delete(key);
    return queue;
  }
  return {
    enqueue(key, item) {
      const current = now();
      const queue = prune(key, current) ?? [];
      if (!queues.has(key)) queues.set(key, queue);
      queue.push({ ...item, at: current });
      let overflow = false;
      while (queue.length > maxPerKey) {
        queue.shift();
        dropped.overflow += 1;
        overflow = true;
      }
      return { queued: true, overflow, size: queue.length };
    },
    takeAll(key) {
      prune(key, now());
      const queue = queues.get(key) ?? [];
      queues.delete(key);
      return queue.map((entry) => ({ ...entry }));
    },
    size(key) {
      const queue = prune(key, now());
      return queue ? queue.length : 0;
    },
    dropExpired() {
      const current = now();
      for (const key of [...queues.keys()]) prune(key, current);
      return { ...dropped };
    },
    keys() {
      const current = now();
      for (const key of [...queues.keys()]) prune(key, current);
      return [...queues.keys()];
    },
    stats() {
      return { ...dropped, keys: queues.size };
    },
  };
}
