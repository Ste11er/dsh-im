import * as React from 'react';
import { h, localizeText } from '../../i18n.js';
import { qqPersona, DEFAULT_QQ_PERSONA, QQ_PERSONA_MAX_LENGTH } from '../../../../src/channels/qq/persona.mjs';
export function PersonaEditor({ persona, disabled, onSave }) {
  const saved = qqPersona(persona);
  const savedText = saved.text === DEFAULT_QQ_PERSONA ? localizeText(DEFAULT_QQ_PERSONA) : saved.text;
  const [text, setText] = React.useState(savedText);
  const [enabled, setEnabled] = React.useState(saved.enabled);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const id = React.useId();
  const save = async () => {
    setSaving(true); setError(null);
    try { await onSave({ enabled, text }); }
    catch (cause) { setError(cause?.message ?? '人格基线保存失败，请重试。'); }
    finally { setSaving(false); }
  };
  React.useEffect(() => {
    if (!dirty || (savedText === text && saved.enabled === enabled)) {
      setText(savedText); setEnabled(saved.enabled); setDirty(false);
    }
  }, [savedText, saved.enabled, dirty, text, enabled]);
  return h('fieldset', { className: 'dqq-sendControl', disabled: disabled || saving },
    h('legend', null, '人格基线'),
    h('p', null, '设置性格、说话方式和互动习惯，保存后对后续群聊及私聊回复生效。'),
    h('label', { htmlFor: id + '-enabled' }, '使用状态'),
    h('select', { id: id + '-enabled', value: enabled ? 'on' : 'off', onChange: event => { setEnabled(event.target.value === 'on'); setDirty(true); } },
      h('option', { value: 'off' }, '关闭'), h('option', { value: 'on' }, '启用')),
    h('label', { htmlFor: id + '-text' }, '人格与表达风格'),
    h('textarea', { id: id + '-text', value: text, rows: 8, maxLength: QQ_PERSONA_MAX_LENGTH,
      style: { width: '100%', boxSizing: 'border-box', resize: 'vertical' },
      onChange: event => { setText(event.target.value); setDirty(true); } }),
    h('p', null, '关闭会保留正文；不会开启长期记忆。'),
    h('button', { type: 'button', disabled, onClick: () => { setText(localizeText(DEFAULT_QQ_PERSONA)); setDirty(true); } }, '恢复默认人格'),
    h('button', { type: 'button', disabled: disabled || saving || !dirty || (enabled && !text.trim()), onClick: save }, '保存人格基线'),
    error ? h('p', { role: 'alert' }, error) : null);
}
