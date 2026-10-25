// Shared with the browser; storage and model code belong to Host modules.
import { normalizeModelSelection } from '../shared/model-setting.mjs';

export function qqGroupMemoryModels(value = undefined) {
  if (value === undefined) return { text: null, image: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['text', 'image'].includes(key))) throw new TypeError('Invalid groupMemoryModels');
  const result = {};
  for (const kind of ['text', 'image']) {
    const model = value[kind];
    if (model === undefined || model === null) result[kind] = null;
    else {
      if (typeof model !== 'object' || Array.isArray(model)
        || Object.keys(model).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))) throw new TypeError('Invalid group memory model');
      const normalized = normalizeModelSelection(model);
      if (!normalized) throw new TypeError('Invalid group memory model');
      result[kind] = normalized;
    }
  }
  return result;
}

export function qqGroupMemoryEnabled(value = false) {
  if (typeof value !== 'boolean') throw new TypeError('groupMemoryEnabled must be a boolean');
  return value;
}

export function publicGroupMemoryStatus(value) {
  if (!value || typeof value !== 'object') return null;
  const count = (name) => Number.isSafeInteger(value[name]) && value[name] >= 0 ? value[name] : null;
  return {
    enabled: value.enabled === true, archived: count('archived'), summaries: count('summaries'),
    pending: count('pending'), summarizing: value.summarizing === true,
    pendingImages: count('pendingImages'),
    lastSummaryAt: Number.isSafeInteger(value.lastSummaryAt) ? value.lastSummaryAt : null,
    lastError: value.lastError && typeof value.lastError.code === 'string'
      ? { code: value.lastError.code.slice(0, 80) } : null,
  };
}
