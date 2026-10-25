import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
import { installQqWebContext } from '../../../plugin-src/host/channels/qq/web-context.mjs';

test('QQ web guidance follows actual scoped tools and only the owned reply, including mentioned turns', () => {
  const registry = new OutboundArtifactRegistry(); let context; let available = ['web_search', 'web_fetch'];
  const agent = { session: { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] } };
  installQqWebContext({ tools: { schemas: scope => { assert.equal(scope, agent); return available.map(name => ({ name })); } },
    systemPrompt: { context: value => { context = value; } } }, { registry });
  const render = () => context.text({ agent });
  assert.equal(render(), '');
  const close = registry.openConsumer('s', 'rpc', { channel: 'qq', conversationType: 'group' });
  registry.observeClaimedMessage(agent.session, { source: { rpcId: 'rpc' } }, 1);
  let text = render(); assert.match(text, /web_search/); assert.match(text, /web_fetch/);
  assert.match(text, /来源/); assert.match(text, /不可信/); assert.match(text, /失败/); assert.match(text, /关键词/);
  available = ['web_fetch']; text = render(); assert.doesNotMatch(text, /web_search/); assert.match(text, /web_fetch/);
  available = []; assert.equal(render(), '');
  close(); available = ['web_search']; assert.equal(render(), '');
});
