import { qqGroupParticipation } from '../../../../src/channels/qq/group-participation.mjs';
import { qqPersona } from '../../../../src/channels/qq/persona.mjs';
import { SET_MESSAGE_MODE_ENDPOINT, validMessageModePayload } from '../../../../src/channels/shared/message-mode.mjs';
import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { SET_ALIAS_ENDPOINT, validAliasPayload } from '../shared/bot-alias-rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import QRCode from 'qrcode';
import {
  connectionTestTargetUnavailable,
  publicConnectionTestResult,
} from '../../../../src/channels/shared/connection-test.mjs';
import { SET_CONTEXT_ENHANCEMENT_ENDPOINT, validContextEnhancementPayload } from '../shared/context-enhancement-rpc.mjs';
import { SET_ACCESS_POLICY_ENDPOINT, validAccessPolicyPayload } from '../shared/access-policy-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { publicWorkspaceError, SET_WORKSPACE_ENDPOINT, validWorkspacePayload } from '../shared/workspace-rpc.mjs';
import { publicQqStateError } from '../../../../src/channels/qq/state-error.mjs';
import { SET_AGENT_PRESET_ENDPOINT, validAgentPresetPayload } from '../shared/agent-preset-rpc.mjs';
import { SET_MODEL_ENDPOINT, validModelPayload } from '../shared/model-setting-rpc.mjs';

export const QQ_RPC_CHANNEL = '/qq';

/**
 * Account-level persistent pause (WG-QQ-03). The endpoint carries only a
 * boolean; the response is the ordinary redacted bot snapshot.
 */
export const SET_ACCOUNT_PAUSE_ENDPOINT = 'bot.account-pause.set';
export const SET_SEND_CONTROL_ENDPOINT = 'bot.send-control.set';
export const SET_GROUP_CONTEXT_ENDPOINT = 'bot.group-context.set';

export const QQ_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  pollProvisioning: 'provision.poll',
  cancelProvisioning: 'provision.cancel',
  bindCredentials: 'bot.bind-credentials',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: SET_WORKSPACE_ENDPOINT,
  setModel: SET_MODEL_ENDPOINT,
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT,
  setContextEnhancement: SET_CONTEXT_ENHANCEMENT_ENDPOINT,
  setBusyMessageMode: SET_MESSAGE_MODE_ENDPOINT,
  setAccessPolicy: SET_ACCESS_POLICY_ENDPOINT,
  setAlias: SET_ALIAS_ENDPOINT,
  setAccountPause: SET_ACCOUNT_PAUSE_ENDPOINT,
  setSendControl: SET_SEND_CONTROL_ENDPOINT,
  setGroupContext: SET_GROUP_CONTEXT_ENDPOINT,
  setGroupParticipation: 'bot.group-participation.set',
  setPersona: 'bot.persona.set',
  setFamiliarity: 'bot.familiarity.set',
  listFamiliarity: 'bot.familiarity.list',
  clearFamiliarity: 'bot.familiarity.clear',
  setStickers: 'bot.stickers.set',
  setGroupMemory: 'bot.group-memory.set',
  setGroupMemoryModel: 'bot.group-memory.model.set',
  compactGroupMemory: 'bot.group-memory.compact',
});
export const QQ_RPC_ENDPOINTS = Object.freeze(Object.values(QQ_ENDPOINTS));

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'appSecret', 'app_secret', 'secretRef', 'ownerUserOpenid', 'userOpenid', 'verificationUrl',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validCredential(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validAccountPausePayload(payload) {
  return exactKeys(payload, ['botId', 'paused'])
    && validId(payload.botId)
    && typeof payload.paused === 'boolean';
}

function payloadFailure(endpoint, payload) {
  if (!isRecord(payload)) return 'Payload must be an object.';
  if (endpoint === QQ_ENDPOINTS.status) return exactKeys(payload, []) ? null : 'connection.status does not accept fields.';
  if (endpoint === QQ_ENDPOINTS.beginProvisioning) {
    return exactKeys(payload, ['locale']) && (payload.locale === undefined || payload.locale === 'zh-CN')
      ? null : 'provision.begin received unsupported fields.';
  }
  if ([QQ_ENDPOINTS.pollProvisioning, QQ_ENDPOINTS.cancelProvisioning].includes(endpoint)) {
    return exactKeys(payload, ['attemptId']) && validId(payload.attemptId)
      ? null : `${endpoint} requires an attemptId.`;
  }
  if (endpoint === QQ_ENDPOINTS.bindCredentials) {
    return exactKeys(payload, ['appId', 'appSecret'])
      && validCredential(payload.appId, 256)
      && validCredential(payload.appSecret, 1024)
      ? null : 'bot.bind-credentials requires AppID and AppSecret.';
  }
  if (endpoint === QQ_ENDPOINTS.reconnectBot) {
    return exactKeys(payload, ['botId', 'sendTest'])
      && validId(payload.botId)
      && (payload.sendTest === undefined || payload.sendTest === true)
      ? null : 'bot.reconnect requires a botId and accepts only sendTest=true.';
  }
  if (endpoint === QQ_ENDPOINTS.deleteBot) {
    return exactKeys(payload, ['botId', 'confirm']) && validId(payload.botId) && payload.confirm === true
      ? null : 'bot.delete requires a botId and confirm=true.';
  }
  if (endpoint === QQ_ENDPOINTS.setWorkspace) {
    return validWorkspacePayload(payload)
      ? null : '请输入工作区绝对路径。';
  }
  if (endpoint === QQ_ENDPOINTS.setModel) {
    return validModelPayload(payload) ? null : '请选择有效模型。';
  }
  if (endpoint === QQ_ENDPOINTS.setAgentPreset) {
    return validAgentPresetPayload(payload)
      ? null : '请选择 Agent Preset。';
  }
  if (endpoint === QQ_ENDPOINTS.setBusyMessageMode) {
    return validMessageModePayload(payload)
      ? null : '请提交有效的消息处理方式。';
  }
  if (endpoint === QQ_ENDPOINTS.setContextEnhancement) {
    return validContextEnhancementPayload(payload)
      ? null : '请提交有效的上下文增强设置。';
  }
  if (endpoint === QQ_ENDPOINTS.setAccessPolicy) {
    return validAccessPolicyPayload(payload)
      ? null : '请提交有效的访问设置。';
  }
  if (endpoint === QQ_ENDPOINTS.setAlias) {
    return validAliasPayload(payload)
      ? null : '请输入有效的别名（最多 80 个字符）。';
  }
  if (endpoint === QQ_ENDPOINTS.setAccountPause) {
    return validAccountPausePayload(payload)
      ? null : 'bot.account-pause.set requires a botId and a boolean paused.';
  }
  if (endpoint === QQ_ENDPOINTS.setSendControl) {
    return exactKeys(payload, ['botId', 'sendControl'])
      && validId(payload.botId)
      && isRecord(payload.sendControl)
      ? null : 'bot.send-control.set requires a botId and a sendControl object.';
  }
  if ([QQ_ENDPOINTS.setGroupContext, QQ_ENDPOINTS.setGroupMemory, QQ_ENDPOINTS.setStickers, QQ_ENDPOINTS.setFamiliarity].includes(endpoint)) {
    return exactKeys(payload, ['botId', 'enabled']) && validId(payload.botId)
      && typeof payload.enabled === 'boolean'
      ? null : 'bot.group-context.set requires a botId and a boolean enabled.';
  }
  if (endpoint === QQ_ENDPOINTS.listFamiliarity) {
    return exactKeys(payload, ['botId', 'offset']) && validId(payload.botId)
      && (payload.offset === undefined || (Number.isSafeInteger(payload.offset) && payload.offset >= 0))
      ? null : '请提交有效的熟识度分页参数。';
  }
  if (endpoint === QQ_ENDPOINTS.clearFamiliarity) {
    return exactKeys(payload, ['botId', 'id']) && validId(payload.botId)
      && typeof payload.id === 'string' && /^[a-f0-9]{64}$/.test(payload.id)
      ? null : '请提交有效的熟识度记录编号。';
  }
  if (endpoint === QQ_ENDPOINTS.setGroupParticipation) {
    try {
      if (!exactKeys(payload, ['botId', 'settings']) || !validId(payload.botId) || !Object.hasOwn(payload, 'settings')) return '请提交有效的群聊自主参与设置。';
      qqGroupParticipation(payload.settings); return null;
    } catch { return '请提交有效的群聊自主参与设置。'; }
  }
  if (endpoint === QQ_ENDPOINTS.setPersona) {
    try {
      if (!exactKeys(payload, ['botId', 'persona']) || !validId(payload.botId) || !Object.hasOwn(payload, 'persona')) return '请提交有效的人格基线。';
      qqPersona(payload.persona); return null;
    } catch { return '请提交有效的人格基线（最多 4000 字符）。'; }
  }
  if (endpoint === QQ_ENDPOINTS.setGroupMemoryModel) {
    return exactKeys(payload, ['botId', 'kind', 'model'])
      && ['text', 'image'].includes(payload.kind)
      && validModelPayload({ botId: payload.botId, model: payload.model })
      ? null : 'bot.group-memory.model.set requires botId, kind and model.';
  }
  if (endpoint === QQ_ENDPOINTS.compactGroupMemory) {
    return exactKeys(payload, ['botId']) && validId(payload.botId)
      ? null : 'bot.group-memory.compact requires a botId.';
  }
  return 'Unknown QQ endpoint.';
}

function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (!isRecord(value)) return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (!FORBIDDEN_PUBLIC_KEYS.has(key)) safe[key] = sanitizePublic(child);
  }
  return safe;
}

async function qrDataUrl(value) {
  return QRCode.toDataURL(value, {
    type: 'image/png', errorCorrectionLevel: 'M', margin: 2, width: 320,
  });
}

async function withEncodedQr(value, encodeQr) {
  if (!value || typeof value.verificationUrl !== 'string') return sanitizePublic(value);
  return sanitizePublic({ ...value, qrCodeDataUrl: await encodeQr(value.verificationUrl) });
}

async function publicStatus(status, encodeQr) {
  const value = structuredClone(status);
  if (value?.provisioning) value.provisioning = await withEncodedQr(value.provisioning, encodeQr);
  return sanitizePublic(value);
}

export function createQqRpcHandler(controller, { encodeQr = qrDataUrl } = {}) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: 'qq' });
  for (const method of ['status', 'startProvisioning', 'registrationStatus', 'cancelProvisioning', 'bindCredentials', 'reconnectBot', 'deleteBot']) {
    if (typeof controller?.[method] !== 'function') throw new TypeError(`A complete QQ controller is required (${method})`);
  }
  const qrCache = new Map();
  const cachedEncode = (url) => {
    let encoded = qrCache.get(url);
    if (!encoded) {
      if (qrCache.size >= 16) qrCache.delete(qrCache.keys().next().value);
      encoded = Promise.resolve().then(() => encodeQr(url));
      qrCache.set(url, encoded);
    }
    return encoded;
  };
  return async (endpoint, payload, signal) => {
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    if (!QQ_RPC_ENDPOINTS.includes(endpoint)) return { ok: false, error: { code: 'bad-request', message: 'Unknown QQ endpoint.' } };
    const invalid = payloadFailure(endpoint, payload);
    if (invalid) return { ok: false, error: { code: 'bad-request', message: invalid } };
    try {
      let value;
      if (endpoint === QQ_ENDPOINTS.status) value = await publicStatus(await controller.status(), cachedEncode);
      else if (endpoint === QQ_ENDPOINTS.beginProvisioning) value = await withEncodedQr(await controller.startProvisioning(), cachedEncode);
      else if (endpoint === QQ_ENDPOINTS.pollProvisioning) {
        const current = await controller.registrationStatus(payload.attemptId);
        if (!current) return { ok: false, error: { code: 'bad-request', message: 'The provisioning attempt no longer exists.' } };
        value = await withEncodedQr(current, cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.cancelProvisioning) {
        value = sanitizePublic(await controller.cancelProvisioning(payload.attemptId));
      } else if (endpoint === QQ_ENDPOINTS.bindCredentials) {
        value = await publicStatus(await controller.bindCredentials(payload), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.reconnectBot) {
        const snapshot = await controller.reconnectBot(payload.botId);
        if (signal?.aborted) {
          return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
        }
        let testMessage;
        if (payload.sendTest === true) {
          const connected = snapshot?.bots?.some(
            (bot) => bot?.botId === payload.botId && bot?.connected === true,
          ) === true;
          if (!connected || typeof controller.sendConnectionTest !== 'function') {
            testMessage = publicConnectionTestResult(
              connectionTestTargetUnavailable('QQ机器人'),
            );
          } else {
            let testError = null;
            try {
              await controller.sendConnectionTest(payload.botId);
            } catch (error) {
              testError = error;
            }
            testMessage = publicConnectionTestResult(testError, { diagnostics, botId: payload.botId });
          }
        }
        value = await publicStatus({
          ...snapshot,
          ...(testMessage ? { testMessage } : {}),
        }, cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.setWorkspace) {
        if (typeof controller.updateWorkspace !== 'function') throw new Error('Workspace update is unavailable');
        value = await publicStatus(
          await controller.updateWorkspace(payload.botId, payload.workspace),
          cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setModel) {
        if (typeof controller.updateModel !== 'function') throw new Error('Model update is unavailable');
        value = await publicStatus(
          await controller.updateModel(payload.botId, payload.model),
          cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setBusyMessageMode) {
        if (typeof controller.updateBusyMessageMode !== 'function') throw new Error('Message mode update is unavailable');
        value = await controller.updateBusyMessageMode(
          payload.botId, payload.busyMessageMode, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === QQ_ENDPOINTS.setContextEnhancement) {
        if (typeof controller.updateContextEnhancement !== 'function') throw new Error('Context enhancement update is unavailable');
        value = await controller.updateContextEnhancement(
          payload.botId, payload.config, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === QQ_ENDPOINTS.setAlias) {
        if (typeof controller.updateAlias !== 'function') throw new Error('Alias update is unavailable');
        value = await controller.updateAlias(
          payload.botId, payload.alias, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === QQ_ENDPOINTS.setAccessPolicy) {
        if (typeof controller.updateAccessPolicy !== 'function') throw new Error('Access policy update is unavailable');
        value = await controller.updateAccessPolicy(
          payload.botId, payload.policy, (status) => publicStatus(status, cachedEncode),
        );
      } else if (endpoint === QQ_ENDPOINTS.setAgentPreset) {
        if (typeof controller.updateAgentPreset !== 'function') throw new Error('Agent preset update is unavailable');
        value = await publicStatus(
          await controller.updateAgentPreset(payload.botId, payload.agentPreset),
          cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setAccountPause) {
        if (typeof controller.setPaused !== 'function') throw new Error('Account pause update is unavailable');
        value = await publicStatus(
          await controller.setPaused(payload.botId, payload.paused),
          cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setSendControl) {
        if (typeof controller.setSendControl !== 'function') throw new Error('Send control update is unavailable');
        value = await publicStatus(
          await controller.setSendControl(payload.botId, payload.sendControl),
          cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setGroupParticipation) {
        value = await publicStatus(await controller.setGroupParticipation(payload.botId, payload.settings), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.setPersona) {
        value = await publicStatus(await controller.setPersona(payload.botId, payload.persona), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.setFamiliarity) {
        value = await publicStatus(await controller.setFamiliarityEnabled(payload.botId, payload.enabled), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.listFamiliarity) {
        value = sanitizePublic(await controller.listFamiliarity(payload.botId, { offset: payload.offset }));
      } else if (endpoint === QQ_ENDPOINTS.clearFamiliarity) {
        value = await controller.clearFamiliarity(payload.botId, payload.id);
      } else if (endpoint === QQ_ENDPOINTS.setStickers) {
        value = await publicStatus(await controller.setStickersEnabled(payload.botId, payload.enabled), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.setGroupContext) {
        value = await publicStatus(
          await controller.setGroupContextEnabled(payload.botId, payload.enabled), cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setGroupMemory) {
        value = await publicStatus(
          await controller.setGroupMemoryEnabled(payload.botId, payload.enabled), cachedEncode,
        );
      } else if (endpoint === QQ_ENDPOINTS.setGroupMemoryModel) {
        value = await publicStatus(await controller.setGroupMemoryModel(payload.botId, payload.kind, payload.model), cachedEncode);
      } else if (endpoint === QQ_ENDPOINTS.compactGroupMemory) {
        value = await publicStatus(await controller.compactGroupMemory(payload.botId), cachedEncode);
      } else {
        value = await publicStatus(await controller.deleteBot(payload.botId), cachedEncode);
      }
      return signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: true, value };
    } catch (error) {
      const workspaceError = publicWorkspaceError(error);
      return diagnosticRpcResult(diagnostics, error, signal?.aborted
        ? { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } }
        : { ok: false, error: publicQqStateError(error) ?? workspaceError
          ?? { code: 'qq-operation-failed', message: 'QQ 操作失败，请稍后重试。' } }, { operation: endpoint, botId: payload?.botId });
    }
  };
}

export function installQqRpc(ctx, controller, options, authority) {
  return registerManagementRpc(ctx,
    QQ_RPC_CHANNEL,
    createQqRpcHandler(controller, options),
    { authority: resolveRpcAuthority(authority) },
  );
}
