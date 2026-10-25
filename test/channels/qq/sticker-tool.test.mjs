import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboundArtifactRegistry } from '../../../src/channels/shared/semantic/artifact.mjs';
import { createQqStickerTool, installQqStickerTool } from '../../../plugin-src/host/channels/qq/sticker-tool.mjs';

function consumer(registry, context) {
  const session = { id: 's', snapshot: { turn: 1 } };
  const close = registry.openConsumer('s', 'rpc', context);
  registry.observeSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
  registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  return { session, close };
}
const enabled = { channel: 'qq', conversationType: 'group', stickersEnabled: true };
test('sticker tool permits only the enabled QQ group turn and cannot change recipient or URL', async () => {
  const registry = new OutboundArtifactRegistry();
  const calls = [];
  const catalog = { search: async query => { calls.push(query); return { items: [] }; }, get: async (id, options) => { assert.equal(options.cachedOnly, true); return { id, path: '/cache/image.png', sourceUrl: 'https://example.com/source', digest: 'a'.repeat(64) }; } };
  const definition = createQqStickerTool({ registry, catalog }).definition;
  for (const context of [undefined, { ...enabled, channel: 'telegram' }, { ...enabled, conversationType: 'direct' }, { ...enabled, stickersEnabled: false }]) {
    const { session, close } = consumer(registry, context);
    await assert.rejects(definition.execute({ query: '开心' }, { agent: { session } }), /enabled QQ group/);
    close();
  }
  const { session, close } = consumer(registry, enabled);
  const exec = { agent: { session } };
  for (const args of [{ query: '开心', url: 'https://evil.com' }, { id: 'one', groupId: 'other' }, { query: 'a', id: 'b' }, {}, { query: '' }]) {
    await assert.rejects(definition.execute(args, exec), /query or id/);
  }
  assert.deepEqual(await definition.execute({ query: '开心' }, exec), { items: [] });
  const result = await definition.execute({ id: 'one' }, exec);
  const render = JSON.stringify(definition.output.render({}, result));
  assert.match(render, /https:\/\/example.com\/source/);
  assert.match(render, /aaaaaaaa/);
  close();
  await assert.rejects(definition.execute({ query: '开心' }, exec), /enabled QQ group/);
  assert.deepEqual(calls, ['开心']);
});
test('sticker guidance is scoped to trusted delivery metadata', () => {
  const registry = new OutboundArtifactRegistry();
  let guidance;
  const registered = [];
  installQqStickerTool({ tools: { register: tool => registered.push(tool) }, systemPrompt: { context: value => { guidance = value; } } }, { registry, catalog: {} });
  assert.equal(registered.length, 1);
  const { session, close } = consumer(registry, enabled);
  assert.match(guidance.text({ agent: { session } }), /dsh_im_return_file/);
  close();
  assert.equal(guidance.text({ agent: { session } }), '');
});

test('cached search candidates authorize only trusted returned paths for this autonomous turn', async () => {
  const { participationToolGuard } = await import('../../../plugin-src/host/channels/qq/participation-context.mjs');
  const registry = new OutboundArtifactRegistry();
  const { session, close } = consumer(registry, { ...enabled, autonomous: true });
  const tool = createQqStickerTool({ registry, catalog: { search: async (_query, options) => {
    assert.equal(options.cachedOnly, true); assert.ok(options.maxBytes > 0);
    return { items: [{ id: 'one', path: '/cache/verified.png' }] };
  } } }).definition;
  await tool.execute({ query: '开心' }, { agent: { session } });
  const exec = { agent: { session }, name: 'dsh_im_return_file', arguments: { path: '/cache/verified.png' } };
  assert.equal(participationToolGuard(registry, exec), undefined);
  assert.equal(typeof participationToolGuard(registry, { ...exec, arguments: { path: '/private/other' } }), 'string');
  close(); assert.equal(typeof participationToolGuard(registry, exec), 'string');
});

test('empty searches and explicit unsuitable-candidate reports record missing scenes without downloading', async () => {
  const registry = new OutboundArtifactRegistry(); const { session, close } = consumer(registry, enabled);
  const recorded = []; const definition = createQqStickerTool({ registry,
    catalog: { search: async (_query, options) => { assert.equal(options.cachedOnly, true); return { items: [] }; }, get: () => assert.fail('no image download') },
    misses: { record: async query => { recorded.push(query); return { recorded: true }; } } }).definition;
  const exec = { agent: { session } };
  assert.equal((await definition.execute({ query: '委屈吃饭' }, exec)).missing.recorded, true);
  assert.equal((await definition.execute({ missing: '候选不贴切，需要吐槽加班' }, exec)).recorded, true);
  assert.deepEqual(recorded, ['委屈吃饭', '候选不贴切，需要吐槽加班']); close();
});
