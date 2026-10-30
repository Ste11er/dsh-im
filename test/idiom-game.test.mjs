import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { createIdiomGameTool, installIdiomGame } from '../plugin-src/host/idiom-game-tool.mjs';
import { OutboundArtifactRegistry } from '../src/channels/shared/semantic/artifact.mjs';
import { restrictedQqToolGuard } from '../plugin-src/host/channels/qq/participation-context.mjs';

const run = promisify(execFile);
const fixture = async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-game-test-');
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = createIdiomGameTool({ stateDirectory, logger: { error() {} } });
  t.after(() => game.close());
  return game;
};
const exec = (id, sessionId = 'group-one') => ({ callId: id, agent: { session: { id: sessionId } } });

test('the referee never invents an answer at start or after a finished round', async t => {
  const game = await fixture(t);
  await assert.rejects(game.definition.execute({ action: 'start' }, exec('missing-answer')), { code: 'answer-required' });
  const started = await game.definition.execute({ action: 'start', answer: '原神启动', pinyin: ['yuan2','shen2','qi3','dong4'], limit: 3 }, exec('ai-question'));
  assert.equal(started.used, 0); assert.doesNotMatch(JSON.stringify(started), /原神启动/);
  const won = await game.definition.execute({ guess: '原神启动' }, exec('win-ai-question'));
  assert.equal(won.answer, '原神启动'); assert.equal(won.nextQuestionRequired, true);
  assert.equal((await game.definition.execute({ action: 'status' }, exec('after'))).active, false);
});

test('the independent Python rule suite runs actual scoring, exhaustion, concurrency and persistence', async () => {
  const { stderr } = await run('python3', ['-B', 'test/idiom-game-python.py']);
  assert.match(stderr, /\bOK\b/);
});

test('native adapter uses the real Python engine, keeps secrets out of context and preserves game scope', async t => {
  const game = await fixture(t);
  const start = await game.definition.execute({ action: 'start', answer: '耳濡目染' }, exec('start'));
  assert.equal(start.remaining, 10); assert.doesNotMatch(JSON.stringify(start), /耳濡目染/);
  const first = await game.definition.execute({ guess: '星罗棋布' }, exec('guess'));
  assert.equal(first.used, 1); assert.equal(first.colors.声调[1], '🟩');
  assert.equal(first.parts[0][1], 'x'); assert.equal(first.parts[0][2], 'ing');
  assert.deepEqual(await game.definition.execute({ guess: '星罗棋布' }, exec('guess')), first);
  assert.match(game.context(exec('read').agent.session), /已用1\/10/);
  assert.doesNotMatch(game.context(exec('read').agent.session), /耳濡目染/);
  assert.equal(game.context(exec('other', 'another-group').agent.session), '');
  const won = await game.definition.execute({ guess: '耳濡目染' }, exec('win'));
  assert.equal(won.status, 'won'); assert.equal(won.colors.声母[0], '⬜'); assert.equal(won.nextQuestionRequired, true);
});

test('new modes, weighted tiers and AI vocabulary additions pass through the native adapter', async t => {
  const game = await fixture(t);
  const start = await game.definition.execute({ action: 'start', answer: '一心一意', limit: 3, weights: { common: 1, normal: 0, rare: 0 } }, exec('start'));
  assert.equal(start.limit, 3); assert.equal(start.tier, 'common');
  const add = await game.definition.execute({ action: 'add_word', word: '笃行不怠', pinyin: ['du3', 'xing2', 'bu4', 'dai4'] }, exec('add'));
  assert.equal(add.added, true);
  const status = await game.definition.execute({ action: 'status' }, exec('status')); assert.equal(status.used, 0);
  const found = await game.definition.execute({ action: 'lookup', word: '笃行不怠' }, exec('lookup')); assert.equal(found.found, true);
  const other = await game.definition.execute({ action: 'lookup', word: '笃行不怠' }, exec('other', 'other-group')); assert.equal(other.found, false);
  await assert.rejects(game.definition.execute({ action: 'set_limit', limit: 15 }, exec('old-mode')), { code: 'invalid-limit' });
});

test('one dedicated interface adds arbitrary four-character phrases and scores the same guess exactly once', async t => {
  const game = await fixture(t);
  await game.definition.execute({ action: 'start', answer: '耳濡目染' }, exec('start'));
  const request = { action: 'add_and_guess', word: '原神启动', pinyin: ['yuan2', 'shen2', 'qi3', 'dong4'] };
  const first = await game.definition.execute(request, exec('phrase'));
  assert.equal(first.vocabulary.added, true); assert.equal(first.used, 1); assert.ok(first.board);
  assert.deepEqual(await game.definition.execute(request, exec('phrase')), first);
  const status = await game.definition.execute({ action: 'status' }, exec('status'));
  assert.equal(status.used, 1);
  assert.equal((await game.definition.execute({ action: 'lookup', word: '原神启动' }, exec('lookup'))).found, true);
  assert.equal((await game.definition.execute({ action: 'lookup', word: '原神启动' }, exec('other', 'another-group'))).found, false);
  await assert.rejects(game.definition.execute({ action: 'add_and_guess', word: '一一得一', pinyin: ['yi1'] }, exec('bad-reading')));
  assert.equal((await game.definition.execute({ action: 'status' }, exec('after-bad'))).used, 1);
  assert.equal((await game.definition.execute({ action: 'lookup', word: '一一得一' }, exec('not-added'))).found, false);
});

test('the exact bundled skill is registered with DSH and available through the safe rules action', async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-register-test-'); t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  let skill, definition, context, dispose;
  const game = installIdiomGame({ tools: { register: value => { definition = value; } },
    skills: { register: value => { skill = value; } }, systemPrompt: { context: value => { context = value; } },
    effect: fn => { dispose = fn(); } }, { stateDirectory });
  t.after(() => dispose());
  assert.equal(skill.name, 'guess-idiom'); assert.equal(definition.name, 'dsh_idiom_game');
  assert.equal(context.text({ agent: exec('nothing').agent }), '');
  const rules = await game.definition.execute({ action: 'rules' }, exec('rules'));
  assert.equal(rules.instructions, skill.content); assert.match(skill.content, /你是主持人/);
  assert.ok(Buffer.byteLength(rules.instructions) < 6000);
});

test('untrusted arguments cannot choose operation identity, execute commands or access arbitrary files', async t => {
  const game = await fixture(t);
  assert.throws(() => game.definition.execute({ action: 'status', requestId: 'forged' }, exec('fake')));
  await assert.rejects(game.definition.execute({ action: 'start', command: 'touch /tmp/should-not-run' }, exec('evil')), { code: 'invalid-request' });
  await assert.rejects(game.definition.execute({ action: 'start', stateDir: '/tmp/other' }, exec('path')), { code: 'invalid-request' });
  assert.throws(() => game.definition.execute({ action: 'start' }, { callId: 'no-agent' }));
  assert.equal(game.context(exec('check').agent.session), '');
});

test('timeouts and cancellation remain unknown/failure, never a fabricated successful score', async t => {
  const stateDirectory = await mkdtemp('/tmp/idiom-timeout-test-'); t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const game = createIdiomGameTool({ stateDirectory, timeoutMs: 1, logger: { error() {} } }); t.after(() => game.close());
  await assert.rejects(game.definition.execute({ action: 'start' }, exec('timeout')), { code: 'idiom-operation-unknown' });
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  assert.throws(() => game.definition.execute({ action: 'start' }, { ...exec('cancelled'), signal: controller.signal }), /cancelled/);
});

test('a non-owner QQ turn can use only the dedicated referee, not general Python or shell tools', () => {
  const registry = new OutboundArtifactRegistry();
  const session = { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] };
  const close = registry.openConsumer('s', 'rpc', { channel: 'qq', computerCommandAuthorized: false });
  registry.observeClaimedMessage(session, { source: { rpcId: 'rpc' } }, 1);
  const agent = { session };
  assert.equal(restrictedQqToolGuard(registry, { agent, name: 'dsh_idiom_game' }), undefined);
  for (const name of ['bash', 'pwsh', 'run_code', 'python', 'read_file', 'spawn_teammate']) {
    assert.match(restrictedQqToolGuard(registry, { agent, name }), /只有机器人拥有者/);
  }
  close(); assert.match(restrictedQqToolGuard(registry, { agent, name: 'dsh_idiom_game' }), /已结束或缺少授权/);
});
