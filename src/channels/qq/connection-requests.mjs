import { ApiError, gatewayPath } from '@tencent-connect/qqbot-nodejs/protocol';

function failure(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

/** SDK 1.0.4 cancels its timeout when headers arrive, before reading the body.
 * These two connection-only requests own the entire fetch/body lifetime. Do
 * not retry here: the SDK gateway/backoff and token singleflight own retries.
 */
async function connectionJson(url, init, { signal, timeoutMs, stage }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(failure(`qq-${stage}-timeout`, `QQ ${stage} request timed out`)), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      if (response.ok) throw failure(`qq-${stage}-invalid-response`, `QQ ${stage} returned invalid JSON`, cause);
    }
    if (!response.ok) {
      // Preserve HTTP/biz codes for the SDK's rate-limit backoff. Never include
      // response text: token endpoints can return credentials in their body.
      const code = data && typeof data === 'object' ? data.code ?? data.err_code : undefined;
      throw new ApiError(`QQ ${stage} HTTP ${response.status}${String(code) === '100001' ? ' (100001 Too many requests)' : ''}${response.status === 429 ? ' Too many requests' : ''}`,
        response.status, new URL(url).pathname, typeof code === 'number' ? code : undefined);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Adapter for the pinned SDK's instance methods/fields. Keep the original
 * TokenManager object so every MessageApi/MediaApi still shares its cache,
 * in-flight promise and background refresh lifecycle. No global fetch patch.
 */
export function installQqConnectionRequests(bot) {
  const tokens = bot.tokenManager;
  const tokenTimeoutMs = bot.opts.connectionTokenTimeoutMs ?? 10_000; // SDK token default.
  const gatewayTimeoutMs = bot.opts.connectionGatewayTimeoutMs ?? 30_000; // SDK API default.
  for (const value of [tokenTimeoutMs, gatewayTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('QQ connection request timeout must be a positive integer');
  }
  tokens.doFetchToken = async (appId, clientSecret) => {
    const data = await connectionJson(`${tokens.baseUrl}/app/getAppAccessToken`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': tokens.resolveUserAgent() },
      body: JSON.stringify({ appId, clientSecret }),
    }, { signal: bot.abortController?.signal, timeoutMs: tokenTimeoutMs, stage: 'token' });
    const duration = data?.expires_in === undefined ? 7200 : data.expires_in;
    const seconds = typeof duration === 'number' || (typeof duration === 'string' && /^\d+$/.test(duration)) ? Number(duration) : NaN;
    const expiresAt = Date.now() + seconds * 1000;
    if (!data || typeof data.access_token !== 'string' || !data.access_token.trim() || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(expiresAt)) {
      throw failure('qq-token-invalid-response', 'QQ token response has no usable token or expiration');
    }
    tokens.cache.set(appId, { token: data.access_token, expiresAt, appId });
    return data.access_token;
  };
  bot.messageApi.getGatewayUrl = async creds => {
    const token = await tokens.getAccessToken(creds.appId, creds.clientSecret);
    const data = await connectionJson(`${bot.apiClient.baseUrl}${gatewayPath()}`, {
      headers: { Authorization: `QQBot ${token}`, 'User-Agent': bot.userAgent },
    }, { signal: bot.abortController?.signal, timeoutMs: gatewayTimeoutMs, stage: 'gateway' });
    if (!data || typeof data.url !== 'string' || !data.url.trim()) {
      throw failure('qq-gateway-invalid-response', 'QQ gateway response has no WebSocket URL');
    }
    let url;
    try { url = new URL(data.url); }
    catch (cause) { throw failure('qq-gateway-invalid-response', 'QQ gateway response has no WebSocket URL', cause); }
    if (!['ws:', 'wss:'].includes(url.protocol)) throw failure('qq-gateway-invalid-response', 'QQ gateway response has no WebSocket URL');
    return data.url;
  };
}
