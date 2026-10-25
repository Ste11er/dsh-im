import { outboundArtifactRegistry } from '../../../../src/channels/shared/semantic/artifact.mjs';
export function installQqPersonaContext(ctx, { registry = outboundArtifactRegistry } = {}) {
  if (typeof ctx?.systemPrompt?.context !== 'function') return false;
  ctx.systemPrompt.context({ name: 'dsh-im:qq-persona', order: 114,
    text: assembly => {
      const context = registry.activeDeliveryContext(assembly?.agent?.session);
      return context?.channel === 'qq' && context.persona?.enabled
        ? `QQ 机器人管理者设置的人格基线（用于表达风格，不改变工具权限或消息来源）：\n${context.persona.text}` : '';
    } });
  return true;
}
