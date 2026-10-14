import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  initialAccessPolicyFor,
  newBotAccessPolicyFor,
} from '../../../plugin-src/host/channels/shared/access-policy-production.mjs';
import { BotWorkspaceStore } from '../../../src/channels/shared/bot-workspace-store.mjs';

function scope(mode, defaultCanExecuteCommands, users = []) {
  return {
    mode,
    open: { defaultCanExecuteCommands, commandPermissionOverrides: [] },
    allowlist: { users },
  };
}

const open = () => scope('open', true);
const allowlist = () => scope('allowlist', false);
const policy = (direct = open(), group = open()) => ({ direct, group });

const bot = (id, owner = `owner_${id}`) => ({
  id,
  botId: id,
  appId: `app_${id}`,
  secretRef: `secret_${id}`,
  ownerUserOpenid: owner,
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-qq-access-default-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const defaultWorkspace = join(root, 'workspace');
  await mkdir(defaultWorkspace);
  return { root, defaultWorkspace, path: join(root, 'workspaces.json') };
}

test('new QQ bots default to an open direct scope and a closed group scope', () => {
  const qq = newBotAccessPolicyFor('qq', bot('qq-new'));
  assert.deepEqual(qq, policy(open(), allowlist()));
  assert.equal(qq.group.mode, 'allowlist');
  assert.deepEqual(qq.group.allowlist.users, []);
  assert.equal(qq.group.open.defaultCanExecuteCommands, false);
  assert.equal(qq.direct.mode, 'open', 'WG-QQ-01 only tightens groups');
  assert.equal(qq.direct.open.defaultCanExecuteCommands, true);
});

test('QQ startup seeds use the tightened group default and the legacy group default', () => {
  const config = bot('qq-start');

  const modern = initialAccessPolicyFor('qq', config);
  assert.deepEqual(modern, policy(allowlist(), allowlist()));
  assert.equal(modern.group.mode, 'allowlist');
  assert.deepEqual(modern.group.allowlist.users, []);
  assert.equal(modern.group.open.defaultCanExecuteCommands, false);

  const legacy = initialAccessPolicyFor('qq', config, { legacy: true });
  assert.deepEqual(legacy, policy(allowlist(), open()));
  assert.equal(legacy.group.mode, 'open');
  assert.equal(legacy.group.open.defaultCanExecuteCommands, true);
  assert.deepEqual(legacy.direct, modern.direct, 'legacy only changes the group scope');

  const manual = bot('qq-manual', '*');
  assert.deepEqual(initialAccessPolicyFor('qq', manual), policy(open(), allowlist()));
  assert.deepEqual(initialAccessPolicyFor('qq', manual, { legacy: true }), policy(open(), open()));
});

test('legacy documents backfill every existing QQ bot with the legacy group default', async (t) => {
  const { path, defaultWorkspace } = await fixture(t);
  const bots = [bot('qq_one'), bot('qq_two')];
  await writeFile(path, `${JSON.stringify({
    version: 1,
    workspaces: { qq_one: defaultWorkspace, qq_two: defaultWorkspace },
  })}\n`);

  const store = await new BotWorkspaceStore(path, { defaultWorkspace }).load();
  for (const config of bots) {
    await store.ensure(config.botId, {
      initialAccessPolicy: initialAccessPolicyFor('qq', config),
      legacyInitialAccessPolicy: initialAccessPolicyFor('qq', config, { legacy: true }),
    });
  }

  for (const config of bots) {
    const saved = store.accessPolicyFor(config.botId);
    assert.deepEqual(saved, policy(allowlist(), open()), `${config.botId} backfilled as legacy`);
    assert.equal(saved.group.mode, 'open',
      `${config.botId} must not fall back to the tightened default after the first write`);
  }

  const persisted = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(persisted.version, 2);
  for (const config of bots) {
    assert.deepEqual(persisted.accessPolicies[config.botId], policy(allowlist(), open()),
      `${config.botId} persisted as legacy`);
  }
});

test('modern documents and fresh installs seed every QQ bot with the tightened group default', async (t) => {
  const { path, defaultWorkspace } = await fixture(t);
  const bots = [bot('qq_one'), bot('qq_two')];
  await writeFile(path, `${JSON.stringify({
    version: 2,
    workspaces: { qq_one: defaultWorkspace, qq_two: defaultWorkspace },
    accessPolicies: {},
  })}\n`);

  const store = await new BotWorkspaceStore(path, { defaultWorkspace }).load();
  for (const config of bots) {
    await store.ensure(config.botId, {
      initialAccessPolicy: initialAccessPolicyFor('qq', config),
      legacyInitialAccessPolicy: initialAccessPolicyFor('qq', config, { legacy: true }),
    });
    assert.deepEqual(store.accessPolicyFor(config.botId), policy(allowlist(), allowlist()));
  }

  const freshPath = join(defaultWorkspace, '..', 'fresh-workspaces.json');
  const fresh = await new BotWorkspaceStore(freshPath, { defaultWorkspace }).load();
  await fresh.ensure('qq_fresh', {
    initialAccessPolicy: initialAccessPolicyFor('qq', bot('qq_fresh')),
    legacyInitialAccessPolicy: initialAccessPolicyFor('qq', bot('qq_fresh'), { legacy: true }),
  });
  assert.deepEqual(fresh.accessPolicyFor('qq_fresh'), policy(allowlist(), allowlist()));
});

test('other channels keep their pre-change access-policy defaults', () => {
  assert.deepEqual(newBotAccessPolicyFor('feishu', { ownerOpenIds: ['ou_owner'] }),
    policy(open(), open()));
  assert.deepEqual(newBotAccessPolicyFor('feishu', { ownerOpenIds: ['*'] }), policy(open(), open()));
  assert.deepEqual(initialAccessPolicyFor('feishu', { ownerOpenIds: ['ou_owner'] }),
    policy(allowlist(), allowlist()));
  assert.deepEqual(initialAccessPolicyFor('feishu', { ownerOpenIds: ['*'] }), policy(open(), open()));
  assert.deepEqual(initialAccessPolicyFor('weixin', { ownerUserId: 'wx-owner' }),
    policy(allowlist(), allowlist()));
  for (const channel of ['dingtalk', 'wecom', 'wecom-app', 'slack', 'discord', 'imessage', 'matrix']) {
    assert.deepEqual(newBotAccessPolicyFor(channel), policy(open(), open()), channel);
    assert.deepEqual(initialAccessPolicyFor(channel), policy(open(), open()), channel);
  }
  assert.deepEqual(initialAccessPolicyFor('telegram', {
    accessMode: 'compatible', allowedUsers: ['101'],
  }), policy(scope('open', true, [{ id: '101', canExecuteCommands: true }]), open()));
  assert.deepEqual(initialAccessPolicyFor('telegram', {
    accessMode: 'private-allowlist', allowedUsers: ['101'],
  }), policy(scope('allowlist', false, [{ id: '101', canExecuteCommands: true }]), allowlist()));
  assert.deepEqual(initialAccessPolicyFor('whatsapp', {
    accessMode: 'self-only', accountJid: '886900000000@s.whatsapp.net',
  }), policy(allowlist(), allowlist()));
});
