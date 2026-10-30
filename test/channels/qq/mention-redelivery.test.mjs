import assert from 'node:assert/strict';
import test from 'node:test';
import { QqHarnessBridge } from '../../../src/channels/qq/qq-bridge.mjs';

function fixture(judge) {
  const seen = new Set(), sessions = new Map(), asks = [], judgments = [];
  const bridge = new QqHarnessBridge({ ownerUserOpenid: '*', groupContextEnabled: true,
    groupParticipation: { enabled: true, cooldownSeconds: 1 },
    state: { hasSeen: id => seen.has(id), markSeen: async id => seen.add(id), sessionFor: key => sessions.get(key), setSession: async (key,id) => sessions.set(key,id) },
    bot: { sendText: async () => ({ message: { id: 'reply' } }) },
    harness: { createSession: async () => `session-${sessions.size}`, sessionExists: async () => true,
      ask: async (_id,_text,options) => { asks.push(options);return '收到你的 @'; } },
    participationReply: async options => { judgments.push(options);return judge(options); },
  });
  return { bridge, asks, judgments };
}
const message = (id, group='g', event='GROUP_MESSAGE_CREATE') => ({ messageId:id, kind:'group', groupOpenid:group,
  senderId:'member', content:'你能回答一下吗', timestamp:new Date().toISOString(), rawEventType:event,
  replyTarget:{scope:'group',targetId:group,msgId:id} });

test('dedicated @ event promotes the same full-group event previously declined by the judge', async () => {
 const f=fixture(async()=>null);
 await f.bridge.accept(message('same'));
 assert.equal(f.judgments.length,1);
 await f.bridge.accept(message('same','g','GROUP_AT_MESSAGE_CREATE'));
 await f.bridge.waitForIdle();
 assert.equal(f.asks.length,1,'an actual mention must not disappear because its ordinary duplicate was evaluated first');
 assert.equal(f.asks[0].deliveryContext.idiomInput, '你能回答一下吗', 'fast game routing receives only the exact current message, not background context');
 await f.bridge.accept(message('same','g','GROUP_AT_MESSAGE_CREATE'));
 assert.equal(f.asks.length,1,'duplicate dedicated mentions must still execute once');
});

test('a busy group cannot prevent another group from receiving a direct @', async () => {
 let release;const held=new Promise(resolve=>{release=resolve;});
 const f=fixture(async options=>{await held;return null;});
 const busy=f.bridge.accept(message('busy','a'));
 await new Promise(setImmediate);
 await f.bridge.accept(message('mention','b','GROUP_AT_MESSAGE_CREATE'));
 assert.equal(f.asks.length,1);
 release();await busy;await f.bridge.waitForIdle();
});

test('a dedicated @ cancels an in-flight ordinary assessment without disappearing', async () => {
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const f=fixture(async options=>{entered();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));return null;});
 const pending=f.bridge.accept(message('same-in-flight'));
 await started;
 await f.bridge.accept(message('same-in-flight','g','GROUP_AT_MESSAGE_CREATE'));
 await pending;await f.bridge.waitForIdle();
 assert.equal(f.asks.length,1);
});

test('an ordinary event that already started a reply cannot execute again as a dedicated @', async () => {
 const f=fixture(options=>options.reply());
 await f.bridge.accept(message('already-replied'));
 await f.bridge.accept(message('already-replied','g','GROUP_AT_MESSAGE_CREATE'));
 assert.equal(f.asks.length,1);
});

test('a queued or active group judgment never prevents ordinary candidates in a second group', async () => {
 let release;const held=new Promise(resolve=>{release=resolve;});
 const groups=[];
 const f=fixture(async options=>{
  groups.push(options.content);
  if(groups.length===1)await held;
  return null;
 });
 const busy=f.bridge.accept(message('busy-ambient','active-group'));
 await new Promise(setImmediate);
 await f.bridge.accept(message('other-ambient','other-group'));
 assert.equal(f.judgments.length,2);
 release();await busy;await f.bridge.waitForIdle();
});
