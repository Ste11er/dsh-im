import * as React from 'react';
import { ModelEditor } from '../../model-setting.js';
import { h } from '../../i18n.js';
import { qqGroupParticipation } from '../../../../src/channels/qq/group-participation.mjs';
export function ParticipationEditor({ settings, contextEnabled, stats, disabled, onSave }) {
  const value = qqGroupParticipation(settings);
  const [enabled, setEnabled] = React.useState(value.enabled);
  const [seconds, setSeconds] = React.useState(String(value.cooldownSeconds));
  const [dirty, setDirty] = React.useState(false); const [error, setError] = React.useState(null); const [saving, setSaving] = React.useState(false);
  const id = React.useId();
  React.useEffect(() => {
    if (!dirty || (enabled === value.enabled && Number(seconds) === value.cooldownSeconds)) {
      setEnabled(value.enabled); setSeconds(String(value.cooldownSeconds)); setDirty(false);
    }
  }, [value.enabled, value.cooldownSeconds, dirty, enabled, seconds]);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (!seconds.trim()) throw new Error('请填写冷却秒数。');
      const next = qqGroupParticipation({ enabled, judgeModel: value.judgeModel, cooldownSeconds: Number(seconds) });
      await onSave(next);
    } catch (cause) { setError(cause?.message ?? '自主参与设置保存失败，请重试。'); }
    finally { setSaving(false); }
  };
  return h('fieldset', { className: 'dqq-sendControl', disabled: disabled || saving },
    h('legend', null, '群聊自主参与'),
    h('p', null, '未被 @ 时由模型决定是否接话，不做概率抽样；被 @ 仍照常回复。'),
    h('label', { htmlFor: id + '-enabled' }, '使用状态'),
    h('select', { id: id + '-enabled', value: enabled ? 'on' : 'off', onChange: event => { setEnabled(event.target.value === 'on'); setDirty(true); } }, h('option', { value: 'off' }, '关闭'), h('option', { value: 'on', disabled: !contextEnabled }, '启用')),
    h('label', { htmlFor: id + '-seconds' }, '每群候选评估冷却（秒）'),
    h('input', { id: id + '-seconds', type: 'number', min: 1, step: 1, value: seconds, onChange: event => { setSeconds(event.target.value); setDirty(true); } }),
    h('p', null, '默认冷却 180 秒，限制模型评估频率。按语义判断发言是否完整，未说完则保留同一人的片段等后文；不靠停顿触发。文字和图片都可判断，需开启短期群聊上下文。'),
    h('p', null, '自主接话仅开放表情相关工具，不执行文件或命令操作；暂停发送、安静时段与发送预算仍生效。'),
    enabled && !contextEnabled ? h('p', { role: 'status' }, '群聊上下文已关闭，自主参与暂停。') : null,
    stats ? h('p', null, '候选：', stats.candidates, ' · ', '保持安静：', stats.declined, ' · ', '继续听：', stats.waiting ?? 0, ' · ', '已接话：', stats.replied, ' · ', '失败：', stats.errors) : null,
    stats?.lastError ? h('p', { role: 'status' }, stats.lastError.code === 'qq-connect-timeout'
      ? '连接 QQ API 超时，本次未发送；已尝试重新连接一次。'
      : stats.lastError.code === 'qq-reply-expired'
        ? 'QQ 回复窗口已过期，本次未发送；请发一条新消息。'
        : stats.lastError.code === 'qq-judgment-invalid'
          ? '接话判断返回格式无效，本次尚未调用 QQ 发送接口。'
        : '自主接话处理失败，请查看诊断记录。') : null,
    h(ModelEditor, { model: value.judgeModel, disabled: disabled || saving || dirty, title: '自主参与：判断模型', defaultModelLabel: '判断模型跟随回复模型', help: '先独立判断是否接话；同意后在与被 @ 回复相同的群会话中生成回复，保留自己之前说过的话。未单独选择时，判断模型跟随回复模型。', onSave: judgeModel => onSave({ ...value, judgeModel }) }),
    h('button', { type: 'button', disabled: disabled || saving || !dirty || (enabled && !contextEnabled), onClick: save }, '保存自主参与设置'),
    error ? h('p', { role: 'alert' }, error) : null);
}
