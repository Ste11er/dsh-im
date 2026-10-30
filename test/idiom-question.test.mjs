import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseIdiomQuestion } from '../plugin-src/host/channels/qq/idiom-question.mjs';

test('only the difficulty is sampled; the exact word and reading come from the model', async () => {
  let request;
  const llm = { async *stream(options) {
    request = options;
    yield { type: 'text-delta', text: '{"answer":"原神启动","pinyin":["yuan2","shen2","qi3","dong4"]}' };
    yield { type: 'usage', usage: { inputTokens: 90, outputTokens: 25 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  const result = await chooseIdiomQuestion(llm, { weights: { common: 1, normal: 0, rare: 0 } }, { provider: 'selected', model: 'flash', reasoningEffort: 'off' });
  assert.equal(result.answer, '原神启动'); assert.equal(result.tier, 'common'); assert.equal(result.usage.outputTokens, 25);
  assert.equal(request.messages.length, 1); assert.equal(request.sessionId, undefined);
  assert.match(request.messages[0].content[0].text, /常见/); assert.equal(request.provider, 'selected');
});

test('invalid or interrupted model questions never become a random substitute answer', async () => {
  for (const value of ['{}', '{"answer":"三个字","pinyin":[]}', 'invalid']) {
    const llm = { async *stream() { yield { type: 'text-delta', text: value }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
    await assert.rejects(chooseIdiomQuestion(llm, {}, { provider: 'selected', model: 'flash' }));
  }
});
