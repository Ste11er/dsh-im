import { outboundArtifactRegistry } from '../../../../src/channels/shared/semantic/artifact.mjs';
export function installQqCapabilitiesContext(ctx, { registry = outboundArtifactRegistry } = {}) {
  if (typeof ctx?.systemPrompt?.context !== 'function') return false;
  ctx.systemPrompt.context({ name: 'dsh-im:qq-capabilities', order: 113, text: assembly => {
    const delivery = registry.activeDeliveryContext(assembly?.agent?.session);
    if (delivery?.channel !== 'qq' || !delivery.qqCapabilities) return '';
    return '当前 QQ 运行时功能事实（本轮开始时快照，优先于仓库历史规划；计数仅覆盖本机器人当前进程）：\n'
      + JSON.stringify(delivery.qqCapabilities)
      + '\n本版本已经实现未 @ 自主接话。enabled 表示配置开启，不等于已收到平台全量消息或已发送成功。只有 replied 计数表示已成功接话；零候选/无近期消息不能推断模型决定沉默。不要把 P2′ 历史规划说成当前功能缺失；无法从这些数据确定时明确说需要查实际到达/错误记录。';
  } });
  return true;
}
