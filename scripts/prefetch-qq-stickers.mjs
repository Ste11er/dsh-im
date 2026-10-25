import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { QqStickerCatalog } from '../src/channels/qq/sticker-catalog.mjs';
import { getImageInputSettingsStore } from '../src/channels/shared/image-input-settings-store.mjs';
import { imageInputLimits } from '../src/channels/shared/image-input-policy.mjs';
const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const args = process.argv.slice(2);
const directory = resolve(args.find(arg => !arg.startsWith('--')) ?? join(home, 'integrations/dsh-qq/stickers'));
const catalog = new QqStickerCatalog({ directory });
const { maxDownloadBytes } = imageInputLimits(await getImageInputSettingsStore().get());
const start = performance.now();
if (args.includes('--aigengtu')) await catalog.syncAigengtu({ force: true });
let lastReported = 0;
const result = await catalog.prefetch({ maxBytes: maxDownloadBytes, concurrency: 4,
  onProgress(status) {
    const complete = status.ready + status.failed;
    if (complete - lastReported >= 25 || complete === status.total) {
      lastReported = complete; console.error(JSON.stringify(status));
    }
  } });
console.log(JSON.stringify({ ...result, elapsedMs: Math.round(performance.now() - start), directory }, null, 2));
if (result.failures.length) process.exitCode = 1;
