import assert from 'node:assert/strict';
import test from 'node:test';
import { installQqParticipationPolicy } from '../../../plugin-src/host/channels/qq/participation-policy.mjs';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';

test('shared Agent policy restricts only the owned autonomous turn and restores normal conversation tools', async () => {
  const registry = new OutboundArtifactRegistry(); const hooks = new Map(); let guard; let cleanup; let mode = 'ptc'; let restored = 0; let cancelled = 0;
  const definitions = ['dsh_qq_sticker', 'dsh_im_return_file', 'dsh_qq_memory', 'bash', 'spawn_teammate'].map(name => ({ name }));
  const tools = { guard: value => { guard = value; }, schemas: () => definitions, modeFor: () => mode,
    presentAs: value => { assert.equal(mode, 'ptc'); mode = value; return () => { mode = 'ptc'; restored++; }; } };
  const ctx = { tools, systemPrompt: {}, on: (name, handler) => hooks.set(name, handler), effect: setup => { cleanup = setup(); } };
  installQqParticipationPolicy(ctx, { registry });
  const session = { id: 'same-group-session', snapshot: { turn: 1 } };
  const agent = { session, ctx: { get: name => { assert.equal(name, 'tools'); return tools; } }, cancel: () => { cancelled++; } };
  const assembly = { sections: [{ name: 'coding', text: 'execute operations' }], tools: definitions,
    contexts: [{ name: 'dsh-im:qq-persona', text: '大肥鱼' }, { name: 'workspace', text: 'workspace instructions' }] };
  const assemble = () => hooks.get('system-prompt/assemble')(assembly, { agent }, async () => assembly);
  assert.equal(await assemble(), assembly); assert.equal(guard({ agent, name: 'bash' }), undefined);
  const controller = new AbortController();
  const close = registry.openConsumer(session.id, 'rpc', { channel: 'qq', conversationType: 'group', autonomous: true, autonomousSignal: controller.signal });
  registry.observeSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
  registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  hooks.get('agent/inbox/claimed')({ agent, turn: 1 });
  assert.equal(mode, 'native');
  const limited = await assemble();
  assert.deepEqual(limited.tools.map(tool => tool.name), ['dsh_qq_sticker', 'dsh_im_return_file', 'dsh_qq_memory']);
  assert.deepEqual(limited.contexts.map(item => item.name), ['dsh-im:qq-persona']);
  assert.match(limited.sections[0].text, /assistant.*之前说过的话/);
  assert.equal(guard({ agent, name: 'dsh_qq_sticker' }), undefined);
  for (const name of ['bash', 'spawn_teammate', 'run_code', 'dsh_im_return_file']) assert.equal(typeof guard({ agent, name, arguments: { path: '/private/other' } }), 'string');
  hooks.get('session/event')(session, { type: 'turn/end', data: { turn: 0 } }); assert.equal(restored, 0);
  close(); assert.equal(typeof guard({ agent, name: 'dsh_qq_sticker' }), 'string', 'an abandoned caller cannot unlock an ongoing turn');
  controller.abort(); assert.equal(cancelled, 1); assert.equal(restored, 0);
  hooks.get('session/event')(session, { type: 'turn/end', data: { turn: 1 } });
  assert.equal(mode, 'ptc'); assert.equal(restored, 1); assert.equal(await assemble(), assembly);
  assert.equal(guard({ agent, name: 'bash' }), undefined);
  cleanup(); assert.equal(restored, 1);
});
