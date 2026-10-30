import { outboundArtifactRegistry } from '../../../../src/channels/shared/semantic/artifact.mjs';
import { resolveIdiomReading } from './idiom-reading.mjs';
import { chooseIdiomQuestion } from './idiom-question.mjs';

/** Local rule replies use DSH's stream seam so the actual user/assistant pair
 * remains in the original Session. Only the channel's exact current plain-text
 * input is eligible, never text extracted from history, quotes or images.
 */
export function installQqIdiomFastReplies(ctx, game, { registry = outboundArtifactRegistry, resolveReading, chooseQuestion } = {}) {
  if (typeof ctx.on !== 'function') return false;
  const leases = new Map();
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const id = agent.session.id;
    const previous = leases.get(id);
    registry.observeClaimedMessage(agent.session, message, turn);
    const context = registry.activeDeliveryContext(agent.session);
    // Racing steering changes the admitted batch: let the model interpret it.
    if (previous?.turn === turn) { previous.disabled = true; return; }
    leases.delete(id);
    if (context?.channel !== 'qq' || typeof context.idiomInput !== 'string') return;
    leases.set(id, { agent, turn, context, text: context.idiomInput, callId: `qq-local-idiom:${message.source.rpcId}`, step: null, disabled: false });
  }, { global: true });
  ctx.on('agent/request', async ({ agent, step }, next) => {
    const lease = leases.get(agent.session.id);
    if (lease?.agent === agent) {
      if (lease.step !== null && lease.step !== step) lease.disabled = true;
      lease.step = step;
    }
    return next();
  });
  ctx.on('llm/stream', (options, next) => (async function* () {
    const lease = leases.get(options.sessionId);
    if (!options.purpose && lease && !lease.disabled
      && registry.activeDeliveryContext(lease.agent.session) === lease.context) {
      // A retry of this admitted request reuses the same committed receipt.
      lease.result ??= game.fastReply(lease.text, { agent: lease.agent, callId: lease.callId, signal: options.signal }, {
        resolveReading: word => resolveReading ? resolveReading(word, options) : resolveIdiomReading(ctx.get('llm'), word, options),
        chooseQuestion: settings => chooseQuestion ? chooseQuestion(settings, options) : chooseIdiomQuestion(ctx.get('llm'), settings, options),
      });
      const reply = await lease.result;
      options.signal?.throwIfAborted();
      if (reply) {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: reply.text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } };
        if (!reply.readingRequested) yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
        else if (reply.usage) yield { type: 'usage', usage: reply.usage };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      lease.disabled = true;
    }
    yield* next();
  })());
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && leases.get(session.id)?.turn === event.data.turn) leases.delete(session.id);
  });
  ctx.on('agent/disposed', ({ agent }) => { if (leases.get(agent.session.id)?.agent === agent) leases.delete(agent.session.id); });
  ctx.effect?.(() => () => leases.clear(), 'dsh-im: local QQ idiom replies');
  return true;
}
