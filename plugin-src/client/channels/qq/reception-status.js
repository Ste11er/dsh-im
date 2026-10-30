import { h } from '../../i18n.js';

const STAGES = {
  duplicate: '同一消息已处理，忽略重复推送', 'access-denied': '本地访问策略拒绝', 'context-off': '短期群聊上下文未启用',
  'busy-dropped': '本群正在回复，按设置丢弃新消息', 'ambient-recorded': '普通消息已进入背景',
  assessing: '正在判断是否接话', waiting: '模型决定继续听后文', declined: '模型决定保持安静',
  'reply-started': '实际回复已开始', replied: 'QQ 已接受回复', 'mention-accepted': '已识别 @ 并进入处理',
  'image-timeout-dropped': '图片下载超时，已丢弃本条处理',
};
export function GroupReceptionStatus({ groups = [] }) {
  return h('div', { className: 'dqq-sendControl' },
    h('strong', null, '各群消息接收诊断'),
    h('p', null, '统计从本次连接启动后开始，群标识尾号不是 QQ 群号。普通消息未到达时，不能仅凭本地接话开关推断已获得全量消息权限。'),
    groups.length ? h('ul', null, ...groups.map(row => h('li', { key: row.id },
      h('span', null, row.label, ' · 平台推送 @：', row.gatewayMentions, '，普通：', row.gatewayOrdinary,
        ' · 本地识别 @：', row.processedMentions, '，普通：', row.processedOrdinary),
      h('p', null, '最近处理：', STAGES[row.lastDecision] ?? '等待消息'),
      row.gatewayMentions > 0 && !row.ordinaryObserved ? h('p', { role: 'status' }, '本次启动只观察到 @ 事件，尚未收到此群普通消息；请由群主在手机 QQ 的“群聊设置 → 群机器人 → 当前机器人 → 管理”中检查“机器人可获取的群聊消息范围”，选择“获取群内全部消息”。每个群需分别设置，保存后发送一条不 @ 的消息核对普通事件计数。') : null)))
      : h('p', null, '本次连接尚未观察到群消息。'));
}
