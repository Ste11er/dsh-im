import assert from 'node:assert/strict';
import test from 'node:test';
import { installQqCapabilitiesContext } from '../../../plugin-src/host/channels/qq/capabilities-context.mjs';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
test('QQ current capability facts are scoped to the active reply and distinguish enabled from delivered', () => {
  const registry = new OutboundArtifactRegistry(); let section;
  installQqCapabilitiesContext({ systemPrompt: { context: value => { section = value; } } }, { registry });
  const session = { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  assert.equal(section.text({ agent: { session } }), '');
  const close = registry.openConsumer('s', 'rpc', { channel: 'qq', qqCapabilities: { groupParticipationImplemented: true, groupParticipationEnabled: true, participationStats: { replied: 0 } } });
  registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  const text = section.text({ agent: { session } }); assert.match(text, /"groupParticipationImplemented":true/); assert.match(text, /不等于/); assert.match(text, /P2′/);
  close(); assert.equal(section.text({ agent: { session } }), '');
});
