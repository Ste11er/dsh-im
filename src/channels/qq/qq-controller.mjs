import { qqGroupParticipation } from './group-participation.mjs';
import { qqFamiliarityEnabled } from './familiarity.mjs';
import { qqPersona } from './persona.mjs';
import { qqStickersEnabled } from './sticker-config.mjs';
import { extractConnectionEvidence, atConnectionStage, createConnectionDiagnostics } from '../shared/connection-error.mjs';
import { randomUUID } from 'node:crypto';

import { connectionTestMessage } from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';
import { normalizeSendControl } from '../shared/send-control.mjs';
import { publicMessageFailure } from '../shared/message-failure.mjs';
import { deriveQqBotIdentity, maskQqAppId } from './config-store.mjs';
import { publicQqStateError } from './state-error.mjs';
import { qqGroupContextEnabled } from './group-context.mjs';
import { qqGroupMemoryEnabled, qqGroupMemoryModels } from './group-memory-config.mjs';

const ACTIVE_ATTEMPT_STATES = new Set(['starting', 'pending', 'refreshing', 'connecting']);
const TERMINAL_ATTEMPT_STATES = new Set(['connected', 'failed', 'cancelled']);
const QR_TTL_MS = 5 * 60_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

function connectionError(error, message) {
  return publicQqStateError(error) ?? safeError('connection-failed', message);
}

/**
 * L3 gate error: the account is paused, so proactive delivery is dropped
 * locally without any attempt. Deliberately carries no `deliveryOutcome` —
 * the platform never saw the message, which is not the same as 'unknown'.
 */
function accountPausedError() {
  const error = new Error(t('QQ 机器人已暂停，已跳过主动投递。'));
  error.code = 'account-paused';
  return error;
}

function publicAttempt(record) {
  if (!record) return null;
  return {
    attemptId: record.id,
    status: record.state,
    qrRevision: record.qrRevision,
    pollIntervalMs: 1_000,
    ...(record.verificationUrl ? { verificationUrl: record.verificationUrl } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.botId ? { botId: record.botId } : {}),
    ...(record.error ? { error: structuredClone(record.error) } : {}),
  };
}

export class QqController {
  #qrAuth;
  #credentials;
  #configStore;
  #validateGroupMemoryModel;
  #validateParticipationModel;
  #createRuntime;
  #deleteState;
  #logger;
  #diagnostics;
  #runtimes = new Map();
  #errors = new Map();
  #attempts = new Map();
  #activeAttemptId = null;
  #transitions = new Map();
  #revision = 0;
  #closed = false;

  constructor({
    qrAuth,
    credentials,
    configStore,
    createRuntime,
    deleteState = async () => {},
    validateGroupMemoryModel,
    validateParticipationModel,
    logger = console,
  }) {
    if (!qrAuth || typeof qrAuth.start !== 'function') throw new TypeError('QQ QR auth is required');
    if (!credentials || typeof credentials.resolve !== 'function'
      || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      throw new TypeError('QqController requires the DSH credential provider');
    }
    if (!configStore || typeof configStore.list !== 'function'
      || typeof configStore.save !== 'function' || typeof configStore.remove !== 'function') {
      throw new TypeError('QqController requires a config store');
    }
    if (typeof createRuntime !== 'function') throw new TypeError('createRuntime is required');
    this.#qrAuth = qrAuth;
    this.#credentials = credentials;
    this.#configStore = configStore;
    this.#validateGroupMemoryModel = validateGroupMemoryModel;
    this.#validateParticipationModel = validateParticipationModel;
    this.#createRuntime = createRuntime;
    this.#deleteState = deleteState;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'qq', logger });
  }

  get diagnostics() { return this.#diagnostics; }

  #failure(error, code, message) {
    const stage = code.startsWith('qr-') ? 'qr.begin' : code === 'activation-failed' ? 'activation' : 'connection.start';
    return this.#diagnostics.report(error, { reuse: true, stage, publicError: { code, message } }).publicError;
  }

  async initialize() {
    if (this.#closed) return this.status();
    for (const config of this.#configStore.list()) {
      await this.#withBotTransition(config.botId, async () => {
        const current = this.#runtimes.get(config.botId)?.status;
        // The SDK owns reconnect/backoff until it finishes or exhausts. A
        // supervisor pass must not reset that budget (especially rate limits).
        if (this.#closed || current?.ready || current?.gatewayTransport?.recovering === true) return;
        try {
          const appSecret = await this.#resolveSecret(config.secretRef);
          if (!appSecret) {
            this.#errors.set(config.botId, safeError('missing-secret', t('QQ 机器人凭据缺失，请移除后重新扫码。')));
            return;
          }
          await this.#startRuntime(config, appSecret);
          this.#errors.delete(config.botId);
        } catch (error) {
          this.#errors.set(config.botId, this.#diagnostics.report(error, { reuse: true, publicError: connectionError(error, t('QQ 连接未就绪，插件会自动重试。')) , stage: 'connection.start' }).publicError);

        } finally {
          this.#touch();
        }
      });
    }
    return this.status();
  }

  async startProvisioning() {
    if (this.#closed) throw new Error('QQ controller is closed');
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    let firstQrResolve;
    let firstQrReject;
    const firstQr = new Promise((resolve, reject) => {
      firstQrResolve = resolve;
      firstQrReject = reject;
    });
    const record = {
      id: randomUUID(),
      state: 'starting',
      createdAt: Date.now(),
      expiresAt: null,
      qrRevision: 0,
      verificationUrl: null,
      controller: new AbortController(),
      dispose: null,
      task: null,
      error: null,
      botId: null,
    };
    this.#attempts.set(record.id, record);
    this.#activeAttemptId = record.id;
    this.#touch();

    try {
      record.dispose = this.#qrAuth.start({
        onQrDisplayed: (url) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          const verificationUrl = cleanString(url);
          if (!verificationUrl) return;
          record.verificationUrl = verificationUrl;
          record.qrRevision += 1;
          record.expiresAt = Date.now() + QR_TTL_MS;
          record.state = 'pending';
          this.#touch();
          firstQrResolve();
        },
        onQrExpired: () => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.state = 'refreshing';
          record.verificationUrl = null;
          record.expiresAt = null;
          this.#touch();
        },
        onSuccess: (credentials) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.task = this.#completeProvisioning(record, credentials);
        },
        onFailure: (error) => {
          if (record.controller.signal.aborted || TERMINAL_ATTEMPT_STATES.has(record.state)) return;
          record.state = 'failed';
          record.error = this.#failure(error, 'qr-connect-failed', t('QQ 扫码服务暂时不可用，请重新生成二维码。'));
          if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
          this.#touch();
          firstQrReject(error);
        },
      }, { signal: record.controller.signal });
      await firstQr;
      return publicAttempt(record);
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码绑定已取消。'));
      } else if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
        record.state = 'failed';
        record.error = this.#failure(error, 'qr-start-failed', t('无法生成 QQ 二维码，请稍后重试。'));
      }
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
      throw error;
    }
  }

  registrationStatus(attemptId) {
    return publicAttempt(this.#attempts.get(attemptId));
  }

  async bindCredentials({ appId, appSecret } = {}) {
    if (this.#closed) throw new Error('QQ controller is closed');
    const normalizedAppId = cleanString(appId);
    const normalizedSecret = cleanString(appSecret);
    if (!normalizedAppId || !normalizedSecret) {
      throw new TypeError('QQ AppID and AppSecret are required');
    }
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    if (this.#closed) throw new Error('QQ controller is closed');
    const identity = deriveQqBotIdentity(normalizedAppId);
    await this.#withBotTransition(identity.botId, async () => {
      if (this.#closed) throw new Error('QQ controller is closed');
      const previousConfig = this.#configStore.getByAppId(normalizedAppId);
      const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
      if (this.#closed) throw new Error('QQ controller is closed');
      const config = {
        botId: identity.botId,
        appId: normalizedAppId,
        secretRef: identity.secretRef,
        ownerUserOpenid: previousConfig?.ownerUserOpenid ?? '*',
        ...(previousConfig?.computerCommandOwners === undefined ? {} : { computerCommandOwners: previousConfig.computerCommandOwners }),
        createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
        connectedAt: new Date().toISOString(),
        // Rebinding credentials never silently resumes a paused account.
        ...(previousConfig?.paused === true ? { paused: true } : {}),
        ...(previousConfig?.groupParticipation === undefined ? {} : { groupParticipation: previousConfig.groupParticipation }),
        ...(previousConfig?.familiarityEnabled === true ? { familiarityEnabled: true } : {}),
        ...(previousConfig?.persona === undefined ? {} : { persona: previousConfig.persona }),
        ...(previousConfig?.stickersEnabled === true ? { stickersEnabled: true } : {}),
        ...(previousConfig?.groupContextEnabled === true ? { groupContextEnabled: true } : {}),
        ...(previousConfig?.groupMemoryEnabled === true ? { groupMemoryEnabled: true } : {}),
        ...(previousConfig?.groupMemoryModels ? { groupMemoryModels: previousConfig.groupMemoryModels } : {}),
      };
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, normalizedSecret), 'credential-store');
      try {
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        await this.#startRuntime(config, normalizedSecret);
        this.#errors.delete(identity.botId);
      } catch (error) {
        this.#errors.set(identity.botId, this.#diagnostics.report(error, { reuse: true, publicError: connectionError(error, t('QQ 机器人已绑定，消息连接暂未就绪。')) , stage: 'connection.start' }).publicError);

      }
      this.#touch();
    });
    return this.status();
  }

  async cancelProvisioning(attemptId) {
    const record = this.#attempts.get(attemptId);
    if (!record) return null;
    if (!TERMINAL_ATTEMPT_STATES.has(record.state)) {
      record.controller.abort();
      record.dispose?.();
      await record.task?.catch(() => undefined);
      if (!TERMINAL_ATTEMPT_STATES.has(record.state)) record.state = 'cancelled';
      record.error ??= safeError('cancelled', t('扫码绑定已取消。'));
    }
    if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
    this.#touch();
    return publicAttempt(record);
  }

  async reconnectBot(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    await this.#withBotTransition(botId, async () => {
      const secret = await this.#resolveSecret(config.secretRef);
      if (!secret) throw new Error('QQ bot secret is missing');
      try {
        await this.#startRuntime(config, secret);
        this.#errors.delete(botId);
      } catch (error) {
        this.#errors.set(botId, this.#diagnostics.report(error, { reuse: true, publicError: connectionError(error, t('QQ 连接仍未就绪，请稍后重试。')) , stage: 'connection.start' }).publicError);
        throw error;
      } finally {
        this.#touch();
      }
    });
    return this.status();
  }

  async sendConnectionTest(botId) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendConnectionTest !== 'function') {
        const error = new Error(t('QQ机器人尚未连接'));
        error.code = 'test-target-unavailable';
        throw error;
      }
      await runtime.sendConnectionTest(connectionTestMessage(
        t('QQ 机器人（{appId}）', { appId: maskQqAppId(config.appId) }),
      ));
      return { sent: true };
    });
  }

  async sendProactiveText(botId, target, text, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    return this.#withBotTransition(botId, async () => {
      // L3: an account pause blocks proactive delivery locally. Passive
      // replies, command receipts, approval prompts and connection tests do
      // not pass through here, so they keep working while paused.
      if (this.#configStore.get(botId)?.paused === true) throw accountPausedError();
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.sendProactiveText !== 'function') {
        const error = new Error(t('QQ机器人尚未连接'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.sendProactiveText(target, text, options);
    });
  }

  /**
   * Persist the account-level pause (WG-QQ-03) and apply it to the live
   * runtime without restarting the connection. Resuming is always an explicit
   * caller action; nothing here clears the flag implicitly.
   */
  async setPaused(botId, value) {
    const paused = value === true;
    if (!this.#configStore.get(botId)) throw new Error('Unknown QQ bot');
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      const next = { ...current };
      if (paused) next.paused = true;
      else delete next.paused;
      await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      this.#runtimes.get(botId)?.setPaused?.(paused);
      this.#touch();
      return this.status();
    });
  }

  /**
   * Persist the outbound gate configuration (WG-QQ-04/05/06) and apply it to
   * the live runtime without reconnecting.
   */
  async setSendControl(botId, value) {
    if (!this.#configStore.get(botId)) throw new Error('Unknown QQ bot');
    const normalized = normalizeSendControl(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      await atConnectionStage('account.save', () => this.#configStore.save({
        ...current,
        sendControl: normalized,
      }), 'account-config');
      this.#runtimes.get(botId)?.setSendControl?.(normalized);
      this.#touch();
      return this.status();
    });
  }

  async setGroupParticipation(botId, value) {
    const settings = qqGroupParticipation(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      if (settings.judgeModel) {
        if (typeof this.#validateParticipationModel !== 'function') throw new Error('Participation model validation unavailable');
        await this.#validateParticipationModel(settings.judgeModel);
      }
      if (settings.enabled && !current.groupContextEnabled) throw new Error('Enable group context before participation');
      await atConnectionStage('account.save', () => this.#configStore.save({ ...current, groupParticipation: settings }), 'account-config');
      try { this.#runtimes.get(botId)?.setGroupParticipation(settings); }
      catch (error) {
        try { await this.#configStore.save(current); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Participation and configuration rollback failed'); }
        throw error;
      }
      this.#touch(); return this.status();
    });
  }

  async setPersona(botId, value) {
    const persona = qqPersona(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      await atConnectionStage('account.save', () => this.#configStore.save({ ...current, persona }), 'account-config');
      const runtime = this.#runtimes.get(botId);
      if (runtime) runtime.setPersona(persona);
      this.#touch();
      return this.status();
    });
  }

  async setStickersEnabled(botId, value) {
    const enabled = qqStickersEnabled(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      const next = { ...current };
      if (enabled) next.stickersEnabled = true;
      else delete next.stickersEnabled;
      await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      const runtime = this.#runtimes.get(botId);
      if (runtime) runtime.setStickersEnabled(enabled);
      this.#touch();
      return this.status();
    });
  }

  async setFamiliarityEnabled(botId, value) {
    const enabled = qqFamiliarityEnabled(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      const runtime = this.#runtimes.get(botId);
      if (!runtime) throw new Error('QQ 机器人尚未连接，无法应用熟识度设置。');
      if (enabled) runtime.prepareFamiliarity();
      const next = { ...current };
      if (enabled) next.familiarityEnabled = true;
      else delete next.familiarityEnabled;
      await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      runtime.setFamiliarityEnabled(enabled);
      this.#touch();
      return this.status();
    });
  }

  async listFamiliarity(botId, options) {
    return this.#withBotTransition(botId, () => {
      if (!this.#configStore.get(botId)) throw new Error('Unknown QQ bot');
      const runtime = this.#runtimes.get(botId);
      if (!runtime) throw new Error('QQ 机器人尚未连接，无法查看熟识度。');
      return runtime.listFamiliarity(options);
    });
  }

  async clearFamiliarity(botId, id) {
    return this.#withBotTransition(botId, () => {
      if (!this.#configStore.get(botId)) throw new Error('Unknown QQ bot');
      const runtime = this.#runtimes.get(botId);
      if (!runtime) throw new Error('QQ 机器人尚未连接，无法清除熟识度。');
      const result = runtime.clearFamiliarity(id);
      this.#touch();
      return result;
    });
  }

  async setGroupContextEnabled(botId, value) {
    const enabled = qqGroupContextEnabled(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      const next = { ...current };
      if (enabled) next.groupContextEnabled = true;
      else delete next.groupContextEnabled;
      await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      const runtime = this.#runtimes.get(botId);
      if (runtime) runtime.setGroupContextEnabled(enabled);
      this.#touch();
      return this.status();
    });
  }

  async setGroupMemoryEnabled(botId, value) {
    const enabled = qqGroupMemoryEnabled(value);
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      if (enabled && current.groupContextEnabled !== true) throw new Error('Enable QQ group context before long memory');
      const next = { ...current };
      if (enabled) next.groupMemoryEnabled = true;
      else delete next.groupMemoryEnabled;
      const runtime = this.#runtimes.get(botId);
      await atConnectionStage('account.save', () => this.#configStore.save(next), 'account-config');
      try {
        if (runtime) runtime.setGroupMemoryEnabled(enabled);
      } catch (error) {
        try { await this.#configStore.save(current); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'QQ memory initialization and configuration rollback failed'); }
        throw error;
      }
      this.#touch();
      return this.status();
    });
  }

  async setGroupMemoryModel(botId, kind, model) {
    if (!['text', 'image'].includes(kind)) throw new TypeError('Invalid group memory model kind');
    const selected = qqGroupMemoryModels({ [kind]: model })[kind];
    return this.#withBotTransition(botId, async () => {
      const current = this.#configStore.get(botId);
      if (!current) throw new Error('Unknown QQ bot');
      if (selected) {
        if (typeof this.#validateGroupMemoryModel !== 'function') throw new Error('Group memory model validation unavailable');
        await this.#validateGroupMemoryModel(kind, selected);
      }
      const models = { ...qqGroupMemoryModels(current.groupMemoryModels), [kind]: selected };
      await this.#configStore.save({ ...current, groupMemoryModels: models });
      this.#touch();
      return this.status();
    });
  }

  async compactGroupMemory(botId) {
    return this.#withBotTransition(botId, async () => {
      const config = this.#configStore.get(botId);
      const runtime = this.#runtimes.get(botId);
      if (!config || !runtime?.status.ready || config.groupMemoryEnabled !== true) throw new Error('QQ group memory is not enabled and connected');
      // Acknowledgement is immediate; the status reports running/completed/
      // failed. Never hold the account transition lock during a model call:
      // disabling or removing the bot must still be able to cancel that call.
      void runtime.compactGroupMemory().catch((error) => {
        if (error.name !== 'AbortError') this.#logger.error?.('[dsh-im:qq] requested group summary failed:', error);
        this.#touch();
      });
      this.#touch();
      return this.status();
    });
  }

  async presentSessionSyncApproval(botId, target, interaction, options = {}) {
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    return this.#withBotTransition(botId, async () => {
      const runtime = this.#runtimes.get(botId);
      if (!runtime?.status?.ready || typeof runtime.presentSessionSyncApproval !== 'function') {
        const error = new Error(t('QQ机器人尚未连接'));
        error.code = 'bot-not-connected';
        throw error;
      }
      return runtime.presentSessionSyncApproval(target, interaction, options);
    });
  }

  async deleteBot(botId) {
    const warnings = [];
    const config = this.#configStore.get(botId);
    if (!config) throw new Error('Unknown QQ bot');
    await this.#withBotTransition(botId, async () => {
      const previous = await atConnectionStage('credential.read', () => this.#credentials.resolve(config.secretRef), 'credential-store');
      await this.#stopRuntime(botId);
      try {
        await atConnectionStage('credential.remove', () => this.#credentials.unset(config.secretRef), 'credential-store');
        await atConnectionStage('account.remove', () => this.#configStore.remove(botId), 'account-config');
      } catch (error) {
        if (!this.#configStore.get(botId)) {
          warnings.push(this.#diagnostics.report(error, { operation: 'bot.delete', stage: 'workspace.cleanup', warning: true,
            publicError: { code: 'workspace-cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError);
        } else {
          if (previous?.value) {
            await atConnectionStage('credential.save', () => this.#credentials.set(config.secretRef, previous.value), 'credential-store').catch(() => undefined);
            await this.#startRuntime(config, previous.value).catch(() => undefined);
          }
          throw new Error('Unable to remove the QQ bot safely.', { cause: error });
        }
      }
      await this.#deleteState({ botId, config }).catch(error => { warnings.push(this.#diagnostics.report(error, { reuse: true, operation: 'bot.delete', stage: 'state.cleanup', resource: 'account-state', warning: true, publicError: { code: 'cleanup-failed', message: '账号已移除，但本地状态清理失败。' } }).publicError); });
      this.#errors.delete(botId);
      this.#touch();
    });
    return { ...this.status(), ...(warnings.length ? { warnings } : {}) };
  }

  status() {
    const bots = this.#configStore.list().map((config) => {
      const runtimeStatus = this.#runtimes.get(config.botId)?.status ?? null;
      const connected = runtimeStatus?.ready === true
        && runtimeStatus.qqConnectionState === 'connected'
        && runtimeStatus.harnessReachable === true;
      const state = connected ? 'connected'
        : runtimeStatus?.qqConnectionState === 'connecting' ? 'connecting'
          : this.#errors.has(config.botId) || runtimeStatus?.qqConnectionState === 'failed'
            ? 'error' : 'offline';
      return {
        botId: config.botId,
        state,
        connected,
        configured: true,
        // Default OFF: only an explicit persisted true pauses the account.
        paused: config.paused === true,
        // WG-QQ-04/05/06: all-disabled defaults are projected for the editor.
        sendControl: normalizeSendControl(config.sendControl),
        groupParticipation: qqGroupParticipation(config.groupParticipation),
        participationStats: runtimeStatus?.participationStats ?? null,
        groupReception: runtimeStatus?.groupReception ?? [],
        gatewayTransport: runtimeStatus?.gatewayTransport ?? null,
        persona: qqPersona(config.persona),
        familiarityEnabled: qqFamiliarityEnabled(config.familiarityEnabled),
        familiarity: runtimeStatus?.familiarity ?? null,
        stickersEnabled: qqStickersEnabled(config.stickersEnabled),
        groupContextEnabled: qqGroupContextEnabled(config.groupContextEnabled),
        groupMemoryEnabled: qqGroupMemoryEnabled(config.groupMemoryEnabled),
        groupMemoryModels: qqGroupMemoryModels(config.groupMemoryModels),
        groupMemory: runtimeStatus?.groupMemory ?? null,
        groupContextStats: {
          recorded: runtimeStatus?.groupContextRecorded ?? 0,
          rejected: runtimeStatus?.groupContextRejected ?? 0,
        },
        bot: { name: t('QQ机器人'), appIdMasked: maskQqAppId(config.appId) },
        health: {
          status: connected ? 'healthy' : state === 'error' ? 'error' : 'offline',
          summary: connected ? t('QQ WebSocket 长连接运行正常')
            : this.#errors.get(config.botId)?.message
              ?? (state === 'error' ? t('QQ 连接未就绪，插件会自动重试') : t('QQ 连接当前离线')),
          lastCheckedAt: runtimeStatus?.lastCheckedAt ?? null,
          lastConnectedAt: runtimeStatus?.lastConnectedAt ?? null,
        },
        stats: {
          messagesReceived: runtimeStatus?.messagesReceived ?? 0,
          messagesReplied: runtimeStatus?.messagesReplied ?? 0,
          messagesDroppedImageTimeout: runtimeStatus?.messagesDroppedImageTimeout ?? 0,
        },
        lastMessageError: publicMessageFailure(runtimeStatus?.lastMessageError),
        error: structuredClone(runtimeStatus?.error ?? this.#errors.get(config.botId) ?? null),
      };
    });
    const connectedCount = bots.filter((bot) => bot.connected).length;
    const active = this.#activeAttemptId ? this.#attempts.get(this.#activeAttemptId) : null;
    return {
      schemaVersion: 1,
      revision: this.#revision,
      state: active && ACTIVE_ATTEMPT_STATES.has(active.state) ? 'provisioning'
        : bots.length === 0 ? 'disconnected'
          : connectedCount === bots.length ? 'connected'
            : connectedCount > 0 ? 'degraded' : 'offline',
      bots,
      totals: { configured: bots.length, connected: connectedCount },
      ...(active && ACTIVE_ATTEMPT_STATES.has(active.state)
        ? { provisioning: publicAttempt(active) } : {}),
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeAttemptId) await this.cancelProvisioning(this.#activeAttemptId);
    await Promise.allSettled([...this.#transitions.values()]);
    await Promise.allSettled([...this.#runtimes.keys()].map((botId) => this.#stopRuntime(botId)));
  }

  async #completeProvisioning(record, credentials) {
    try {
      record.state = 'connecting';
      record.verificationUrl = null;
      record.expiresAt = null;
      this.#touch();
      const credential = Array.isArray(credentials) ? credentials[0] : null;
      const appId = cleanString(credential?.appId);
      const appSecret = cleanString(credential?.appSecret);
      const ownerUserOpenid = cleanString(credential?.userOpenid);
      if (!appId || !appSecret || !ownerUserOpenid) {
        throw new Error('QQ authorization returned incomplete credentials');
      }
      record.botId = await this.#activateBot(record, { appId, appSecret, ownerUserOpenid });
      record.state = 'connected';
      record.error = null;
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.state = 'cancelled';
        record.error = safeError('cancelled', t('扫码绑定已取消。'));
      } else {
        record.state = 'failed';
        record.error = this.#failure(error, 'activation-failed', t('QQ 已授权，但无法安全保存接入配置。'));

      }
    } finally {
      record.dispose?.();
      if (this.#activeAttemptId === record.id) this.#activeAttemptId = null;
      this.#touch();
    }
  }

  async #activateBot(record, { appId, appSecret, ownerUserOpenid }) {
    const identity = deriveQqBotIdentity(appId);
    const previousConfig = this.#configStore.getByAppId(appId);
    const previousSecret = await atConnectionStage('credential.read', () => this.#credentials.resolve(identity.secretRef), 'credential-store');
    const config = {
      botId: identity.botId,
      appId,
      secretRef: identity.secretRef,
      ownerUserOpenid,
      // A QR rescan can change the account owner. Keep mapped group identities
      // only when the confirmed direct identity still matches the new scanner.
      ...(previousConfig?.computerCommandOwners?.direct === ownerUserOpenid
        ? { computerCommandOwners: previousConfig.computerCommandOwners } : {}),
      createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      // A rescan keeps the existing pause decision; resuming stays explicit.
      ...(previousConfig?.paused === true ? { paused: true } : {}),
      ...(previousConfig?.groupParticipation === undefined ? {} : { groupParticipation: previousConfig.groupParticipation }),
      ...(previousConfig?.familiarityEnabled === true ? { familiarityEnabled: true } : {}),
        ...(previousConfig?.persona === undefined ? {} : { persona: previousConfig.persona }),
      ...(previousConfig?.stickersEnabled === true ? { stickersEnabled: true } : {}),
      ...(previousConfig?.groupContextEnabled === true ? { groupContextEnabled: true } : {}),
      ...(previousConfig?.groupMemoryEnabled === true ? { groupMemoryEnabled: true } : {}),
      ...(previousConfig?.groupMemoryModels ? { groupMemoryModels: previousConfig.groupMemoryModels } : {}),
    };
    return this.#withBotTransition(identity.botId, async () => {
      await atConnectionStage('credential.save', () => this.#credentials.set(identity.secretRef, appSecret), 'credential-store');
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await atConnectionStage('account.save', () => this.#configStore.save(config), 'account-config');
      } catch (error) {
        await this.#restoreCredential(identity.secretRef, previousSecret);
        throw error;
      }
      try {
        if (record.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await this.#startRuntime(config, appSecret);
        this.#errors.delete(identity.botId);
      } catch (error) {
        if (record.controller.signal.aborted) {
          await this.#stopRuntime(identity.botId);
          if (previousConfig) await atConnectionStage('account.save', () => this.#configStore.save(previousConfig), 'account-config').catch(() => undefined);
          else {
            const removed = await atConnectionStage('account.remove', () => this.#configStore.remove(identity.botId), 'account-config').catch(() => null);
            if (removed) {
              await this.#deleteState({ botId: identity.botId, config }).catch((cleanupError) => {
                this.#logger.warn?.('[dsh-im:qq] cancelled bot state cleanup failed:', extractConnectionEvidence(cleanupError).details);
              });
            }
          }
          await this.#restoreCredential(identity.secretRef, previousSecret);
          throw error;
        }
        this.#errors.set(identity.botId, this.#diagnostics.report(error, { reuse: true, publicError: connectionError(error, t('QQ 机器人已绑定，消息连接暂未就绪。')) , stage: 'connection.start' }).publicError);

      }
      this.#touch();
      return identity.botId;
    });
  }

  async #startRuntime(config, appSecret) {
    if (this.#closed) throw new Error('QQ controller is closed');
    await this.#stopRuntime(config.botId);
    if (this.#closed) throw new Error('QQ controller is closed');
    const runtime = await atConnectionStage('runtime.prepare', () => this.#createRuntime({ botId: config.botId, config, appSecret }));
    if (!runtime || typeof runtime.start !== 'function' || typeof runtime.stop !== 'function') {
      throw new TypeError('createRuntime returned an invalid QQ runtime');
    }
    this.#runtimes.set(config.botId, runtime);
    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop().catch(() => undefined);
      this.#runtimes.delete(config.botId);
      throw error;
    }
  }

  async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    this.#runtimes.delete(botId);
    await runtime?.stop().catch((error) => {
      this.#logger.warn?.(`[dsh-im:qq] bot ${botId} failed to stop cleanly:`, extractConnectionEvidence(error).details);
    });
  }

  async #resolveSecret(ref) {
    const result = await atConnectionStage('credential.read', () => this.#credentials.resolve(ref), 'credential-store');
    return cleanString(result?.value);
  }

  async #restoreCredential(ref, previous) {
    if (previous?.value) await atConnectionStage('credential.save', () => this.#credentials.set(ref, previous.value), 'credential-store').catch(() => undefined);
    else await atConnectionStage('credential.remove', () => this.#credentials.unset(ref), 'credential-store').catch(() => undefined);
  }

  #withBotTransition(botId, operation) {
    const previous = this.#transitions.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.finally(() => {
      if (this.#transitions.get(botId) === settled) this.#transitions.delete(botId);
    });
    this.#transitions.set(botId, settled);
    return settled;
  }

  #touch() {
    this.#revision += 1;
  }
}
