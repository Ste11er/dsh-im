import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIdiomReading } from '../plugin-src/host/channels/qq/idiom-reading.mjs';

function provider(text, { finish = { kind: 'stop' }, usage } = {}) {
  let request;
  const llm = { stream(options) { request = options; return (async function* () {
    yield { type: 'text-delta', index: 0, text };
    if (usage) yield { type: 'usage', usage };
    yield { type: 'finish', reason: finish };
  })(); } };
  return { llm, request: () => request };
}
const options = () => ({ provider: 'configured-provider', model: 'configured-model', reasoningEffort: 'off', signal: new AbortController().signal });

test('reading confirmation sends only the word to the configured model and preserves actual usage', async () => {
  const pinyin = ['yuan2', 'shen2', 'qi3', 'dong4'];
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 15 };
  const f = provider(JSON.stringify({ pinyin }), { usage });
  assert.deepEqual(await resolveIdiomReading(f.llm, '原神启动', options()), { pinyin, usage });
  const request = f.request();
  assert.equal(request.provider, 'configured-provider'); assert.equal(request.reasoningEffort, 'off');
  assert.equal(request.messages.length, 2); assert.deepEqual(request.messages[1], { role: 'user', content: [{ type: 'text', text: '原神启动' }] });
  assert.deepEqual(request.tools, []); assert.equal(request.maxTokens, 256); assert.equal(request.sessionId, undefined);
});

test('uncertain reading remains explicitly unknown and absent usage is not fabricated as zero', async () => {
  const f = provider('{"pinyin":null}');
  assert.deepEqual(await resolveIdiomReading(f.llm, '陌生词组', options()), { pinyin: null, usage: undefined });
});

test('invalid and interrupted model results fail instead of creating vocabulary', async () => {
  for (const text of ['not json', 'null', '{"pinyin":["yi1"]}', '{"pinyin":[1,2,3,4]}', '{"pinyin":[],"command":"ignored"}']) {
    const f = provider(text);
    await assert.rejects(resolveIdiomReading(f.llm, '原神启动', options()), { code: 'idiom-reading-invalid' });
  }
  const incomplete = provider('{"pinyin":["yuan2","shen2","qi3","dong4"]}', { finish: { kind: 'max-tokens' } });
  await assert.rejects(resolveIdiomReading(incomplete.llm, '原神启动', options()), { code: 'idiom-reading-invalid' });
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  const aborted = provider('{"pinyin":null}');
  await assert.rejects(resolveIdiomReading(aborted.llm, '原神启动', { ...options(), signal: controller.signal }), /cancelled/);
});
