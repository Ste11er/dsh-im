import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStickerEntries, QqStickerCatalog } from '../../../src/channels/qq/sticker-catalog.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(PNG).digest('hex');
const item = { id: 'sticker_one', slug: 'deepseek001', name: '开心，谢谢你', description: '笑着庆祝', tags: ['开心', '感谢'],
  status: 'published', characterIds: ['deepseek'], categoryIds: ['meme'],
  path: 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/a.png', sha256: digest };
const legacy = { sourcePath: 'media/微信图片.jpg', name: '疑惑', tags: ['疑惑'], characterId: 'deepseek' };
function manifests(work = item) { return [[work], [legacy], {}, { [legacy.sourcePath]: { id: 'sticker_legacy', slug: 'deepseek002' } }]; }
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'qq-sticker-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const documents = manifests(options.item ?? item);
  let down = false;
  let timestamp = 1_000_000;
  const fetchImpl = async (url, { signal } = {}) => {
    url = String(url);
    signal?.throwIfAborted(); requests.push(url);
    if (down) throw new Error('offline');
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'a'.repeat(40) });
    const index = ['works.json', 'blue-fish-classification.json', 'blue-fish-editorial.json', 'blue-fish-ids.json'].findIndex(name => url.endsWith('/data/' + name));
    if (index >= 0) { assert.match(url, /\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/data\//); return Response.json(documents[index]); }
    assert.equal(url, item.path);
    return new Response(options.bytes ?? PNG);
  };
  return { directory, requests, catalog: new QqStickerCatalog({ directory, fetchImpl, now: () => timestamp }),
    fetchImpl, advance: () => { timestamp += 24 * 60 * 60_000; }, offline: () => { down = true; } };
}
test('catalog merges published meme entries and legacy metadata, excluding other characters and hidden/illustration entries', () => {
  const docs = manifests();
  docs[0].push({ ...item, id: 'hidden', status: 'hidden' }, { ...item, id: 'art', categoryIds: ['illustration'] }, { ...item, id: 'other', characterIds: ['gpt'] });
  const entries = buildStickerEntries(...docs);
  assert.deepEqual(entries.map(e => e.id), ['sticker_one', 'sticker_legacy']);
  assert.match(entries[1].url, /%E5%BE%AE/);
  assert.match(entries[1].url, /blue-fish-archive\/0d40d228a45410c153c23d733285b84b45856a1f\/media\//);
  assert.equal(entries[1].sha256, null, 'legacy source has no published digest');
  assert.equal(buildStickerEntries(docs[0], docs[1], { [legacy.sourcePath]: { status: 'removed' } }, docs[3]).length, 1);
  assert.throws(() => buildStickerEntries(...manifests({ ...item, path: 'https://evil.com/a.png' })), /outside/);
  assert.throws(() => buildStickerEntries(...manifests({ ...item, path: 'https://raw.githubusercontent.com/evil/repo/main/a.png' })), /outside/);
});
test('catalog pins manifests to one revision, searches without image download and caches selected verified bytes', async t => {
  const f = await fixture(t);
  const result = await f.catalog.search('开心');
  assert.equal(result.status.count, 2);
  assert.equal(result.items[0].id, item.id);
  assert.equal(f.requests.length, 5);
  const image = await f.catalog.get(item.id, { maxBytes: 1024 });
  assert.equal(image.digest, digest);
  assert.deepEqual(await readFile(image.path), PNG);
  assert.match(image.sourceUrl, /deepseek001.html/);
  assert.equal(f.requests.length, 6);
  await f.catalog.get(item.id, { maxBytes: 1024 });
  assert.equal(f.requests.length, 6);
  const reloaded = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_001, fetchImpl: () => assert.fail('fresh disk cache should not fetch') });
  assert.equal((await reloaded.search('开心')).items[0].id, item.id);
  await assert.rejects(f.catalog.get('unknown', { maxBytes: 1024 }), /not present/);
  await assert.rejects(f.catalog.get(item.id, { maxBytes: 2 }), /integrity/);
  await writeFile(image.path, 'corrupted');
  await assert.rejects(f.catalog.get(item.id, { maxBytes: 1024 }), /integrity/);
});
test('failed refresh reports stale catalog, initial failure and cancellation remain failures', async t => {
  const f = await fixture(t);
  await f.catalog.refresh(); f.advance(); f.offline();
  const result = await f.catalog.search('开心');
  assert.equal(result.status.stale, true);
  assert.equal(result.status.warning, 'catalog-refresh-failed-using-stale-cache');
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled by caller'));
  await assert.rejects(f.catalog.refresh({ signal: cancelled.signal, force: true }), /cancelled by caller/);
  const empty = await fixture(t); empty.offline();
  await assert.rejects(empty.catalog.search('开心'), /offline/);
});
test('selected images reject published digest mismatch, unsupported formats and excessive download sizes', async t => {
  const badDigest = await fixture(t, { item: { ...item, sha256: '0'.repeat(64) } });
  await assert.rejects(badDigest.catalog.get(item.id, { maxBytes: 1024 }), /published digest/);
  const badFormat = await fixture(t, { bytes: Buffer.from('not an image') });
  await assert.rejects(badFormat.catalog.get(item.id, { maxBytes: 1024 }), /format/);
  const oversized = await fixture(t);
  await assert.rejects(oversized.catalog.get(item.id, { maxBytes: 2 }), /exceeded|contains/);
  await assert.rejects(oversized.catalog.get(item.id), /maxBytes/);
});
test('a malformed disk catalog is reported rather than treated as a valid search index', async t => {
  const f = await fixture(t);
  await f.catalog.refresh();
  const path = join(f.directory, 'catalog.json');
  const document = JSON.parse(await readFile(path, 'utf8'));
  document.entries[0].tags = [null];
  await writeFile(path, JSON.stringify(document));
  const reloaded = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_001, fetchImpl: f.fetchImpl });
  await assert.rejects(reloaded.refresh(), /Invalid sticker cache/);
});

test('prefetch accounts for every entry and warm search returns verified paths without network', async t => {
  const f = await fixture(t);
  const result = await f.catalog.prefetch({ maxBytes: 1024, concurrency: 2 });
  assert.equal(result.total, 2); assert.equal(result.ready, 1); assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].id, 'sticker_legacy');
  const count = f.requests.length; f.offline();
  const search = await f.catalog.search('开心', { maxBytes: 1024 });
  assert.deepEqual(await readFile(search.items[0].path), PNG);
  assert.equal(f.requests.length, count);
  const reloaded = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_001, fetchImpl: () => assert.fail('warm cache must not fetch') });
  assert.equal((await reloaded.search('开心', { maxBytes: 1024 })).items[0].digest, digest);
});

test('a stale local index answers immediately while a slow catalog refresh runs in background', async t => {
  const f = await fixture(t); await f.catalog.refresh(); await f.catalog.get(item.id, { maxBytes: 1024 });
  let finish; const blocked = new Promise(resolve => { finish = resolve; });
  const catalog = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_000 + 24 * 60 * 60_000,
    fetchImpl: async () => { await blocked; throw new Error('offline'); } });
  const result = await catalog.search('开心', { maxBytes: 1024, localFirst: true });
  assert.equal(result.status.stale, true); assert.equal(result.items[0].digest, digest);
  finish(); await catalog.refresh(); assert.equal(catalog.status.warning, 'catalog-refresh-failed-using-stale-cache');
});

test('deployed main-branch archive URLs migrate to the revision before upstream renamed originals', async t => {
  const f = await fixture(t); await f.catalog.refresh();
  const path = join(f.directory, 'catalog.json'); const doc = JSON.parse(await readFile(path, 'utf8'));
  doc.entries[1].url = doc.entries[1].url.replace('0d40d228a45410c153c23d733285b84b45856a1f', 'main');
  await writeFile(path, JSON.stringify(doc));
  const reload = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_001, fetchImpl: () => assert.fail('migration must not need network') });
  await reload.refresh();
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.match(stored.entries[1].url, /0d40d228a45410c153c23d733285b84b45856a1f/);
  assert.equal(stored.entries[1].sourceUrl, doc.entries[1].sourceUrl);
});

test('cache-only replies never access the network even with expired or missing catalog and image caches', async t => {
  const f = await fixture(t); await f.catalog.get(item.id, { maxBytes: 1024 });
  let requests = 0;
  const reload = new QqStickerCatalog({ directory: f.directory, now: () => 1_000_000 + 48 * 60 * 60_000,
    fetchImpl: () => { requests++; throw new Error('Reply must stay offline'); } });
  const options = { maxBytes: 1024, cachedOnly: true };
  assert.equal((await reload.search('开心', options)).items[0].digest, digest);
  assert.equal((await reload.search('疑惑', options)).items.length, 0);
  await assert.rejects(reload.get('sticker_legacy', options), { code: 'sticker-not-cached' });
  assert.equal((await reload.get(item.id, options)).digest, digest);
  const empty = await fixture(t); const noIndex = new QqStickerCatalog({ directory: empty.directory, fetchImpl: () => { requests++; throw new Error('No network'); } });
  assert.deepEqual((await noIndex.search('开心', options)).items, []);
  await assert.rejects(noIndex.get(item.id, options), /catalog|cache/);
  assert.equal(requests, 0);
});

test('aigengtu index deduplicates category overlap, preserves provenance and refuses unapproved image hosts', async t => {
  const { buildAigengtuEntries } = await import('../../../src/channels/qq/sticker-catalog.mjs');
  const image = { name: '开心吃饭', original: 'https://img.aigengtu.com/meme/001.webp', story: { zh: '庆祝', contributor: '贡献者' } };
  const doc = { gallery: { 'DeepSeek娘': { images: [image] }, 'AI娘化': { images: [image] } } };
  const items = buildAigengtuEntries(doc); assert.equal(items.length, 1); assert.equal(items[0].id, 'aigengtu_001');
  assert.equal(items[0].license, 'unknown'); assert.equal(items[0].sourceUrl, 'https://aigengtu.com/#/meme/001');
  assert.throws(() => buildAigengtuEntries({ gallery: { bad: { images: [{ ...image, original: 'https://evil.test/a.png' }] } } }));
  const f = await fixture(t); let network = 0;
  const catalog = new QqStickerCatalog({ directory: f.directory, fetchImpl: async url => { network++; assert.equal(String(url), 'https://aigengtu.com/gallery-index.json'); return Response.json(doc); } });
  await catalog.syncAigengtu(); assert.equal(catalog.status.aigengtuCount, 1); assert.equal(network, 1);
  const reload = new QqStickerCatalog({ directory: f.directory, fetchImpl: () => assert.fail('cached-only search cannot use network') });
  assert.equal((await reload.search('开心', { cachedOnly: true, maxBytes: 1024 })).items.length, 0);
  assert.equal(reload.status.aigengtuCount, 1);
});
