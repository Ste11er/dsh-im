import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupMemorySummarizer } from '../../../plugin-src/host/channels/qq/group-memory-summary.mjs';

function fixture(chunks, custom = null) {
  const calls = [];
  const ctx = { get: (name) => name === 'llm' ? { stream: async function* (options) {
    calls.push(options); yield* chunks;
  } } : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'default', model: 'model' }) } : undefined };
  return { calls, summarize: createGroupMemorySummarizer(ctx, () => custom) };
}

test('memory summarizer uses selected/default model without tools or a user session', async () => {
  const f = fixture([
    { type: 'text-delta', index: 0, text: '项目' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '项目周五发布。' } },
    { type: 'reasoning-delta', index: 1, text: 'private reasoning' },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 15 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ], { provider: 'bot', model: 'chosen' });
  const value = await f.summarize({ messages: [{ content: '周五发布' }], signal: new AbortController().signal });
  assert.equal(value.text, '项目周五发布。');
  assert.deepEqual(value.model, { provider: 'bot', model: 'chosen' });
  assert.equal(value.usage.inputTokens, 100);
  assert.equal(Object.hasOwn(f.calls[0], 'sessionId'), false);
  assert.deepEqual(f.calls[0].tools, []);
  assert.equal(f.calls[0].purpose, 'compaction');
  const fallback = fixture([{ type: 'text-delta', index: 0, text: 'summary' }, { type: 'finish', reason: { kind: 'stop' } }]);
  assert.equal((await fallback.summarize({ messages: [], signal: new AbortController().signal })).model.provider, 'default');
});

for (const kind of ['error', 'aborted', 'max-tokens', 'tool-calls']) {
  test(`memory summarizer rejects partial output ending in ${kind}`, async () => {
    const f = fixture([{ type: 'text-delta', index: 0, text: 'partial' }, {
      type: 'finish', reason: { kind, failure: { code: 'provider-failed', message: 'provider failure' } },
    }]);
    await assert.rejects(f.summarize({ messages: [], signal: new AbortController().signal }));
  });
}

test('memory summarizer rejects missing finish, empty output and unavailable services', async () => {
  for (const chunks of [[], [{ type: 'text-delta', index: 0, text: 'partial' }], [{ type: 'finish', reason: { kind: 'stop' } }]]) {
    const f = fixture(chunks);
    await assert.rejects(f.summarize({ messages: [], signal: new AbortController().signal }));
  }
  await assert.rejects(createGroupMemorySummarizer({ get: () => undefined }, () => null)({ messages: [], signal: new AbortController().signal }), /unavailable/);
});

test('summary blocks follow first-seen order and ignore deltas after block end', async () => {
  const f = fixture([
    { type: 'block-start', index: 21, blockType: 'text' },
    { type: 'block-start', index: 4, blockType: 'text' },
    { type: 'block-end', index: 4, block: { type: 'text', text: 'second' } },
    { type: 'text-delta', index: 4, text: 'late duplicate' },
    { type: 'block-end', index: 21, block: { type: 'text', text: 'first' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const value = await f.summarize({ messages: [], signal: new AbortController().signal });
  assert.equal(value.text, 'first\nsecond');
});

test('summary timeout and unexpected tool blocks are failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture([]);
  const promise = f.summarize({ messages: [], signal: new AbortController().signal });
  t.mock.timers.tick(90_000);
  await assert.rejects(promise, { code: 'summary-timeout' });
  const tool = fixture([{ type: 'tool-call-delta', index: 0, id: 'tool' }]);
  await assert.rejects(tool.summarize({ messages: [], signal: new AbortController().signal }), { code: 'summary-tool-call' });
});
