import * as React from 'react';
import { h } from '../../i18n.js';

export function FamiliarityEditor({ enabled, status, disabled, onChange, onList, onClear }) {
  const [page, setPage] = React.useState(null);
  const [offset, setOffset] = React.useState(0);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null);
  const id = React.useId();
  const run = async fn => {
    setWorking(true); setError(null);
    try { await fn(); }
    catch (cause) { setError(cause.message); }
    finally { setWorking(false); }
  };
  const load = async next => { const result = await onList(next); setPage(result); setOffset(next); setConfirm(null); };
  return h('fieldset', { className: 'dqq-sendControl', disabled: Boolean(disabled) || working },
    h('legend', null, '熟识度'),
    h('p', null, '按本地活跃自然日和直接互动天数逐渐熟悉成员；不增加模型调用，不改变好感度和权限。'),
    h('label', { htmlFor: id }, '使用状态'),
    h('select', { id, value: enabled ? 'on' : 'off', onChange: event => run(() => onChange(event.target.value === 'on')) },
      h('option', { value: 'off' }, '关闭'), h('option', { value: 'on' }, '启用')),
    h('p', null, '从启用后开始统计，群与私聊分开。关闭后停止记录并保留已有计数；不会开启长期记忆或回填历史。'),
    status?.lastError ? h('p', { role: 'alert' }, status.lastError.message) : null,
    h('p', null, '本地成员记录：', status?.members ?? '尚未读取'),
    h('button', { type: 'button', onClick: () => run(() => load(0)) }, '查看／刷新熟识度'),
    page ? h('div', null,
      page.items.length ? h('ul', null, ...page.items.map(item => h('li', { key: item.id },
        h('span', null, item.label, '：', item.stage, ' ', item.score, '/100；活跃 ', item.activeDays, ' 天，直接互动 ', item.addressedDays, ' 天'),
        h('button', { type: 'button', onClick: () => setConfirm(item.id) }, '清除此人'),
        confirm === item.id ? h('span', null, '清除后从下一次互动重新计算。',
          h('button', { type: 'button', onClick: () => run(async () => { await onClear(item.id); await load(offset); }) }, '确认清除'),
          h('button', { type: 'button', onClick: () => setConfirm(null) }, '取消')) : null)))
        : h('p', null, '这一页没有熟识度记录。'),
      h('button', { type: 'button', disabled: offset === 0, onClick: () => run(() => load(Math.max(0, offset - 20))) }, '上一页'),
      h('button', { type: 'button', disabled: page.nextOffset === null, onClick: () => run(() => load(page.nextOffset)) }, '下一页')) : null,
    error ? h('p', { role: 'alert' }, error) : null);
}
