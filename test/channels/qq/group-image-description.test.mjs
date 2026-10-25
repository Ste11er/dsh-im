import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupImageDescriber } from '../../../plugin-src/host/channels/qq/group-image-description.mjs';
import { DEFAULT_IMAGE_INPUT_SETTINGS } from '../../../src/channels/shared/image-input-policy.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function fixture({ reason = 'completed', blocks = [{ type: 'text', text: '图片中是销售图表。' }], vision = true, wait, disposeError } = {}) {
  const calls = { dispose: 0, cancel: 0, hooks: {} };
  const model = { provider: 'p', model: 'vision' };
  const agent = { id: 'isolated-image-session', session: { snapshotEvents: () => [
    { type: 'assistant/message', data: { turn: 1, message: { content: blocks, source: model }, usage: { outputTokens: 10 } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: reason } } },
  ] }, followup: input => { calls.input = input; }, cancel: () => { calls.cancel++; },
    whenIdle: async () => { await calls.hooks['agent/request']({ step: 1 }, async () => ({})); await wait?.(); } };
  const services = {
    llm: { resolveModelInfo: async () => ({ inputModalities: vision ? ['text', 'image'] : ['text'] }) },
    attachments: { admitPromptContent: async content => { calls.content = content; return content.map(part => part.type === 'image'
      ? { type: 'image', attachment: { attachmentId: 'test', mediaType: part.mediaType, bytes: PNG.length } } : part); } },
    agents: { create: async options => {
      calls.options = options;
      options.setup({ get: name => name === 'tools' ? {
        presentAs: value => { calls.presentation = value; }, restrict: value => { calls.restriction = value; }, guard: value => { calls.guard = value; },
      } : { section: value => { calls.system = value; } }, on: (name, fn) => { calls.hooks[name] = fn; } });
      return { agent, dispose: async () => { calls.dispose++; if (disposeError) throw disposeError; } };
    } },
  };
  const describe = createGroupImageDescriber({ get: name => services[name] }, () => model, async () => DEFAULT_IMAGE_INPUT_SETTINGS);
  return { calls, describe };
}
const input = signal => ({ images: [{ data: PNG }], text: '图表', signal });

test('image memory runs a real Agent contract with admitted images, no tools and model provenance', async () => {
  const f = fixture();
  const value = await f.describe(input(new AbortController().signal));
  assert.equal(value.text, '图片中是销售图表。');
  assert.equal(value.sessionId, 'isolated-image-session');
  assert.equal(value.usage.outputTokens, 10);
  assert.equal(f.calls.presentation, 'native');
  assert.deepEqual(f.calls.restriction, { allow: [] });
  assert.equal(typeof f.calls.guard(), 'string');
  assert.equal(f.calls.system.complete, true);
  assert.equal(f.calls.input.content.find(part => part.type === 'image').attachment.attachmentId, 'test');
  assert.equal(f.calls.dispose, 1);
  await assert.rejects(f.calls.hooks['agent/request']({ step: 2 }, async () => ({})), /step limit/);
});

test('vision failures, truncation, tools and empty results never become a successful image description', async () => {
  for (const options of [{ vision: false }, { reason: 'max-tokens' }, { reason: 'error' },
    { blocks: [] }, { blocks: [{ type: 'tool-call', name: 'bash' }] }]) {
    const f = fixture(options);
    await assert.rejects(f.describe(input(new AbortController().signal)));
    assert.equal(f.calls.dispose, options.vision === false ? 0 : 1);
  }
});

test('Agent cancellation is propagated and a cleanup failure preserves the original failure', async () => {
  const controller = new AbortController();
  const f = fixture({ wait: async () => controller.abort() });
  await assert.rejects(f.describe(input(controller.signal)), { name: 'AbortError' });
  assert.equal(f.calls.cancel, 1);
  assert.equal(f.calls.dispose, 1);
  const cleanup = fixture({ reason: 'error', disposeError: Error('dispose failed') });
  await assert.rejects(cleanup.describe(input(new AbortController().signal)), error => error instanceof AggregateError && error.errors.length === 2);
});
