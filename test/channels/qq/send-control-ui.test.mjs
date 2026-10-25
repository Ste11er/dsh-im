import assert from 'node:assert/strict';
import test from 'node:test';

import { QQ_ENDPOINTS, normalizeSnapshot } from '../../../plugin-src/client/channels/qq/api.js';

test('QQ client exposes the send-control endpoint', () => {
  assert.equal(QQ_ENDPOINTS.setSendControl, 'bot.send-control.set');
});

test('QQ client snapshots normalize send control with disabled defaults', () => {
  const snapshot = normalizeSnapshot({
    bots: [
      { botId: 'qq_default', connected: true, state: 'connected' },
      {
        botId: 'qq_custom',
        connected: true,
        state: 'connected',
        sendControl: {
          budget: { enabled: true, windowMs: 120_000, limit: 7 },
          quietHours: { enabled: true, start: '22:00', end: '07:30', timezone: 'Asia/Shanghai' },
          dryRun: { enabled: true },
        },
      },
    ],
  });
  const [fallback, custom] = snapshot.bots;
  assert.equal(fallback.sendControl.budget.enabled, false);
  assert.equal(fallback.sendControl.quietHours.enabled, false);
  assert.equal(fallback.sendControl.dryRun.enabled, false);
  assert.deepEqual(custom.sendControl.budget, { enabled: true, windowMs: 120_000, limit: 7 });
  assert.deepEqual(custom.sendControl.quietHours, {
    enabled: true, start: '22:00', end: '07:30', timezone: 'Asia/Shanghai',
  });
  assert.equal(custom.sendControl.dryRun.enabled, true);
});

test('QQ client snapshots ignore damaged send-control values', () => {
  const snapshot = normalizeSnapshot({
    bots: [{
      botId: 'qq_bad',
      connected: true,
      state: 'connected',
      sendControl: { budget: { enabled: 'yes', windowMs: -1, limit: 0 }, quietHours: 'nope', dryRun: [] },
    }],
  });
  const config = snapshot.bots[0].sendControl;
  assert.equal(config.budget.enabled, false);
  assert.ok(config.budget.windowMs > 0);
  assert.ok(config.budget.limit >= 1);
  assert.equal(config.quietHours.enabled, false);
  assert.equal(config.dryRun.enabled, false);
});
