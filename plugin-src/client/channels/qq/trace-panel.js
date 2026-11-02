import * as React from 'react';
import { h, localizeText as t } from '../../i18n.js';

const LABELS = {
  received: '已接收', allowed: '访问允许', 'access-denied': '访问拒绝', 'context-off': '上下文关闭', duplicate: '重复消息',
  'busy-dropped': '忙时丢弃', 'ambient-recorded': '已记录背景', assessing: '判断中', waiting: '继续听', declined: '保持安静',
  'reply-started': '开始回复', 'mention-accepted': '已识别唤醒', 'image-timeout-dropped': '图片超时丢弃', 'window-expired': '回复窗口已过期',
  disabled: '未启用', ineligible: '不满足接话条件', coalesced: '冷却或合并等待', cancelled: '已取消', queued: '已排队',
  started: '已开始', completed: '已完成', failed: '失败', unknown: '结果未知', sent: '平台已接受', 'not-attempted': '未尝试', running: '处理中',
};
Object.assign(LABELS, { prepared: '上下文就绪', 'empty-waiting': '等待空唤醒补充', 'empty-expired': '空唤醒已超时', 'empty-merged': '空唤醒已合并', 'empty-cancelled': '空唤醒已取消', 'empty-followup': '收到唤醒补充' });
const STAGES = { received: '接收', access: '权限', context: '上下文', judgment: '接话判断', turn: '宿主回合', tool: '工具', send: '发送', delivery: '回执', terminal: '终态' };
export function downloadTraceJson(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'qq-diagnostics.json';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // The browser consumes the object URL asynchronously after click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TracePanel({ status, disabled, onChange, onList, onDetail, onExport, download = downloadTraceJson }) {
  const [page, setPage] = React.useState(null), [filter, setFilter] = React.useState('');
  const [detail, setDetail] = React.useState(null), [error, setError] = React.useState(null), [working, setWorking] = React.useState(false);
  const run = async fn => { setWorking(true); setError(null); try { await fn(); } catch (cause) { setError(cause.message); } finally { setWorking(false); } };
  const load = async offset => { setPage(await onList({ offset, ...(filter ? { result: filter } : {}) })); setDetail(null); };
  return h('fieldset', { className: 'dqq-sendControl', disabled: Boolean(disabled) || working },
    h('legend', null, '逐条消息轨迹'),
    h('p', null, '只记录阶段、结果、耗时和脱敏标识；不记录聊天正文、提示词、工具参数或凭据。默认关闭，仅内存保留，重启清空。'),
    h('label', null, '采集消息轨迹', h('select', { 'aria-label': '采集消息轨迹', value: status?.enabled ? 'on' : 'off', onChange: event => run(() => onChange(event.target.value === 'on')) }, h('option', { value: 'off' }, '关闭'), h('option', { value: 'on' }, '启用'))),
    h('p', null, '最多 256 条、每条 64 个事件、保留 24 小时；关闭后停止采集，已有记录仍可查看。'),
    h('p', null, '保留记录：', status?.retained ?? 0, '；已淘汰：', status?.evicted ?? 0, '；事件截断：', status?.droppedEvents ?? 0),
    h('label', null, '结果筛选', h('select', { value: filter, onChange: event => { setFilter(event.target.value); setPage(null); setDetail(null); } },
      h('option', { value: '' }, '全部结果'), ...['failed', 'unknown', 'sent', 'waiting', 'declined', 'busy-dropped', 'coalesced', 'image-timeout-dropped', 'access-denied'].map(value => h('option', { key: value, value }, t(LABELS[value]))))),
    h('button', { type: 'button', onClick: () => run(() => load(0)) }, '查看／刷新轨迹'),
    h('button', { type: 'button', onClick: () => run(async () => download(await onExport())) }, '导出脱敏诊断 JSON'),
    h('p', null, '导出最多最近 50 条；不包含配置、日志或消息内容。尚未采集时也可导出空诊断。'),
    page ? h('div', null,
      page.items.length ? h('ul', null, ...page.items.map(row => h('li', { key: row.id },
        h('span', null, new Date(row.startedAt).toLocaleString(), ' · ', row.id, ' · ', t(LABELS[row.outcome] ?? row.outcome), ' · ', `${Math.max(0, (row.endedAt ?? row.updatedAt) - row.startedAt)} ms`),
        h('button', { type: 'button', onClick: () => run(async () => { const value = await onDetail(row.id); if (!value) throw new Error(t('轨迹已过期或已淘汰。')); setDetail(value); }) }, '查看时间线')))) : h('p', null, '没有匹配的轨迹。'),
      h('button', { type: 'button', disabled: page.nextOffset === null, onClick: () => run(() => load(page.nextOffset)) }, '下一页')) : null,
    detail ? h('div', null, h('strong', null, detail.id),
      h('ol', null, ...detail.events.map((event, index) => h('li', { key: index },
        h('span', null, `${event.elapsedMs} ms · `, t(STAGES[event.stage]), ' · ', t(LABELS[event.result] ?? event.result)),
        event.sessionHash ? h('code', null, ` Session ${event.sessionHash}`) : null,
        event.turnHash ? h('code', null, ` Turn ${event.turnHash}`) : null,
        event.toolHash ? h('code', null, ` Tool ${event.toolHash}`) : null))),
      detail.droppedEvents ? h('p', { role: 'status' }, '部分事件已截断，请参考最终阶段。') : null) : null,
    error ? h('p', { role: 'alert' }, error) : null);
}
