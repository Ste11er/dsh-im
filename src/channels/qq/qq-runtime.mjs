import { qqGroupParticipation } from './group-participation.mjs';
import { qqPersona } from './persona.mjs';
import { qqStickersEnabled } from './sticker-config.mjs';
import { extractConnectionEvidence, createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { QQBot, contentSanitizer, typingIndicator } from '@tencent-connect/qqbot-nodejs';

import {
  connectionTestTarget,
  connectionTestTargetUnavailable,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';
import {
  createDryRunRecorder, createQuietQueue, evaluateSendGate, isWithinQuietHours,
  normalizeSendControl, recordSendUsage,
} from '../shared/send-control.mjs';
import { evaluateInboundAccess } from '../shared/inbound-access.mjs';
import { createQqBridgeStatus, QqHarnessBridge } from './qq-bridge.mjs';
import { isQqMessageAddressed, normalizeQqMentions } from './qq-mention.mjs';
import { sendMarkdownReply } from './markdown-reply.mjs';
import { qqGroupContextEnabled } from './group-context.mjs';
import { qqGroupMemoryEnabled } from './group-memory-config.mjs';

function timeoutError() {
  const error = new Error('QQ WebSocket did not become ready in time');
  error.code = 'connect-timeout';
  return error;
}

export function createQqRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    qqConnectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createQqBridgeStatus(),
  };
}

/** Pure L3 decision helper: segment count comes from the real send path. */
export function evaluateProactiveOutbound({
  sendControl, usage, text, format = 'plain', now = Date.now(),
}) {
  const segments = format === 'markdown' ? chunkMarkdownParts(String(text ?? '')).length : 1;
  return evaluateSendGate({ config: sendControl, usage, now, segments });
}

export class QqRuntime {
  #config;
  #appSecret;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #paused;
  #sendControl;
  #groupParticipation;
  #participationReply;
  #persona;
  #stickersEnabled;
  #groupContextEnabled;
  #groupMemory;
  #groupMemoryEnabled;
  #dryRun = createDryRunRecorder();
  #quietQueue = createQuietQueue();
  #sendControlTimer = null;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #createBot;
  #typingMiddleware;
  #status = createQqRuntimeStatus();
  #bot = null;
  #bridge = null;
  #abortController = null;
  #runTask = null;
  #starting = null;

  constructor({
    config,
    appSecret,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    paused,
    sendControl,
    participationReply = null,
    groupMemory = null,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 20_000,
    createBot = (options) => new QQBot(options),
    typingMiddleware = typingIndicator,
  }) {
    if (!config || !appSecret || !harness || !state) {
      throw new TypeError('QqRuntime requires config, app secret, Harness, and state');
    }
    this.#config = config;
    this.#appSecret = appSecret;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    // WG-QQ-03: default OFF. The persisted record is the durable truth, an
    // explicit option (or config.paused) seeds the live gate at start.
    this.#paused = (paused ?? config.paused) === true;
    // WG-QQ-04/05/06: default OFF; the persisted bot record is the truth.
    this.#sendControl = normalizeSendControl(sendControl ?? config.sendControl);
    this.#groupParticipation = qqGroupParticipation(config.groupParticipation);
    this.#participationReply = participationReply;
    if (this.#groupParticipation.enabled && typeof participationReply !== 'function') throw new TypeError('Participation Agent unavailable');
    this.#persona = qqPersona(config.persona);
    this.#stickersEnabled = qqStickersEnabled(config.stickersEnabled);
    this.#groupContextEnabled = qqGroupContextEnabled(config.groupContextEnabled);
    this.#groupMemoryEnabled = qqGroupMemoryEnabled(config.groupMemoryEnabled);
    this.#groupMemory = groupMemory;
    if (this.#groupMemoryEnabled && !groupMemory) throw new TypeError('QQ long memory requires a store');
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'qq', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#createBot = createBot;
    this.#typingMiddleware = typingMiddleware;
  }

  get status() {
    const memory = this.#groupMemory?.status ?? null;
    return structuredClone({ ...this.#status, participationStats: this.#bridge?.participationStats ?? null, groupMemory: memory
      ? { ...memory, lastError: this.#status.groupMemoryError ?? memory.lastError } : null });
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#bot) {
      throw connectionTestTargetUnavailable(t('QQ机器人'));
    }
    const ownerUserOpenid = typeof this.#config.ownerUserOpenid === 'string'
      ? this.#config.ownerUserOpenid.trim()
      : '';
    const remembered = connectionTestTarget(this.#state);
    const rememberedUserOpenid = remembered?.scope === 'c2c'
      && typeof remembered.targetId === 'string'
      ? remembered.targetId.trim()
      : '';
    const target = rememberedUserOpenid
      ? { scope: 'c2c', targetId: rememberedUserOpenid }
      : (ownerUserOpenid && ownerUserOpenid !== '*'
        ? { scope: 'c2c', targetId: ownerUserOpenid }
        : null);
    if (!target) throw connectionTestTargetUnavailable(t('QQ机器人'));
    await this.#bot.sendText(target, text);
    return { sent: true };
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.userOpenId === 'string' ? target.route.userOpenId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  /**
   * WG-QQ-03 live toggle. L3 is gated at the controller (the delivery-adapter
   * entry); this flag drives the bridge's L4 background re-delivery gate. The
   * method below stays ungated on purpose: approval prompts reuse it as their
   * L2 send path.
   */
  setPaused(value) {
    const paused = value === true;
    this.#paused = paused;
    this.#bridge?.setPaused(paused);
    return { paused };
  }

  /** WG-QQ-04/05/06 live configuration update; applies to L3 and L4 at once. */
  setSendControl(value) {
    this.#sendControl = normalizeSendControl(value);
    this.#bridge?.setSendControl(this.#sendControl);
    return this.#sendControl;
  }

  setGroupParticipation(value) {
    const settings = qqGroupParticipation(value);
    if (settings.enabled && typeof this.#participationReply !== 'function') throw new TypeError('Participation Agent unavailable');
    this.#groupParticipation = settings;
    this.#bridge?.setGroupParticipation(settings);
  }

  setPersona(value) {
    this.#persona = qqPersona(value);
    this.#bridge?.setPersona(this.#persona);
  }

  setStickersEnabled(value) {
    this.#stickersEnabled = qqStickersEnabled(value);
    this.#bridge?.setStickersEnabled(value);
    return this.status;
  }

  setGroupContextEnabled(value) {
    this.#groupContextEnabled = qqGroupContextEnabled(value);
    this.#bridge?.setGroupContextEnabled(value);
    this.#applyGroupMemory();
    return value;
  }

  setGroupMemoryEnabled(value) {
    const enabled = qqGroupMemoryEnabled(value);
    if (!this.#groupMemory) throw new TypeError('QQ long memory store is unavailable');
    this.#groupMemory.setEnabled(enabled && this.#groupContextEnabled, this.#abortController?.signal);
    this.#groupMemoryEnabled = enabled;
    this.#bridge?.setGroupMemory(enabled && this.#groupContextEnabled ? this.#groupMemory : null);
    return value;
  }

  #applyGroupMemory() {
    if (!this.#groupMemory) return;
    const enabled = this.#groupMemoryEnabled && this.#groupContextEnabled;
    this.#groupMemory.setEnabled(enabled, this.#abortController?.signal);
    this.#bridge?.setGroupMemory(enabled ? this.#groupMemory : null);
  }

  compactGroupMemory() {
    if (!this.#groupMemoryEnabled || !this.#groupContextEnabled) throw new Error('QQ long memory is disabled');
    return this.#groupMemory.compact({ force: true });
  }

  /** In-memory dry-run candidates for L3 attempts (WG-QQ-06). */
  dryRunCandidates() {
    return [...this.#dryRun.list(), ...(this.#bridge?.dryRunCandidates?.() ?? [])];
  }

  /** Diagnostics for the outbound gate (counts only, no message content). */
  sendControlDiagnostics() {
    return {
      dryRunCandidates: this.dryRunCandidates().length,
      quietQueued: this.#quietQueue.stats().keys,
      quietDropped: this.#quietQueue.stats(),
    };
  }

  /** Flush quiet-hours deferrals now (used by the timer and by operators). */
  async flushSendControlNow() {
    await this.#flushSendControl();
  }

  #startSendControlTimer() {
    if (this.#sendControlTimer) return;
    this.#sendControlTimer = setInterval(() => { void this.#flushSendControl(); }, 30_000);
    this.#sendControlTimer.unref?.();
  }

  #stopSendControlTimer() {
    if (!this.#sendControlTimer) return;
    clearInterval(this.#sendControlTimer);
    this.#sendControlTimer = null;
  }

  async #recordSendControlUsage(segments) {
    if (!this.#sendControl.budget.enabled) return;
    if (typeof this.#state.setSendControlUsage !== 'function') return;
    const usage = recordSendUsage(this.#state.sendControlUsage?.(), {
      now: Date.now(), segments, windowMs: this.#sendControl.budget.windowMs,
    });
    await this.#state.setSendControlUsage(usage).catch(() => undefined);
  }

  /** Flush quiet-hours deferrals and unfreeze deferred rows when the gate opens. */
  async #flushSendControl() {
    this.#quietQueue.dropExpired();
    if (isWithinQuietHours(Date.now(), this.#sendControl.quietHours)) return;
    for (const key of this.#quietQueue.keys()) {
      for (const item of this.#quietQueue.takeAll(key)) {
        try {
          await this.sendProactiveText(item.target, item.text, { format: item.format });
        } catch {
          // The gate re-applied: dry-run/budget leave it unsent; a new quiet
          // window re-queues it on the next attempt.
        }
      }
    }
    this.#bridge?.resumeDeferredByGate?.();
  }

  async sendProactiveText(target, text, { signal, format = 'plain' } = {}) {
    const nativeId = target?.kind === 'user'
      ? (typeof target?.route?.userOpenId === 'string' ? target.route.userOpenId.trim() : '')
      : target?.kind === 'group'
        ? (typeof target?.route?.groupOpenId === 'string' ? target.route.groupOpenId.trim() : '')
        : '';
    if (!nativeId) {
      const error = new TypeError('Invalid QQ proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#status.ready || !this.#bot) {
      const error = new Error('QQ bot is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    signal?.throwIfAborted();
    const replyTarget = {
      scope: target.kind === 'user' ? 'c2c' : 'group',
      targetId: nativeId,
    };
    // L3 gate: dry-run -> budget -> quiet hours. Passive replies never reach
    // this method, so L2 stays ungated by design.
    const decision = evaluateProactiveOutbound({
      sendControl: this.#sendControl,
      usage: this.#state.sendControlUsage?.(),
      text,
      format,
    });
    const segments = decision.segments;
    const conversationKey = `${replyTarget.scope}:${replyTarget.targetId}`;
    if (decision.action === 'dry-run') {
      this.#dryRun.record({ kind: 'proactive', conversationKey, segments: decision.segments });
      const error = new Error('QQ proactive delivery suppressed by dry-run');
      error.code = 'send-dry-run';
      throw error;
    }
    if (decision.action === 'deny-budget') {
      const error = new Error(`QQ send budget exhausted (${decision.used}/${decision.limit} segments)`);
      error.code = 'send-budget-exhausted';
      throw error;
    }
    if (decision.action === 'defer-quiet') {
      this.#quietQueue.enqueue(conversationKey, { target, text, format });
      const error = new Error('QQ proactive delivery deferred by quiet hours');
      error.code = 'send-deferred-quiet';
      throw error;
    }
    await this.#recordSendControlUsage(decision.segments);
    if (format === 'markdown') {
      await sendMarkdownReply(this.#bot, replyTarget, text, {
        logger: this.#logger, signal, requireComplete: true,
      });
      return { sent: true };
    }
    return this.#bot.sendText(replyTarget, text);
  }

  async start() {
    if (this.#status.ready && this.#bot) return this.status;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#startSendControlTimer();
    this.#status.startedAt = new Date().toISOString();
    this.#status.qqConnectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
    this.#status.harnessReachable = true;

    const sdkLogger = {
      error: (...args) => this.#logger.error?.(...args),
      warn: (...args) => this.#logger.warn?.(...args),
      info: (...args) => this.#logger.info?.(...args),
      debug: () => {},
    };
    const bot = this.#createBot({
      appId: this.#config.appId,
      appSecret: this.#appSecret,
      accountId: this.#config.botId,
      logger: sdkLogger,
      transport: 'websocket',
      tokenPrefetch: 'sync',
      // sendText is reserved for literal notices/connection tests. Markdown
      // replies use the explicit msg_type=2 path in sendMarkdownReply().
      markdownSupport: false,
    });
    if (!bot || typeof bot.start !== 'function' || typeof bot.stop !== 'function') {
      throw new TypeError('QQ bot factory returned an invalid client');
    }
    const controller = new AbortController();
    this.#abortController = controller;
    this.#bot = bot;
    try { this.#applyGroupMemory(); }
    catch (error) { await this.stop(); throw error; }
    this.#bridge = new QqHarnessBridge({
      bot,
      ownerUserOpenid: this.#config.ownerUserOpenid,
      harness: this.#harness,
      state: this.#state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      paused: this.#paused,
      sendControl: this.#sendControl,
      status: this.#status,
      groupParticipation: this.#groupParticipation,
      participationReply: this.#participationReply,
      persona: this.#persona,
      stickersEnabled: this.#stickersEnabled,
      groupContextEnabled: this.#groupContextEnabled,
      groupMemory: this.#groupMemoryEnabled && this.#groupContextEnabled ? this.#groupMemory : null,
      logger: this.#logger,
      replyTimeoutMs: this.#replyTimeoutMs,
      signal: controller.signal,
    });
    const botMentionIds = new Set([this.#config.appId]);
    bot.use(async (ctx, next) => {
      ctx.message = normalizeQqMentions(ctx.message, botMentionIds);
      await next();
    });
    // QQ delivers emoji/face messages as opaque `<faceType=..,faceId="..",ext="..">`
    // tags. Parse them into readable text so the Harness sees what the sender
    // actually meant instead of an unusable markup fragment.
    bot.use(contentSanitizer({ parseFaceTags: true }));
    bot.use?.(this.#typingMiddleware({
      keepAlive: true,
      predicate: (ctx) => {
        const message = ctx?.message;
        if (!isQqMessageAddressed(message)) return false;
        if (!this.#accessPolicy) {
          return message.kind === 'group'
            || this.#config.ownerUserOpenid === '*'
            || message.senderId === this.#config.ownerUserOpenid;
        }
        return evaluateInboundAccess(this.#accessPolicy, {
          conversationType: message.kind === 'c2c' ? 'direct' : 'group',
          senderIds: message.senderId,
          text: typeof message.content === 'string' ? message.content.trim() : '',
        }).allowed;
      },
    }));

    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const onReady = (data) => {
      if (typeof data?.user?.id === 'string' && data.user.id.trim()) {
        botMentionIds.add(data.user.id.trim());
      }
      const now = Date.now();
      this.#status.ready = true;
      this.#status.qqConnectionState = 'connected';
      this.#status.lastCheckedAt = now;
      this.#status.lastConnectedAt = now;
      this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
      readyResolve();
    };
    const onError = (error) => {
      if (!this.#status.ready) readyReject(error);
      else {
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
        this.#status.lastError = this.#status.error.message;
        this.#logger.warn?.(`[dsh-im:qq] bot ${this.#config.botId} connection error:`, extractConnectionEvidence(error).details);
      }
    };
    const onMessage = (_ctx, message) => {
      const task = this.#bridge?.accept(message);
      if (!task) return;
      void task.catch((error) => {
        if (controller.signal.aborted) return;
        this.#logger.error?.(
          `[dsh-im:qq] bot ${this.#config.botId} message handling failed:`,
          extractConnectionEvidence(error).details,
        );
      });
    };
    bot.on('ready', onReady);
    bot.on('resumed', onReady);
    bot.on('error', onError);
    bot.on('message', onMessage);

    const runTask = Promise.resolve().then(() => bot.start(controller.signal));
    this.#runTask = runTask;
    runTask.catch((error) => {
      if (controller.signal.aborted) return;
      readyReject(error);
      this.#status.ready = false;
      this.#status.qqConnectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      this.#logger.error?.(`[dsh-im:qq] bot ${this.#config.botId} connection stopped:`, extractConnectionEvidence(error).details);
    });

    let timer;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.#connectTimeoutMs);
        }),
      ]);
      this.#status.ready = true;
      this.#status.qqConnectionState = 'connected';
      this.#status.lastCheckedAt = Date.now();
      this.#status.lastConnectedAt = Date.now();
      return this.status;
    } catch (error) {
      this.#status.ready = false;
      this.#status.qqConnectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    this.#stopSendControlTimer();
    const bot = this.#bot;
    const bridge = this.#bridge;
    const runTask = this.#runTask;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#bot = null;
    this.#bridge = null;
    this.#runTask = null;
    try {
      bot?.stop();
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:qq] bot ${this.#config.botId} failed to stop cleanly:`, extractConnectionEvidence(error).details);
    }
    await Promise.race([
      runTask?.catch(() => undefined) ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await bridge?.waitForIdle();
    await this.#groupMemory?.close();
    this.#status.ready = false;
    this.#status.qqConnectionState = 'idle';
    return this.status;
  }
}
