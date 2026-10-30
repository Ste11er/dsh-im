import { outboundArtifactRegistry } from '../../../../src/channels/shared/semantic/artifact.mjs';
import { qqFamiliarityText } from '../../../../src/channels/qq/familiarity-context.mjs';

export function installQqFamiliarityContext(ctx, { registry = outboundArtifactRegistry } = {}) {
  if (typeof ctx?.systemPrompt?.context !== 'function') return false;
  ctx.systemPrompt.context({ name: 'dsh-im:qq-familiarity', order: 115,
    text: assembly => {
      const context = registry.activeDeliveryContext(assembly?.agent?.session);
      const state = context?.channel === 'qq' ? context.familiarity : null;
      return qqFamiliarityText(state);
    } });
  return true;
}
