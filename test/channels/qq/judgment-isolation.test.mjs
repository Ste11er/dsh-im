import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupParticipationReply } from '../../../plugin-src/host/channels/qq/group-participation-reply.mjs';
import { QqGroupParticipation } from '../../../src/channels/qq/group-participation.mjs';

function fixture(output = '[[QQ_REPLY]]') {
  const observed = { replies: 0 }; const hooks = new Map();
  const judge = createGroupParticipationReply({ get: name => name === 'agents' ? { create: async options => {
    options.setup({ get: key => key === 'tools' ? { presentAs() {}, restrict() {}, guard() {} } : { section: value => { observed.section = value; } },
      on: (name, handler) => hooks.set(name, handler) });
    return { agent: { followup: input => { observed.input = input; }, cancel() {}, whenIdle: async () => {
      observed.assembly = await hooks.get('system-prompt/assemble')({}, {}, async () => ({
        sections: [{ name: 'host-chat-persona', text: 'UNRELATED_CHAT_ROLE' }],
        contexts: [{ name: 'chat-style', text: 'UNRELATED_CHAT_CONTEXT' }], tools: [{ name: 'host_tool' }, { name: 'web_search' }, { name: 'web_fetch' }],
      }));
    }, session: { snapshotEvents: () => [
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: output }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ] } }, dispose: async () => {} };
  } } : undefined }, () => ({ provider: 'p', model: 'judge' }));
  const run = () => judge({ content: 'quoted group question', signal: new AbortController().signal,
    deliveryContext: { persona: { enabled: true, text: 'ROLE_CANARY: 你是大肥鱼，必须用聊天口吻回复。' } },
    reply: async () => { observed.replies++; return {}; } });
  return { observed, run };
}

test('judge final assembly isolates its role while retaining persona only as quoted reference data', async () => {
  const f = fixture(); await f.run();
  assert.doesNotMatch(f.observed.section.text, /ROLE_CANARY/);
  assert.deepEqual(f.observed.assembly.contexts, []);
  assert.deepEqual(f.observed.assembly.tools, []);
  assert.equal(f.observed.assembly.sections.length, 1);
  assert.doesNotMatch(f.observed.assembly.sections[0].text, /UNRELATED_CHAT|ROLE_CANARY/);
  assert.match(f.observed.input.content.map(block => block.text).join('\n'), /<dsh_im_qq_bot_profile>.*ROLE_CANARY/s);
  assert.equal(f.observed.replies, 1);
});

test('historical mixed decision/body and prose-only failures remain explicit judgment errors with no QQ reply', async () => {
  for (const output of ['[[QQ_REPLY]]\n图里没有显示艾特对象。', '[[QQ_REPLY]] 图里没有显示艾特对象。', '你让我回话，但我不是那个人。', '']) {
    const f = fixture(output);
    await assert.rejects(f.run(), { code: 'qq-judgment-invalid' });
    assert.equal(f.observed.replies, 0);
  }
});

test('judgment protocol failure is distinguished from delivery failure in participation status', async () => {
  const p = new QqGroupParticipation({ logger: { error() {} } });
  p.set({ enabled: true, cooldownSeconds: 1 });
  await p.consider('g', async () => { const error = new Error('private output'); error.code = 'qq-judgment-invalid'; throw error; });
  assert.deepEqual(p.status.lastError, { code: 'qq-judgment-invalid' });
  assert.equal(p.status.replied, 0);
});
