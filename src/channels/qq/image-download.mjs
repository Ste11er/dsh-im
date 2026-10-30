import { ImagePromptError } from '../shared/image-prompt.mjs';

// Product latency budget, not a platform size or safety limit. Shared by all
// lazy images in one attempt, measured from its first actual download.
export const QQ_IMAGE_DOWNLOAD_TIMEOUT_MS = 5_000;

export function isQqImageDownloadTimeout(error) {
  const seen = new Set();
  for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    if (cause.code === 'qq-image-download-timeout') return true;
  }
  return false;
}

export function withQqImageDownloadBudget(images, { timeoutMs = QQ_IMAGE_DOWNLOAD_TIMEOUT_MS } = {}) {
  let deadline = null, expired = null;
  const timeoutError = () => expired ??= new ImagePromptError('qq-image-download-timeout',
    `QQ image downloads exceeded ${timeoutMs}ms; message discarded`, '图片下载超时，已丢弃。');
  return images.map(source => {
    if (source.data !== undefined) return source;
    let download;
    return { ...source, load(options = {}) {
      if (download) return download;
      options.signal?.throwIfAborted();
      if (expired) return Promise.reject(expired);
      deadline ??= performance.now() + timeoutMs;
      const remaining = deadline - performance.now();
      if (remaining <= 0) return Promise.reject(timeoutError());
      const controller = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      download = (async () => {
        let onAbort;
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        // Abort the actual provider request and settle the caller even if a
        // transport fails to reject promptly. Late bytes can never enter DSH.
        const timer = setTimeout(() => controller.abort(timeoutError()), remaining);
        try { return await Promise.race([Promise.resolve().then(() => source.load({ ...options, signal })), aborted]); }
        finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
      })();
      return download;
    } };
  });
}
