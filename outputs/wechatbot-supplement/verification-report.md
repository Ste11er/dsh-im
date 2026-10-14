# 验收报告：微信个人号群聊补充目标与计划

> 由独立验收执行者产出。本文件是本轮验收**唯一**新建的文件。

## 0. 验收对象与验收者声明

- 验收对象：`docs/方案/微信个人号群聊补充目标与计划.md`（302 行，仓库内状态为未跟踪 `??`）。
- 验收者：独立验收执行者（本会话），**未参与**该文档的写作、装配、路径引用或任何一次修订；本文所有结论仅来自本次实际执行的命令与读取的文件内容。
- 验收标准：`links-resolve`、`no-implemented-claims`、`repo-green` 三项，逐条独立给结论。
- 环境：Node `v22.22.1`、npm `9.2.0`，工作目录 `/home/stella/Project/dsh-im/dsh-im`。
- 约束遵守：未修改被验收文档；未修改仓库任何其他文件（验收前后 `git status --porcelain` 均为 `?? docs/方案/微信个人号群聊补充目标与计划.md` 与 `?? outputs/`，无新增跟踪改动）；只新建本报告一个文件。

> **汇总：三项结论 = `links-resolve: passing`、`no-implemented-claims: passing`、`repo-green: failing`。**
> 即：文档作为"计划/决策文档"在链接可解析性与"不冒充已实现"两项上合格；但当前工作区的质量门 `npm run check` **真实失败**（退出码 1，依赖未安装），且文档存在 2 处行号偏 1 的精度问题。

---

## 1. 标准一 `links-resolve`

### 1.1 结论：`passing`

- 文档内全部 5 个 Markdown 相对链接均可解析到真实文件（0 缺失）。
- 文档内全部反引号包裹的仓库相对路径（存在的文件）均可解析；未解析的仅有**明确标注为"建议新增/待产出"的路径**（`src/channels/shared/send-control.mjs`、`src/channels/wechat-personal/*` 等）与**非文件 token**（`/stop`、`/c2c/`、`wangrongding/wechat-bot`、`p2p:${userId}` 等），不算断链。
- 额外行号抽查：共打印核对 **40+ 处**带行号引用（远超要求的 12 处），其中 **2 处行号偏 1**（结论文字本身正确）、**1 处引用落在注释行**（支撑较弱）。属文档精度问题，不影响"链接可解析"这一判定。

### 1.2 Markdown 链接完整清单（按文档目录 `docs/方案/` 解析）

| # | 文档位置 | target | 解析后路径 | 存在性 |
| --- | --- | --- | --- | --- |
| 1 | 第 297 行 | `../../PROACTIVE_DELIVERY.md` | `/home/stella/Project/dsh-im/dsh-im/PROACTIVE_DELIVERY.md` | ✅ 存在 |
| 2 | 第 298 行 | `../../docs/adr/0001-semantic-core-native-channel-adapters.md` | `/home/stella/Project/dsh-im/dsh-im/docs/adr/0001-semantic-core-native-channel-adapters.md` | ✅ 存在 |
| 3 | 第 299 行 | `渠道原生能力建设方案.md` | `/home/stella/Project/dsh-im/dsh-im/docs/方案/渠道原生能力建设方案.md` | ✅ 存在 |
| 4 | 第 300 行 | `../../README.md` | `/home/stella/Project/dsh-im/dsh-im/README.md` | ✅ 存在 |
| 5 | 第 301 行 | `../access-modes.md` | `/home/stella/Project/dsh-im/dsh-im/docs/access-modes.md` | ✅ 存在 |

校验命令（逐条 `[ -f ]` 判定，输出 EXISTS/MISSING）：

```bash
for t in "../../PROACTIVE_DELIVERY.md" \
         "../../docs/adr/0001-semantic-core-native-channel-adapters.md" \
         "渠道原生能力建设方案.md" "../../README.md" "../access-modes.md"; do
  p="docs/方案/$t"; [ -f "$p" ] && echo "EXISTS  $t" || echo "MISSING $t"
done
# 实测输出：5 行全部 EXISTS
```

### 1.3 反引号仓库相对路径校验

对文档中所有形如 `path`、`path:line` 的反引号片段做程序化提取（46 个候选），对带 `/` 的用 `[ -e ]`、对裸文件名用 `find src plugin-src docs test scripts -name` 解析。**所有指向现存文件的路径均解析成功**；未解析项分类如下：

| 未解析 token | 文档位置 | 分类 | 判定 |
| --- | --- | --- | --- |
| `src/channels/shared/send-control.mjs` | 第 131 行 | 文中标注"建议新增共享模块（建议名）" | 预期不存在，合规 |
| `src/channels/wechat-personal/*` | 第 193 行 | WG-09 规划新增目录 | 预期不存在，合规 |
| `plugin-src/host/channels/wechat-personal/*` | 第 193 行 | WG-09 规划新增目录 | 预期不存在，合规 |
| `plugin-src/client/channels/wechat-personal/*` | 第 193 行 | WG-09 规划新增目录 | 预期不存在，合规 |
| `test/channels/wechat-personal/*.test.mjs` | 第 221 行 | WG-13 规划新增测试 | 预期不存在，合规 |
| `docs/方案/微信个人号接入风险与停用.md` | 第 214 行 | WG-12"建议新增"文档 | 预期不存在，合规 |
| `config-store.mjs` | 第 207 行 | WG-11 新渠道待建文件 | 预期不存在，合规 |
| `controls-spec.md` / `goals-backlog.md` | 第 87、302 行 | 本 run 工作底稿，实际位于 `outputs/wechatbot-supplement/` | ✅ 实际存在（见下） |
| `/stop`、`/c2c/` | 第 54、94、119 行等 | 命令/URL 片段，非文件路径 | 非链接，排除 |
| `wangrongding/wechat-bot` | 第 37 行 | 外部 GitHub 仓库名 | 非本仓库路径，排除 |
| `src/`、`plugin-src/` | 第 4 行 | 目录 | ✅ 存在 |

工作产物存在性实测：

```bash
for f in outputs/wechatbot-supplement/impact-analysis.md \
         outputs/wechatbot-supplement/controls-spec.md \
         outputs/wechatbot-supplement/goals-backlog.md \
         outputs/wechatbot-supplement/spike-report.md; do
  [ -f "$f" ] && echo "EXISTS $f" || echo "ABSENT(planned) $f"
done
# 实测：impact-analysis.md / controls-spec.md / goals-backlog.md 存在；
#       spike-report.md 不存在（WG-08 建议产出，合规）
```

### 1.4 外部绝对路径（单独说明，不在本仓库内）

| 文档位置 | 绝对路径 | 说明 |
| --- | --- | --- |
| 第 12 行 | `/home/stella/Project/wechatbot/md/` | **外部路径，不在本仓库内**（主机上目录存在，但位于仓库外，无法用仓库内相对路径校验，本报告不计入 links-resolve） |
| 第 35 行 | `/home/stella/Project/wechatbot/md/` | 同上 |

文档自身在第 35 行明确将其标注为"**外部调研**"，口径正确。文档**无任何 `http(s)://` 链接**，也**无锚点链接**（`grep -n 'http'` 无匹配）。

### 1.5 行号抽查表（打印内容 vs 引用）

抽查命令统一为 `sed -n '<n>p' <file>`；"一致性"以文档该处**引用内容/论断**与打印行是否对应为准。

| # | 文档位置 | 引用 | 打印内容（±空白） | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 第 67、158 行 | `src/channels/weixin/state-store.mjs:14` | `recentOutboundMessages: [],` | ✅ 一致 |
| 2 | 第 67、158 行 | `src/channels/weixin/state-store.mjs:17`（上限 200） | `export const WEIXIN_RECENT_OUTBOUND_LIMIT = 200;` | ✅ 一致 |
| 3 | 第 67、158 行 | `src/channels/weixin/state-store.mjs:18`（TTL 30 天） | `export const WEIXIN_RECENT_OUTBOUND_TTL_MS = 30 * 24 * 60 * 60 * 1_000;` | ✅ 一致 |
| 4 | 第 67、158 行 | `src/channels/weixin/state-store.mjs:19`（单条 8,000） | `export const WEIXIN_RECENT_OUTBOUND_TEXT_LIMIT = 8_000;` | ✅ 一致 |
| 5 | 第 131 行 | `src/channels/shared/text-harness-bridge.mjs:652` | `sendProactiveText(target, text, { signal, format = 'plain' } = {}) {` | ✅ 一致 |
| 6 | 第 120 行 | `src/channels/shared/deferred-delivery.mjs:157`（`attempts >= 3` 即 failed） | `await store.patchDeferred(entry.id, { attempts, status: attempts >= 3 ? 'failed' : 'pending' });` | ✅ 一致 |
| 7 | 第 122 行 | `src/channels/shared/harness-approval.mjs:23`（默认 60 分钟） | `const APPROVAL_TIMEOUT_UNCONFIRMED_TEXT = '审批已超时，正在自动拒绝，但暂未得到确认，稍后会自动重试。';` | ⚠️ **行号不一致**：60 分钟常量在 **:24** `const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;`；:23 只是相邻的超时文案常量。论断正确、行号偏 1 |
| 8 | 第 69、229 行 | `src/channels/wecom/wecom-bridge.mjs:129`（`group:${chatid}`） | `return body.chattype === 'group' ? \`group:${body.chatid}\` : \`direct:${body.from?.userid}\`;` | ✅ 一致 |
| 9 | 第 70、229 行 | `src/channels/wecom-app/wecom-app-bridge.mjs:281`（硬编码 direct） | `conversationType: 'direct',` | ✅ 一致 |
| 10 | 第 51 行 | `src/channels/weixin/weixin-runtime.mjs:409` | `if (target?.kind !== 'user' \|\| !toUserId) {` | ✅ 一致（与文档引文逐字对应） |
| 11 | 第 131 行 | `src/channels/weixin/weixin-runtime.mjs:406` | `async sendProactiveText(target, text, { signal, format = 'plain' } = {}) {` | ✅ 一致 |
| 12 | 第 52 行 | `src/channels/weixin/weixin-bridge.mjs:123`（`p2p:${userId}`） | `function conversationKey(userId) {` | ⚠️ **行号不一致**：`return \`p2p:${userId}\`;` 在 **:124**；:123 是函数声明。论断正确、行号偏 1 |
| 13 | 第 53 行 | `src/channels/weixin/weixin-bridge.mjs:393`（入站强制 direct） | `conversationType: 'direct',` | ✅ 一致 |
| 14 | 第 159 行 | `src/channels/weixin/weixin-bridge.mjs:215`（`recentOutboundTextFor`） | `resolveContent: (reference) => state?.recentOutboundTextFor?.({` | ✅ 一致 |
| 15 | 第 131 行 | `src/channels/weixin/weixin-bridge.mjs:679` | `await this.#send(sender, t(COMMAND_PERMISSION_DENIED_MESSAGE), contextToken, runId);` | ✅ 一致（确为发送出口） |
| 16 | 第 131 行 | `src/channels/weixin/weixin-bridge.mjs:700` | `await this.#send(entry.target.toUserId, deferredOutcomeText(outcome), undefined, undefined, { stopTyping: false });` | ✅ 一致（延迟补发出口） |
| 17 | 第 131 行 | `src/channels/weixin/weixin-bridge.mjs:771` | `await this.#send(sender, reply, contextToken, runId);` | ✅ 一致（发送出口） |
| 18 | 第 131 行 | `src/channels/weixin/weixin-bridge.mjs:804` | `await this.#send(sender, t('目前支持文字、图片、文件，以及微信已转成文字的语音消息。'), contextToken, runId);` | ✅ 一致（发送出口） |
| 19 | 第 54 行 | `src/channels/weixin/weixin-api.mjs:14` | `export const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';` | ✅ 一致 |
| 20 | 第 54 行 | `src/channels/weixin/weixin-api.mjs:174` | `\|\| (url.port && url.port !== '443') \|\| !url.pathname.startsWith('/c2c/')) {` | ✅ 一致 |
| 21 | 第 54 行 | `src/channels/weixin/weixin-api.mjs:326` | `\|\| (url.port && url.port !== '443') \|\| url.pathname !== '/c2c/upload'` | ✅ 一致 |
| 22 | 第 58 行 | `src/channels/shared/access-policy.mjs:140` | `export const DEFAULT_ACCESS_POLICY = Object.freeze({`（下两行 `direct/group: DENY_SCOPE`） | ✅ 一致（每机器人访问策略） |
| 23 | 第 60 行 | `src/channels/shared/access-policy.mjs:3` | `export const ACCESS_POLICY_CONVERSATION_TYPES = Object.freeze(['direct', 'group']);` | ✅ 一致 |
| 24 | 第 60 行 | `src/channels/shared/text-harness-bridge.mjs:255`（未 @ 群消息默认拒绝） | `if (kind === 'group' && normalized.addressed !== true) {` | ✅ 一致 |
| 25 | 第 59 行 | `src/channels/shared/text-harness-bridge.mjs:322`（会话键 `kind:conversationId`） | ``const key = `${normalized.kind}:${normalized.conversationId}`;`` | ✅ 一致 |
| 26 | 第 60 行 | `src/channels/shared/text-harness-bridge.mjs:918`（`requiresMention`） | `requiresMention: message.kind === 'group' && message.requiresMention !== false,` | ✅ 一致 |
| 27 | 第 60 行 | `src/channels/shared/context-enhancement.mjs:50`（群上下文增强） | `const CONFIG_KEYS = ['group', 'direct'];` | ✅ 一致 |
| 28 | 第 61、121 行 | `src/channels/shared/deferred-delivery-coordinator.mjs:172`（未知结果不自动重试） | `await state.patchDeferred(id, { status: 'failed', deliveryOutcome: 'unknown', attempts: (current.attempts ?? 0) + 1 });` | ✅ 一致 |
| 29 | 第 62、151 行 | `src/channels/shared/conversation-state-store.mjs:13`（共享存储形状） | `const EMPTY_STATE = Object.freeze({ version: 1, sessions: {}, seenMessageIds: [], cursor: null });` | ✅ 一致（与文档所列形状逐字相符） |
| 30 | 第 63 行 | `src/channels/email/transports/agent-mail.mjs:105,133`（仅读取平台声明） | `:105 rateLimits: normalizeRateLimits(document?.data?.rate_limits),`；`:133 dailySendQuota: positive('daily_send_quota', 'per_day'),` | ✅ 一致 |
| 31 | 第 63 行 | `src/channels/email/email-runtime.mjs:29`（只管读取轮询） | `* producing an absurdly long interval.`（属于 `pollIntervalForLimits` 的文档注释，见 :21–31） | ⚠️ 支撑偏弱：:29 是注释行，只能间接支撑"轮询"，不含发送预算逻辑；建议改引 `:21-31` 或 `:31` |
| 32 | 第 66 行 | `src/channels/whatsapp/whatsapp-runtime.mjs:695` | `if (sendPaused) await this.#socket.sendPresenceUpdate('paused', jid).catch(() => undefined);` | ✅ 一致 |
| 33 | 第 200 行 | `src/channels/whatsapp/whatsapp-runtime.mjs:321`（判群） | `const group = remoteJid.endsWith('@g.us');` | ✅ 一致 |
| 34 | 第 200 行 | `src/channels/whatsapp/whatsapp-runtime.mjs:355`（`addressed`） | `addressed: !group \|\| fromMe \|\| mentioned \|\| replyToSelf,` | ✅ 一致 |
| 35 | 第 206 行 | `src/channels/whatsapp/whatsapp-web-session.mjs:7,74,161`（扫码登录为默认流程） | `:7 useMultiFileAuthState,`；`:74 loadAuthState = useMultiFileAuthState,`；`:161 if (typeof update.qr === 'string' && update.qr) onQr(update.qr);` | ✅ 一致（QR/鉴权状态） |
| 36 | 第 229 行 | `src/channels/wecom/wecom-bridge.mjs:151`（保留触发 @ 前缀） | `// Group callbacks retain the leading @bot mention that caused delivery.` | ✅ 一致 |
| 37 | 第 69、229 行 | `src/channels/wecom/wecom-bridge.mjs:758-761`（`chattype === 'group'` 处理） | `:758 const chattype = body.chattype ?? (body.chatid ? 'group' : 'single');` … `:761 const chatId = chattype === 'group' ? body.chatid : senderId;` | ✅ 一致 |
| 38 | 第 229 行 | `src/channels/wecom/wecom-bridge.mjs:1021`（`addressed: true`） | `addressed: true,` | ✅ 一致 |
| 39 | 第 183 行 | `src/channels/feishu/multi-bot-controller.mjs:611`（唯一能力数组，飞书专用） | `capabilities: ['proactive-text-checked', 'proactive-receipt-checked', 'exclusive-text-consumer', 'reply-text-checked', 'history-text-checked', 'thread-history-text-checked'] };` | ✅ 一致 |
| 40 | 第 169、193 行 | `plugin-src/host/index.mjs:67`（渠道表） | `const channels = [`（:68 起为 `['feishu', …]` 列表） | ✅ 一致 |
| 41 | 第 193 行 | `plugin-src/client/index.js:102` | `const CHANNELS = Object.freeze([` | ✅ 一致 |
| 42 | 第 145、193 行 | `plugin-src/client/delivery-settings.js:46`（`weixin:` 条目） | `weixin: {` | ✅ 一致 |
| 43 | 第 193 行 | `plugin-src/host/delivery-adapter.mjs:7` | `const CHANNELS = new Set([` | ✅ 一致（注册点） |
| 44 | 第 193 行 | `plugin-src/host/delivery-suggestions.mjs:1` | `const CHANNELS = new Set([` | ✅ 一致 |
| 45 | 第 193 行 | `src/channels/shared/diagnostic-details.mjs:92` | `export const DIAGNOSTIC_CHANNELS = Object.freeze(['weixin', 'feishu', … 13 项]);` | ✅ 一致 |
| 46 | 第 193 行 | `src/channels/shared/harness-approval.mjs:14` | `'feishu', 'weixin', 'dingtalk', 'wecom', 'wecom-app', 'qq',` | ✅ 一致 |
| 47 | 第 193 行 | `src/channels/shared/session-channel-labels.mjs:2` | `weixin: ['微信', 'WeChat'],` | ✅ 一致 |
| 48 | 第 193 行 | `src/channels/shared/command-catalog.mjs:25` | `export const SHARED_COMMAND_CATALOG = Object.freeze([` | ✅ 一致 |
| 49 | 第 193 行 | `plugin-src/client/channel-logos.js:15` | `'data-im-channel-logo': 'weixin',` | ✅ 一致 |
| 50 | 第 193 行 | `plugin-src/client/access-policy-settings.js:11` | `const CONFIRMED_OWNER_CHANNELS = new Set(['weixin', 'feishu', 'qq', 'whatsapp', 'discord']);` | ✅ 一致 |
| 51 | 第 193 行 | `plugin-src/client/session-channel-logos.js:9` | `weixin: [WeixinLogoGlyph, '#07c160'],` | ✅ 一致 |
| 52 | 第 192 行 | `plugin-src/host/channels/shared/access-policy-production.mjs:48` | `export function initialAccessPolicyFor(channel, config = {}) {` | ✅ 一致 |
| 53 | 第 192 行 | `plugin-src/host/channels/shared/access-policy-production.mjs:97`（对未知渠道抛错） | `throw new TypeError(\`Unsupported access-policy channel: ${channel}\`);` | ✅ 一致 |
| 54 | 第 58 行 | `plugin-src/host/channels/shared/access-policy-production.mjs:113-115`（owner 特权） | `:113 export function privilegedSenderIdsFor(channel, config = {}) {`；`:115 if (key === 'weixin') return cleanIds(config.ownerUserId);` | ✅ 一致 |
| 55 | 第 55 行 | `docs/上下文增强.md:3`（「微信当前只支持私聊」） | 该行末尾为 `微信当前只支持私聊。` | ✅ 一致 |
| 56 | 第 56 行 | `docs/方案/渠道原生能力建设方案.md:692`（iLink 消息项仅文字/图片/语音/文件/视频） | `\| 微信 \| **当前协议不支持原生控件**：iLink 消息项只有文字、图片、语音、文件和视频等内容类型 \| …` | ✅ 一致 |
| 57 | 第 61 行 | `PROACTIVE_DELIVERY.md:319`（不自动重试） | `- DSH-IM 不保存主动投递历史，不生成 \`deliveryHandle\` 或 \`idempotencyKey\`，也不自动重试。` | ✅ 一致 |
| 58 | 第 68 行 | `PROACTIVE_DELIVERY.md:324-326`（主动投递需 `context_token`） | :324 `微信主动投递…使用…context_token…`；:325 iLink 服务端规则约束；:326 1,800 字符分段 | ✅ 一致 |
| 59 | 第 123 行 | `PROACTIVE_DELIVERY.md:325` | `- 微信是否接受发送仍受 iLink 服务端规则约束。…` | ✅ 一致 |
| 60 | 第 30、220 行 | `package.json:99-103`（`build`→`node --test`→`scripts/verify-package.mjs`；无 lint/typecheck） | `:99 "scripts": {`、`:100 "build": …`、`:101 "test": "node --test …"`、`:102 "check": "npm run build && npm test && node scripts/verify-package.mjs"`、`:104 "engines": {` | ✅ 一致（:99–102 覆盖三阶段；无 lint/typecheck 属实） |

**抽查小结**：60 处行号引用中，**57 处完全一致**，**2 处行号偏 1**（第 7、12 项），**1 处引用为注释行、支撑偏弱**（第 31 项）。被点名要求重点复核的 `state-store.mjs:14/:17/:18/:19`、`text-harness-bridge.mjs:652`、`deferred-delivery.mjs:157`、`wecom-bridge.mjs:129`、`wecom-app-bridge.mjs:281` **全部一致**；`harness-approval.mjs:23` **行号偏 1**（论断正确）。

---

## 2. 标准二 `no-implemented-claims`

### 2.1 结论：`passing`

文档头部有明确声明，全文在三大重点领域（个人微信群能力、P2 未 @ 接话、五项控制）**均未把未实现能力写成已实现**；P2 只有证据门槛、无 `WG-` 编号条目、无 `shouldParticipate` 设计草案；未发现硬性自相矛盾。

### 2.2 头部"计划/决策文档"声明（原文）

文档第 3–6 行：

> **状态声明**：本文是**计划与决策文档**，不是已实现能力清单。
> 文中的「改动位置」「验收方式」都是后续落地清单，**当前仓库没有任何一项已实现**；引用 `src/`、`plugin-src/` 的路径与行号只用于说明现状与落点。
> 本文由 Vibe run `vibe-linux-6bb9bad8c72b4ade` 产出（工作底稿见 `outputs/wechatbot-supplement/`）。
> 结论口径：凡未从仓库证据或真实实测确认的，一律标 `未核验`，不得当作已确认。

另第 25 行"不交付"栏明确写有"任何'能力已具备'的声明"。**声明充分，位置正确（文档头部）。**

### 2.3 三大重点领域逐项结论

| 领域 | 文档口径 | 关键证据句（原文） | 结论 |
| --- | --- | --- | --- |
| 个人微信渠道**群能力** | 明确"完全未覆盖" | 第 18 行：「dsh-im 的「微信」渠道是…**只支持点对点私聊，群能力为零**，且不是"开关未打开"而是"协议层没有"」；第 50–57 行差距矩阵多处标 ❌（无群概念、无群 ID、无入群事件、无 mention 字段） | ✅ 未冒充已实现 |
| **P2 未 @ 低频自主接话** | 明确"不承诺目标" | 第 81 行：P2 交付物写「**无交付物、无 backlog 条目**」，退出条件「不设退出条件」；第 83 行：「**P2 是「不承诺目标」**：不为它写设计草案，也不为它排 backlog」 | ✅ 未冒充已实现 |
| **五项控制**（发送预算/限频、安静时段、dry-run、账号级持久暂停、渠道侧原文保留） | 五项均标「**无**」 | 第 63–67 行差距矩阵分别写「**无**」；第 18 行：「它要求的控制类能力（发送预算、安静时段、dry-run、持久暂停、原文不落盘）本仓库也**一项都没有**」 | ✅ 未冒充已实现 |

### 2.4 P2 专项核查（必须只有证据门槛、无 backlog、无设计草案）

- **无 `WG-` 编号条目**：`grep -o 'WG-[0-9]*'` 全量提取结果仅为 `WG-01 … WG-14`。其中 WG-01…05 = P0，WG-06…08 = P1a，WG-09…13 = P1b，WG-14 = 企微降级路径。**没有任何 WG 条目属于 P2**。✅
- **只有证据门槛**：第 245–256 行第 7 节标题即「P2 的证据门槛（**仅门槛，不含设计**）」，给出 6 条门槛（均标 `未核验`/缺失）。✅
- **无 `shouldParticipate` 设计草案**：`shouldParticipate` 全文仅出现 **1 次**，在第 81 行 P2 目标分层表内，作为能力名称括注「未 @ 群消息低频自主接话（`shouldParticipate`）」，**不含触发规则、冷却、概率、上下文裁剪等设计内容**；第 258 行明确「**不写自主接话的设计草案（触发规则、冷却、概率、上下文裁剪一律不谈）**」。✅
- 相关条目也一致地排除了 P2：第 187 行 WG-08 不做项「不在本条目设计接话策略」；第 203 行 WG-10 不做项「不实现未 @ 触发（P2）」；第 266 行全局不做项 5「不把 P2 写成待实现功能或 backlog 条目」。✅

### 2.5 自相矛盾核查

全文搜索"已支持/已实现/已具备/已有/已天然满足/立即可用/支持群"等表述，命中 5 处（第 3、4、25、44、60、68、69、229、232 行），逐条核对：

- 第 3、4、25 行：声明性/否定性表述，不构成"已实现"主张。✅
- 第 44 行「部分条目（接入解耦、统一发送出口、事件去重、稳定 ID、数据范围）在本仓库**已天然满足**」：对应第 61、62 行的 ✅ 证据行，有代码证据（`deferred-delivery-coordinator.mjs:172`、`conversation-state-store.mjs:13`），**非未实现冒充已实现**。✅
- 第 60 行「群语义通用件 **已具备，可直接复用**」：指**共享层**（access-policy 的 `direct`/`group`、text-harness-bridge 群拒绝），不是 weixin 渠道的群能力；证据 `access-policy.mjs:3`、`text-harness-bridge.mjs:255/:918` 均实测一致。✅
- 第 68、69 行：主动推送对**用户**可用（△，不支持群）、`wecom`（企业微信智能机器人）支持群（✅）。二者与第 18 行"**微信**渠道群能力为零"分属 **weixin 与 wecom 两个不同渠道**，第 42、72 行已明确区分，**不构成自相矛盾**（但见问题清单 P6 的可读性建议）。

**未发现"某处说能力存在、另一处说未实现"的硬性矛盾。**

### 2.6 一处需澄清的内部张力（非"未实现写成已实现"，见问题 P5）

第 94 行称 L2 被动回复「仅 dry-run 可观测；暂停、预算、安静时段均不拦」，第 104 行称发送预算「**不拦 L2**」，第 106 行称 dry-run「默认不拦 L2」；但第 131 行 WG-01 把 `weixin-bridge.mjs:679`、`:771`、`:804`（实测均为被动回复的 `#send` 出口）列为"发送预算"的接线点。该处属**设计边界表述不够清晰**，并非把未实现能力写成已实现，故不影响本项 `passing`，仅列入问题清单。

---

## 3. 标准三 `repo-green`

### 3.1 结论：`failing`（真实退出码 1；根因为环境依赖未安装）

### 3.2 命令与环境

- 完整命令：`npm run check`
- 展开链路（来自 `package.json:102`）：`npm run build` → `npm test`（`node --test test/*.test.mjs test/channels/*/*.test.mjs`）→ `node scripts/verify-package.mjs`
- 工作目录：`/home/stella/Project/dsh-im/dsh-im`
- 运行环境：Node `v22.22.1`、npm `9.2.0`
- **退出码：`1`**（由命令尾部 `echo "REAL_EXIT=$?"` 实测捕获）

### 3.3 输出摘要（真实原文节选）

```
> @xmanrui/dsh-im@4.38.1 check
> npm run build && npm test && node scripts/verify-package.mjs

> @xmanrui/dsh-im@4.38.1 build
> node plugin-src/client/build.mjs && node plugin-src/host/build.mjs

node:internal/modules/package_json_reader:314
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'esbuild' imported from /home/stella/Project/dsh-im/dsh-im/plugin-src/client/build.mjs
    at Object.getPackageJSONURL (...)
    ...
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v22.22.1
REAL_EXIT=1 at 15:09:38
```

- 输出中**没有任何通过/失败用例数**：因为在 `build` 阶段即中断，`node --test` 与 `scripts/verify-package.mjs` **均未执行**，故无测试计数、无 `verify-package` 结论。
- error 行：`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'esbuild' imported from …/plugin-src/client/build.mjs`。

### 3.4 根因定位（已实测）

| 检查 | 命令 | 实测结果 |
| --- | --- | --- |
| 依赖是否安装 | `ls -d node_modules` | **不存在**（仓库根目录无 `node_modules`；`ls -la \| grep node_modules` 无输出） |
| `esbuild` 声明 | `grep -n esbuild package.json` | `123:    "esbuild": "0.25.9",`（位于 `devDependencies`） |
| build 引用 | `grep -n esbuild plugin-src/client/build.mjs plugin-src/host/build.mjs` | 两个 build 脚本均 `import { build } from 'esbuild';` |
| 是否产生构建副作用 | `ls -l lib/index.js plugin-src/host/index.mjs` | mtime 仍为 `14:35:47`（检出时间），**未改动** |
| 是否污染工作区 | `git status --porcelain` | 与验收前完全一致（仅 `?? 文档`、`?? outputs/`），无新增跟踪改动 |

### 3.5 判定说明（不伪造）

- 文档本身在第 30、220 行把 `npm run check` 设定为**将来落地条目的验收门**，并未声称"当前已通过"——因此 `repo-green: failing` 不等于文档说谎，只表示**当前工作区不绿**。
- 本次**未执行** `npm install`/`npm ci`：其一超出验收授权（本轮仅允许新建一个文件，安装会写入大量文件），其二会使结论脱离"当前工作区真实状态"。因此本结论精确成立的是：**在未安装依赖的当前工作区，`npm run check` 退出码为 1，失败于 build 阶段**。
- 若需完整判定仓库测试是否绿，前置条件是先安装依赖（仓库有 `package-lock.json`），本报告不做该步骤，也不据此推断测试用例的通过率。
- 过程透明性：首次尝试将输出重定向到后台作业的 `/tmp`，该后台作业的 `/tmp` 被隔离，日志不可读、其 `EXIT_CODE=1` 不可信（build 未真正运行，可从 mtime 未变印证）。**本报告以第二次"取消重定向、由作业直接捕获输出"的运行（上表）为准。**

---

## 4. 问题清单（按严重程度排序）

> 说明：C 项为环境/门禁问题；D–G 为文档文字精度或表述问题；均不影响 `links-resolve` / `no-implemented-claims` 的整体结论，但建议修订。

| 级别 | # | 问题 | 位置 | 建议修正 |
| --- | --- | --- | --- | --- |
| **高（门禁失败）** | P1 | `npm run check` 真实退出码 1，build 阶段因缺 `esbuild` 失败，`node --test` 与 `verify-package.mjs` 未执行。**当前仓库门禁不绿**（环境根因：`node_modules` 未安装） | 影响文档第 30、220、223 行的验收门设定；非文档文字缺陷 | 在 CI/验收流程中先 `npm ci` 再跑 `npm run check`；或文档第 30 行补一句"运行前需先安装依赖（`npm install`/`npm ci`）"，避免读者误以为开箱即绿 |
| 低（精度） | P2 | `harness-approval.mjs:23` 行号偏 1：「默认 60 分钟」的常量 `DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000` 实际在 **:24**，:23 仅为相邻超时文案 | 文档**第 122 行** | 改为 `src/channels/shared/harness-approval.mjs:24`（或 `:22-24`） |
| 低（精度） | P3 | `weixin-bridge.mjs:123` 行号偏 1：会话键字符串 `return \`p2p:${userId}\`` 实际在 **:124**，:123 是 `function conversationKey(userId) {` | 文档**第 52 行** | 改为 `src/channels/weixin/weixin-bridge.mjs:124`（或 `:123-125`） |
| 低（证据强度） | P4 | `email-runtime.mjs:29` 引到的是 `pollIntervalForLimits` 注释文字（`* producing an absurdly long interval.`），不含发送预算逻辑，支撑"只管读取轮询"偏弱 | 文档**第 63 行** | 改引 `src/channels/email/email-runtime.mjs:21-31` 或 `:31`（函数声明处） |
| 低（内部一致） | P5 | §5.1/§5.2 称 L2 被动回复"仅 dry-run 可观测、暂停/预算/安静时段均不拦"、"dry-run 默认不拦 L2"；但 WG-01 把三个被动回复 `#send` 出口（`:679`/`:771`/`:804`）列为**发送预算**接线点。读者会疑惑预算为何要在 L2 接线 | 文档**第 94、104、106、131 行** | 在第 131 行注明这些点"仅用于出口分类与 dry-run 观测，预算/暂停/安静时段在 L2 不生效"，或从发送预算接线点中移出 L2 出口 |
| 低（可读性） | P6 | 第 18 行"**微信**…群能力为零"与第 69 行"🥇 立即可用的群聊替代：企业微信智能机器人 `wecom` 支持群"并列，易被误读为互相矛盾（二者实为 `weixin` 与 `wecom` 两个渠道） | 文档**第 18、69 行** | 第 18 行明确写"本仓库的 `weixin` 渠道（不含企业微信 `wecom`）" |
| 提示（证据边界） | P7 | 第 69、232 行"**立即可用**"仅依据代码层证据，缺少该渠道群能力的运行/测试证据；§9「未核验项」未包含"`wecom` 群是否实机可用" | 文档**第 69、232、270-285 行** | 将"立即可用"改为"代码层支持群（未做实机核验）"，或把该点补入 §9 未核验项 |

**问题总数：7 条**（1 条为环境/门禁失败，6 条为文档精度、表述或证据边界问题）。最严重的一条是 **P1：`npm run check` 真实失败（退出码 1）**。

---

## 5. 总体结论

1. **`links-resolve` = `passing`**：文档 5/5 Markdown 相对链接、全部指向现存文件的仓库相对路径均解析成功；未解析项均属"明确标注的建议新增路径/非文件 token/仓库外绝对路径"。额外抽查 60 处行号引用，57 处完全一致，发现 2 处行号偏 1、1 处引用为注释行（P2/P3/P4），属精度问题而非断链。
2. **`no-implemented-claims` = `passing`**：文档头部有明确"计划/决策文档、不是已实现能力清单"声明；个人微信渠道群能力标"完全未覆盖/群能力为零"，P2 明示"不承诺目标、无交付物、无 backlog 条目、无设计草案"（全文无 P2 的 WG 条目，`shouldParticipate` 仅作名称出现 1 次），五项控制全部标"无"。未发现"未实现写成已实现"或硬性自相矛盾；仅 P5 存在一处设计边界表述张力，建议澄清。
3. **`repo-green` = `failing`**：`npm run check` 实测退出码 **1**，在 build 阶段因 `Cannot find package 'esbuild'` 中断，未进入测试与打包校验；根因为当前工作区 `node_modules` 缺失（`esbuild` 为 devDependency）。未产生构建副作用，未污染工作区，结论未伪造成"通过"。

**综合**：该文档作为"计划与决策文档"在**链接可解析性**与**不冒充已实现能力**两项上**通过独立验收**；但其设定的质量门 `npm run check` 在当前工作区**不通过**（环境依赖缺失），且存在 6 处轻微的文字精度/表述/证据边界问题（P2–P7）建议修订。**文档整体可用，但不建议在未安装依赖的情况下宣称"验收门已绿"；同时建议修订 2 处行号偏 1 的引用以维持文档可复核性。**

---

*本报告仅新建本文件，未修改被验收文档 `docs/方案/微信个人号群聊补充目标与计划.md`，未修改仓库任何其他文件。所有结论均以本报告记录的实际命令输出为依据。*

---
---

## 第二轮验收（依赖安装后，由另一位独立验收执行者完成）

### 0. 本轮验收者声明与环境

- **验收者声明**：本节由**第二位独立验收执行者**（本会话）完成，**未参与**被验收文档的写作、装配、路径引用或任何一次修订，**也未参与**本轮两处行号的修正；本节所有结论仅来自本轮实际执行的命令与读取的文件内容。本节只**追加**在第一轮内容之后，第一轮正文与结论**原样保留、未改写**。
- **环境**：Node `v22.22.1`、npm `9.2.0`、`HEAD = 0ac02c9`，工作目录 `/home/stella/Project/dsh-im/dsh-im`。依赖已由装配者通过 `npm ci` 安装（198 个包，成功）。
- **被验收物状态**：`docs/方案/微信个人号群聊补充目标与计划.md`（302 行，git 状态仍为未跟踪 `??`，mtime 保持 `15:12:38`）。
- **约束遵守**：未修改被验收文档；未 `revert` / `checkout` / 清理任何东西；本轮**唯一**写入的文件就是本报告。
- **本轮重要环境限制（影响第 3 节判定，先行声明）**：本轮验收在 DSH 受限沙箱内执行（workspace-write），`$HOME` 下的 `/home/stella/.dsh` 对本会话为**只读**（实测 `mkdir: Read-only file system`），且 `/home/stella/.dsh/im` **不存在**。而仓库多个 production 测试默认在 `homedir()/.dsh/im` 下建立工作区（`src/channels/shared/default-workspace.mjs:5-6` 取 `join(homedir(), '.dsh')`，`:27-31` 执行 `mkdir(workspace, { recursive: true })`）。这一环境事实是第 3 节部分失败的根因，必须与"文档缺陷"区分开。

---

### 1. 复核两处已修正的引用（结论：两处均已修正且内容正确）

实际打印命令与结果：

```bash
$ sed -n '124p' src/channels/weixin/weixin-bridge.mjs
  return `p2p:${userId}`;
$ sed -n '24p' src/channels/shared/harness-approval.mjs
const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;
```

| # | 文档引用位置 | 文档引用 | 实测打印内容 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 第 52 行 | `src/channels/weixin/weixin-bridge.mjs:124` | ``  return `p2p:${userId}`; `` | ✅ 修正正确（会话键字符串所在行） |
| 2 | 第 122 行 | `src/channels/shared/harness-approval.mjs:24` | `const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;` | ✅ 修正正确（"默认 60 分钟"常量所在行） |

旧引用清除核查（在被验收文档内）：

```bash
$ grep -n 'weixin-bridge\.mjs:123' "docs/方案/微信个人号群聊补充目标与计划.md"
(none)
$ grep -n 'harness-approval\.mjs:23' "docs/方案/微信个人号群聊补充目标与计划.md"
(none)
$ grep -n 'weixin-bridge\.mjs:124\|harness-approval\.mjs:24' "docs/方案/微信个人号群聊补充目标与计划.md"
52:| — 会话键写死 p2p | `p2p:${userId}` | ❌ | `src/channels/weixin/weixin-bridge.mjs:124` |
122:- **与审批闭环**：…（默认 60 分钟，`src/channels/shared/harness-approval.mjs:24`）；…
```

- **被验收文档内已不含** `weixin-bridge.mjs:123` 与 `harness-approval.mjs:23` 两个旧引用；新引用分别位于第 52、122 行。✅
- 说明：旧引用字符串仍出现在 `outputs/wechatbot-supplement/verification-report.md`（第一轮正文第 104、272 行等），那是上一轮记录的历史事实，**不属于被验收文档**，本轮按要求忽略、且不改写第一轮内容。

---

### 2. 复跑链接检查（文档在第一轮之后被修改过）

#### 2.1 Markdown 相对链接：5 个，全部可解析

按 `docs/方案/` 解析后用 `[ -f ]` 验证：

| # | 文档位置 | target | 解析后路径 | 存在性 |
| --- | --- | --- | --- | --- |
| 1 | 第 297 行 | `../../PROACTIVE_DELIVERY.md` | `<repo>/PROACTIVE_DELIVERY.md` | ✅ EXISTS |
| 2 | 第 298 行 | `../../docs/adr/0001-semantic-core-native-channel-adapters.md` | `<repo>/docs/adr/0001-…md` | ✅ EXISTS |
| 3 | 第 299 行 | `渠道原生能力建设方案.md` | `<repo>/docs/方案/渠道原生能力建设方案.md` | ✅ EXISTS |
| 4 | 第 300 行 | `../../README.md` | `<repo>/README.md` | ✅ EXISTS |
| 5 | 第 301 行 | `../access-modes.md` | `<repo>/docs/access-modes.md` | ✅ EXISTS |

程序化提取结果：`TOTAL markdown links: 5`，5/5 `EXISTS`，0 `MISSING`；文档内 `grep -n 'http'` **无匹配**（无外链、无锚点）。

#### 2.2 反引号路径引用：68 处，仅 2 处未解析（均为文档明示的"建议新增"）

对文档内所有反引号片段做程序化提取，取形如 `path` / `path:line` 的 token，逐条解析（先按原样、再按 `docs/方案/`、`docs/`，裸文件名回退到 `src|plugin-src|docs|test|scripts|outputs` 的 basename 搜索）：

- `TOTAL backtick path refs: 68`
- 未解析 **2** 处，均为文档**明确标注为建议新增/待产出**的路径，属预期不存在、非断链：
  - `src/channels/shared/send-control.mjs`（第 131 行，WG-01"建议新增共享模块（建议名）"）
  - `outputs/wechatbot-supplement/spike-report.md`（第 184 行，WG-08"新增 spike 报告（建议）"）

#### 2.3 带行号引用抽查：54 处全部打印核对，全部一致

共提取到 **54 处**带行号（含区间与逗号列表）的 `path:line` 引用，**全部**执行并打印实际行内容逐一核对——远超"至少 10 处"的要求。其中**包含本轮重点复核的两处修正引用**。抽查表（节选 16 行，覆盖所有重点项；其余 38 处结论同为一致）：

| # | 文档位置 | 引用 | 打印内容（±缩进/空白） | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 第 52 行 | `src/channels/weixin/weixin-bridge.mjs:124`（本轮修正） | `` return `p2p:${userId}`; `` | ✅ 一致 |
| 2 | 第 122 行 | `src/channels/shared/harness-approval.mjs:24`（本轮修正） | `const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;` | ✅ 一致 |
| 3 | 第 51 行 | `src/channels/weixin/weixin-runtime.mjs:409` | `if (target?.kind !== 'user' \|\| !toUserId) {` | ✅ 一致 |
| 4 | 第 53 行 | `src/channels/weixin/weixin-bridge.mjs:393` | `conversationType: 'direct',` | ✅ 一致 |
| 5 | 第 58 行 | `plugin-src/host/channels/shared/access-policy-production.mjs:113-115` | `:113 export function privilegedSenderIdsFor(channel, config = {}) {`、`:115 if (key === 'weixin') return cleanIds(config.ownerUserId);` | ✅ 一致 |
| 6 | 第 59 行 | `src/channels/shared/text-harness-bridge.mjs:322` | ``const key = `${normalized.kind}:${normalized.conversationId}`;`` | ✅ 一致 |
| 7 | 第 61 行 | `deferred-delivery-coordinator.mjs:172` | `await state.patchDeferred(id, { status: 'failed', deliveryOutcome: 'unknown', attempts: (current.attempts ?? 0) + 1 });` | ✅ 一致 |
| 8 | 第 67 行 | `src/channels/weixin/state-store.mjs:14` + `:17` `:18` `:19` | `:14 recentOutboundMessages: [],`；`:17 …LIMIT = 200;`；`:18 …TTL_MS = 30 * 24 * 60 * 60 * 1_000;`；`:19 …TEXT_LIMIT = 8_000;` | ✅ 一致（上限 200 / TTL 30 天 / 单条 8,000 均对） |
| 9 | 第 69、229 行 | `src/channels/wecom/wecom-bridge.mjs:129` | ``return body.chattype === 'group' ? `group:${body.chatid}` : `direct:${body.from?.userid}`;`` | ✅ 一致 |
| 10 | 第 70、229 行 | `src/channels/wecom-app/wecom-app-bridge.mjs:281` | `conversationType: 'direct',` | ✅ 一致 |
| 11 | 第 120 行 | `src/channels/shared/deferred-delivery.mjs:157` | `await store.patchDeferred(entry.id, { attempts, status: attempts >= 3 ? 'failed' : 'pending' });` | ✅ 一致 |
| 12 | 第 131 行 | `src/channels/shared/text-harness-bridge.mjs:652` | `sendProactiveText(target, text, { signal, format = 'plain' } = {}) {` | ✅ 一致 |
| 13 | 第 131 行 | `src/channels/weixin/weixin-bridge.mjs:679`、`:700`、`:771`、`:804` | `:679 await this.#send(sender, t(COMMAND_PERMISSION_DENIED_MESSAGE), contextToken, runId);` 等 4 个发送出口 | ✅ 一致 |
| 14 | 第 183 行 | `src/channels/feishu/multi-bot-controller.mjs:611` | `capabilities: ['proactive-text-checked', … , 'thread-history-text-checked'] };`（飞书专用能力数组） | ✅ 一致 |
| 15 | 第 200 行 | `whatsapp-runtime.mjs:321`、`:355` | `:321 const group = remoteJid.endsWith('@g.us');`；`:355 addressed: !group \|\| fromMe \|\| mentioned \|\| replyToSelf,` | ✅ 一致 |
| 16 | 第 229 行 | `src/channels/wecom/wecom-bridge.mjs:151`、`:758-761`、`:1021` | `:151 // Group callbacks retain the leading @bot mention…`；`:758-761` chattype/chatId 处理；`:1021 addressed: true,` | ✅ 一致 |

**本节结论**：第一轮报告点名的 2 处行号偏 1（P2/P3）**已修复且实测正确**；本轮 54 处带行号引用与 5/5 Markdown 链接**无一处不一致**，未解析项仅为文档明示的规划路径。

---

### 3. `npm run check` 实测结果

#### 3.1 命令、退出码与三阶段实况

- 完整命令：`npm run check`（`package.json:102` 展开为 `npm run build && npm test && node scripts/verify-package.mjs`）
- 工作目录：`/home/stella/Project/dsh-im/dsh-im`；Node `v22.22.1`、npm `9.2.0`
- **退出码：`1`**（由命令尾部 `echo "REAL_EXIT=$?"` 实测捕获；两次独立运行结果一致）

阶段实况：

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| build | `node plugin-src/client/build.mjs && node plugin-src/host/build.mjs` | ✅ 成功，输出 `Wrote /home/…/lib/client.js`、`Wrote /home/…/lib/index.js` |
| test | `node --test test/*.test.mjs test/channels/*/*.test.mjs` | ❌ 失败（见 3.2）；直接导致链中断 |
| verify-package | `node scripts/verify-package.mjs` | ⏸ **在链中未执行**（`npm test` 非零 → `&&` 短路）；单独补跑见 3.4 |

#### 3.2 测试统计（真实尾部摘要原文）

```
# tests 4011
# suites 3
# pass 3776
# fail 11
# cancelled 224
# skipped 0
# todo 0
# duration_ms 17510.510878
```

#### 3.3 11 个失败的完整清单与归因

| # | 失败用例 | failureType | 错误 / 根因 |
| --- | --- | --- | --- |
| 1 | `production assembly keeps secrets in credentials and creates per-bot runtimes` | testCodeFailure | `ENOENT: no such file or directory, mkdir '/home/stella/.dsh/im'` |
| 2 | `Discord production has no per-bot result-file Gate` | testCodeFailure | 同上 `ENOENT … '/home/stella/.dsh/im'` |
| 3 | `QQ production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 4 | `token-channel production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 5 | `Slack production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 6 | `Telegram production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 7 | `Enterprise WeChat production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 8 | `WhatsApp production has no per-bot result-file Gate` | testCodeFailure | 同上 |
| 9 | `Weixin production has no per-bot result-file Gate` | testCodeFailure | `Weixin operation failed` / code `workspace-save-failed`（同一默认 IM 工作区保存路径） |
| 10 | `production preserves workspace/session isolation and reports a committed cleanup failure` | testCodeFailure | 同上 `workspace-save-failed`（weixin） |
| 11 | `Feishu verification uses the SDK HTTP client through HTTPS_PROXY` | testCodeFailure | `Expected values to be strictly equal: 0 !== 1`（`ERR_ASSERTION`，`proxyHits.length` 为 0） |

- **224 个 `cancelled`** 的 `failureType` 均为 `cancelledByParent`、`error: 'Promise resolution is still pending but the event loop has already resolved'`，集中出现在 Discord / Feishu / QQ / Slack / Telegram / wecom / Harness 等测试文件中，是上述失败**引发的级联取消**（`node --test` 的父级测试提前结束导致同批剩余子测试被取消），不是 224 个独立缺陷。

#### 3.4 verify-package 单独结果

为补足"链中未执行"的空白，单独补跑（该脚本经阅读确认**只读**，无 `write`/`mkdir`/`pack` 等写操作）：

```bash
$ node scripts/verify-package.mjs
Verified dsh-im package artifacts.
VERIFY_EXIT=0
```

即：打包/产物校验本身**通过**（退出码 0），失败点在 `npm test`。

#### 3.5 根因归因（区分"环境限制"与"仓库/文档缺陷"）

- 失败 1–10 全部指向同一条默认工作区路径：`defaultImWorkspace` = `join(homedir(), '.dsh', 'im')`，随后 `ensureImWorkspaceDirectory` 对其执行 `mkdir(recursive)`。本轮实测：
  ```bash
  $ ls -ld /home/stella/.dsh/im
  ls: cannot access '/home/stella/.dsh/im': No such file or directory
  $ mkdir -p /home/stella/.dsh/im/dsh-probe-verify
  mkdir: Read-only file system
  ```
  **`/home/stella/.dsh` 对本验收沙箱为只读**，故这些 `mkdir` 失败。这是**验收环境（受限沙箱）造成的失败**，并非文档缺陷；本轮**无法**在可写 `$HOME` 的环境下复跑以证明其在普通环境下通过（授权不允许在仓库外写文件），故仅如实记录为"本环境下观察到的失败"。
- 失败 11 是**会话代理环境**造成的：本会话注入了 `HTTPS_PROXY/https_proxy=http://127.0.0.1:7890`、`ALL_PROXY/all_proxy=socks://…`、`NODE_USE_ENV_PROXY=1` 等变量。把环境变量剥离后单独复跑该文件：
  ```bash
  $ env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy \
        -u NODE_USE_ENV_PROXY -u NO_PROXY -u no_proxy \
        node --test test/channels/feishu/feishu-proxy.test.mjs
  # tests 5
  # pass 5
  # fail 0
  ```
  即该测试在干净代理环境下 **5/5 通过**，失败由本会话环境注入导致。（本机出网本身正常：`curl https://example.com` 返回 `http_code=200`。）
- **不伪造**：本轮未修改任何代码、未重跑"改造后"的仓库；以上失败就是本工作区当前的真实结果。

---

### 4. 构建副作用记录（只报告，未 revert / 未清理）

#### 4.1 `git status --porcelain` 前后对比

| 时点 | 输出 |
| --- | --- |
| `npm run check` **之前** | `?? .npm-cache/`、`?? docs/方案/微信个人号群聊补充目标与计划.md`、`?? outputs/` |
| `npm run check` **之后** | `?? .npm-cache/`、`?? docs/方案/微信个人号群聊补充目标与计划.md`、`?? outputs/` |
| 全部测试复跑结束后（最终） | 同上，**完全一致** |

对比结论：**无任何新增的已跟踪文件改动**；三处 `??` 均为本轮之前既有的未跟踪项（`.npm-cache/` 为依赖安装缓存，与构建、测试无关）。

#### 4.2 受版本控制的 `lib/` 目录（重点）

`git ls-files lib/` 确认 `lib/` 下**有 2 个受版本控制的文件**：`lib/client.js`、`lib/index.js`。`npm run build` 确实重新生成了它们：

| 检查 | `npm run check` 之前 | 之后 |
| --- | --- | --- |
| mtime | `Oct 12 15:13` | `Oct 12 15:14`（被重写） |
| `sha256 lib/client.js` | `6a11d7d14bdb95bbbdaf2638d76bc478631e65d49a636b41b87ddc9c3b12e248` | `6a11d7d…3b12e248`（**逐字节相同**） |
| `sha256 lib/index.js` | `c706a37cafed95fb15c727f3474bc463061c0298868d476f811c88920cd806db` | `c706a37…0cd806db`（**逐字节相同**） |

```bash
$ git status --porcelain lib/
(空)
$ git diff --stat lib/
(空)
```

- **结论**：构建**重写了文件但产物内容完全一致**（确定性构建），`lib/` 以及其它任何已跟踪文件在 git 层面**零改动**。因此"构建无副作用（对版本控制而言）"成立；唯一可见差异是**文件 mtime**（未被 git 跟踪）。
- 本轮**未**对 `lib/` 或任何文件执行 `revert` / `checkout` / 清理；`.npm-cache/`、`outputs/`、被验收文档均保持原状，交由装配者决定后续处理。

---

### 5. 三项标准的修订结论

| 标准 | 第一轮结论 | 第二轮修订结论 | 依据 |
| --- | --- | --- | --- |
| `links-resolve` | `passing` | **`passing`** | 5/5 Markdown 相对链接 `EXISTS`；68 处反引号路径中仅 2 处未解析且均为文档明示的规划新增路径；54 处带行号引用**逐条打印核对全部一致**，含本轮修正的 `weixin-bridge.mjs:124` 与 `harness-approval.mjs:24` |
| `no-implemented-claims` | `passing` | **`passing`** | 文档在第 3–6 行明确声明"计划与决策文档、不是已实现能力清单"（未被本轮修改改写）；`WG-` 编号仍仅为 `WG-01…WG-14`，P2 无任何 backlog 条目，`shouldParticipate` 全文仅出现 1 次且仅作能力名称（第 81 行）；第 25 行仍写"不交付任何'能力已具备'的声明"；五项控制仍全部标"无" |
| `repo-green` | `failing`（依赖未安装） | **`failing`**（依赖已安装，但测试仍失败） | `npm run check` 真实退出码 **1**：build 成功，`npm test` 失败（4011 用例：pass 3776 / **fail 11** / **cancelled 224**），`verify-package` 在链中未执行（单独运行 exit 0）。11 个失败中 10 个由**验收沙箱的只读 `$HOME`（`/home/stella/.dsh` 只读，无法创建 `.dsh/im`）**导致、1 个由**本会话注入的代理环境变量**导致（剥离后该文件 5/5 通过）。**无任何已跟踪文件改动**（`lib/` 内容逐字节一致） |

**关于 `repo-green` 的诚实边界**：本轮**不能**宣称仓库在普通（非沙箱）环境下绿，也**不能**宣称它不绿——它是一个受限环境下的真实失败。可以确定的只有两点：(a) 在**本验收环境**中 `npm run check` 退出码为 1；(b) 该失败可归因于沙箱只读 `$HOME` 与会话代理变量，而非被验收文档或被修改的仓库文件（本轮仓库零改动）。若装配者需要 `repo-green: passing` 的结论，前置条件是在**可写 `$HOME` 且无干扰代理变量**的环境下复跑 `npm run check`。

---

### 6. 最终三项结论（明确标注）

> **最终三项结论**
> - `links-resolve` = **`passing`**
> - `no-implemented-claims` = **`passing`**
> - `repo-green` = **`failing`**（`npm run check` 退出码 `1`；build 成功后 `npm test` 失败：fail 11 / cancelled 224；根因为受限沙箱环境，非文档缺陷；构建对已跟踪文件**零副作用**）

**一句话汇总**：第一轮指出的 2 处行号偏差**已修正且经实测正确**，文档的链接与"不冒充已实现"两项在本轮独立复核下**继续通过**；`npm run check` 在依赖安装后**仍以退出码 1 失败**，但 11 个失败全部可归因于本轮验收沙箱（只读 `$HOME` 造成的 `.dsh/im` 创建失败 = 10 个，本会话注入的代理变量 = 1 个，后者剥离环境后 5/5 通过），且构建对 `lib/` 等已跟踪文件**没有任何内容改动**（`git status`/`git diff` 均为空，两个产物 sha256 前后完全一致）。

---

## 补充验收：受控对照实验（第一轮验收者复跑，append-only，前两节正文未改写）

> 本节由**第一轮验收执行者**追加。说明：第一轮验收期间，被验收文档与依赖状态发生**外部变化**——文档于 `15:12:38` 被修订（当前 `md5 = 3112a8bd0dadef495abcb6ebca4de435`，302 行），依赖由装配者安装（`node_modules` 出现）。本节以**当前修订版**为准复跑，并补做第二轮声明"无法完成"的**受控对照实验**。

### A. 被验收版本与链接复核（`links-resolve` 维持 `passing`）

- 当前版本：`md5 = 3112a8bd0dadef495abcb6ebca4de435`、`size = 26330`、`mtime = 15:12:38`；5/5 Markdown 链接 `EXISTS`，无 `http`/锚点链接。
- 以当前版本重新逐条打印核对 **60 处**带行号引用，**60/60 与文档所引位置一致**（覆盖 `state-store.mjs:14/:17/:18/:19`、`text-harness-bridge.mjs:652`、`deferred-delivery.mjs:157`、`harness-approval.mjs:24`、`wecom-bridge.mjs:129`、`wecom-app-bridge.mjs:281` 等全部重点项）。
- **第一轮 P2/P3 已消解**：第一轮记录的 `weixin-bridge.mjs:123`、`harness-approval.mjs:23` 两处行号偏 1，在当前修订版中已分别改为 `:124`、`:24`，实测正确——`:124` = `` return `p2p:${userId}`; ``、`:24` = `const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;`。故第一轮"2 处偏 1"仅适用于已被取代的旧版本。
- 仍存留的唯一次要项：第 63 行 `email-runtime.mjs:29` 引到注释行（`* producing an absurdly long interval.`），支撑偏弱。

### B. 不冒充已实现（`no-implemented-claims` 维持 `passing`）

第 3–6 行声明、第 25 行"不交付任何'能力已具备'的声明"、`WG-01…WG-14`（**P2 无任何条目**）、第 81 行 `shouldParticipate` 全文仅出现 1 次且仅作能力名称、第 245–258 行 P2 仅门槛、五项控制均标"无"——复核均未被本轮修订改动。结论不变：**`passing`**。

### C. `npm run check` 受控对照（`repo-green` 仍为 `failing`，但归因由"推断"升级为"实证"）

| 运行 | 命令 | 退出码 | pass | fail | cancelled |
| --- | --- | --- | --- | --- | --- |
| R1（环境原样，依赖已装） | `npm run check` | **1** | 3776 | 11 | 224 |
| R2（受控：`DSH_HOME` 指向可写路径） | `DSH_HOME=/tmp/dsh-verify-home npm run check` | **1** | 3786 | **1** | 224 |

- **R2 使 11 个失败中的 10 个转绿**，正面证明这 10 个 `ENOENT: … mkdir '/home/stella/.dsh/im'` 与 `code: workspace-save-failed` 是**会话沙箱拒绝写工作区之外的 `$DSH_HOME`** 所致，而非文档或仓库缺陷。第二轮只做到"如实记录、无法复跑证明（授权不允许在仓库外写文件）"；本轮实测 `/tmp` 对本会话**可写**，故用受控实验补上了这一步确认。
- 单文件决定性复核：`DSH_HOME=/tmp/dsh-verify-home node --test test/channels/shared/production.test.mjs test/channels/weixin/production.test.mjs` → `# pass 8 / # fail 0`，退出码 `0`。
- 第 11 个失败（`not ok 838 - Feishu verification uses the SDK HTTP client through HTTPS_PROXY`，`test/channels/feishu/feishu-proxy.test.mjs:29`）经剥离代理变量后单文件复核 → `# pass 5 / # fail 0`，确认为会话代理环境所致（与第二轮结论一致）。
- **对第二轮"224 个取消 = 上述 11 个失败引发的级联"的修正**：R2 在 10 个失败已消除、代理已剥离的情况下，**224 个 `cancelledByParent` 依旧存在**。以 `test/channels/discord/discord.test.mjs` 为样本单独复跑：`# tests 31 / # pass 1 / # cancelled 30`——第 1 个用例通过后其余被整体取消；该现象在 `--test-concurrency=1` 与直接 `node <file>`（不走 `--test`）下同样复现。可疑代码点 `src/channels/discord/discord-api.mjs:76-77`：

  ```js
  const timer = setTimeout(resolve, ms);
  timer?.unref?.();
  ```

  429 重试的等待定时器被 `unref()`，当某用例只 `await` 它而事件循环已无其它句柄时，循环提前结束 → 该用例被判 `cancelledByParent` 并连带取消后续队列（`error: 'Promise resolution is still pending but the event loop has already resolved'`）。**是否为本环境特有，未做跨环境对照，标 `未核验`。**
- `verify-package` 单独 `exit 0`、`lib/` 内容逐字节一致、`git status` 零改动等结论与第二轮一致，本节不重复。

### D. 修订后的最终三项结论

> - `links-resolve` = **`passing`**（当前修订版：5/5 链接可解析，60/60 行号引用一致）
> - `no-implemented-claims` = **`passing`**
> - `repo-green` = **`failing`**（`npm run check` 退出码 **1**；`fail 11 / cancelled 224`。其中 10 个失败经受控实验证实为沙箱写 `$DSH_HOME` 被拒、1 个为代理环境；224 个取消为连带取消，根因指向 `discord-api.mjs:76-77` 的 `unref()` 定时器，未跨环境对照。**均为环境/仓库测试层原因，非被验收文档的文字缺陷**。）

### E. 问题清单（截至当前版本）

1. **[高｜环境/门禁]** `npm run check` 真实失败（退出码 1）。文档第 30、220、223 行把它设为验收门，但当前环境下该门不绿。修正方向：在"已 `npm ci`、可写 `$DSH_HOME`、已清理代理变量"的条件下运行；并单独评估 `src/channels/discord/discord-api.mjs:76-77` 的 `unref()` 定时器（可能是跨环境隐患）。
2. **[低｜证据强度]** 第 63 行 `email-runtime.mjs:29` 引注粒度过粗（引到注释行）。建议改引 `src/channels/email/email-runtime.mjs:21-31` 或 `:31`。
3. **[低｜内部一致]** 第 94/104/106 行称 L2 被动回复不被预算拦截，但第 131 行 WG-01 把 `weixin-bridge.mjs:679`/`:771`/`:804`（被动回复 `#send` 出口）列为发送预算接线点。建议注明"仅用于观测/分类"或移出。
4. **[低｜可读性]** 第 18 行"微信…群能力为零"（指 `weixin`）与第 69 行"`wecom` 支持群、立即可用"并列，易被误读为矛盾。建议第 18 行明示"本仓库 `weixin` 渠道（不含企业微信 `wecom`）"。
5. **[提示｜证据边界]** 第 69、232 行"立即可用"仅代码层证据，缺运行/测试证据。建议降级措辞或补入 §9 未核验项。

**补充节一句话总结**：第一轮的两处行号偏差已在当前修订版中被改正且实测正确，`links-resolve` 与 `no-implemented-claims` 维持 `passing`；`repo-green` 仍为 `failing`，但经受控实验，11 个失败中的 10 个可**确证**为沙箱写 `$DSH_HOME` 被拒、1 个为代理环境，另 224 个取消另有其因（指向 `discord-api.mjs:76-77` 的 `unref()` 定时器），**均与本文档文字无关**。

---

*补充节由第一轮验收执行者追加；本会话仅新建/追加 `outputs/wechatbot-supplement/verification-report.md` 这一个文件，未修改被验收文档（md5 保持 `3112a8bd0dadef495abcb6ebca4de435`）与仓库任何其他文件。*

---
---

## 第三轮验收（CI 同版本 Node 24 对照）

### 0. 本轮验收者声明与环境

- **验收者声明**：本节由**第三位（最终轮）独立验收执行者**（本会话）完成，**未参与**被验收文档的写作、装配、路径引用或任何一次修订，也**未参与**前两轮及"补充验收"节的任何工作。本节所有结论仅来自本轮实际执行的命令输出与读取的文件内容。
- **append-only 承诺**：本节**只追加**在既有内容之后；前两轮正文与"补充验收"节**原样保留、一字未改写**。被验收文档 `docs/方案/微信个人号群聊补充目标与计划.md` **未被修改**（验收前后 `md5 = 3112a8bd0dadef495abcb6ebca4de435` 完全一致）。
- **环境**：
  - 工作目录 `/home/stella/Project/dsh-im/dsh-im`，`HEAD = 0ac02c9`。
  - **CI 同版本 Node 24**：`v24.21.0`（由 `npx node@24` 预置的二进制 `/home/stella/Project/dsh-im/dsh-im/.npm-cache/_npx/387698761821791d/node_modules/node/bin/node` 提供，实测 `--version` 输出 `v24.21.0`）。
  - **本机系统 Node 22**：`v22.22.1`；两者 npm 均为 `9.2.0`。
  - 仓库 CI 固定 Node 24：`.github/workflows/ci.yml:21` 与 `:40` 实测均为 `node-version: 24`。
  - 依赖已安装（`node_modules` 存在），无需要求 `npm ci`。
- **环境修正（两次运行完全相同）**：剥离本会话注入的代理变量，并把默认 IM 工作区指向仓库内可写目录——依据 `src/channels/shared/default-workspace.mjs:5-6` 的 `config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')`。
- **本轮写入面声明**：按本轮任务书明确指定的命令，本轮实际写入了 **3 个文件**——两个运行日志 `outputs/runtime/check-node24-verify.log`、`outputs/runtime/check-node22-verify.log`（均为任务书指定路径，且与既有 `outputs/runtime/check-node24.log` **不同名、未覆盖**），以及本报告的本次追加。**未**修改被验收文档，**未**修改仓库任何其他文件，**未**执行任何 `revert` / `checkout` / 清理。

---

### 1. Node 24（CI 同版本）独立复跑：**全绿，退出码 0**

#### 1.1 完整命令（原样执行）

```bash
cd /home/stella/Project/dsh-im/dsh-im
N24DIR="$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin"
export PATH="$N24DIR:$PATH"
node --version   # v24.21.0
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY \
  DSH_HOME="$PWD/.test-dsh-home" npm_config_cache="$PWD/.npm-cache" \
  npm run check > outputs/runtime/check-node24-verify.log 2>&1
echo "EXIT_CODE=$?"
```

#### 1.2 真实结果

| 项目 | 实测值 |
| --- | --- |
| `node --version` | `v24.21.0` |
| `npm --version` | `9.2.0` |
| **真实 `EXIT_CODE`** | **`0`** |
| `ℹ tests` | `4027` |
| `ℹ suites` | `3` |
| `ℹ pass` | `4027` |
| `ℹ fail` | **`0`** |
| `ℹ cancelled` | **`0`** |
| `ℹ skipped` / `ℹ todo` | `0` / `0` |
| `ℹ duration_ms` | `14264.977973` |
| `verify-package` | ✅ **出现 `Verified dsh-im package artifacts.`**（日志末行） |
| 日志中 `^not ok` 行数 | `0` |
| 日志中 `cancelledByParent` 出现次数 | `0` |

- 测试统计原文位于 `outputs/runtime/check-node24-verify.log:5206-5214`：

  ```
  ℹ tests 4027
  ℹ suites 3
  ℹ pass 4027
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 14264.977973
  Verified dsh-im package artifacts.
  ```

- 三个阶段（`build` → `test` → `verify-package`）**全部执行且全部成功**：日志可见 `Wrote …/lib/client.js`、`Wrote …/lib/index.js`，随后测试全绿，最后 `verify-package` 打印成功语。
- **运行身份自证**：该日志内应用运行时自报 `"nodeVersion":"24.21.0"`，可确认统计确实由 Node 24 产生，而非误用了系统 Node。
- **结论**：Node 24 下 `npm run check` **退出码 0、`fail 0`、`cancelled 0`、verify-package 通过**——三项判定条件**全部满足**。

#### 1.3 与预置日志的交叉印证（非本轮证据，仅作旁证）

仓库中已存在一份更早的 `outputs/runtime/check-node24.log`（非本轮写入，本轮**未覆盖**它），其统计同为 `ℹ tests 4027 / ℹ pass 4027 / ℹ fail 0 / ℹ cancelled 0`。该旁证与本轮**独立执行**的结果完全吻合，进一步说明 Node 24 全绿是可重复的。

---

### 2. Node 22 受控对照：**同一组环境修正下仍退出码 1**

#### 2.1 完整命令（原样执行，不加 PATH 前置，即系统 Node）

```bash
cd /home/stella/Project/dsh-im/dsh-im
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY \
  DSH_HOME="$PWD/.test-dsh-home" npm_config_cache="$PWD/.npm-cache" \
  npm run check > outputs/runtime/check-node22-verify.log 2>&1
echo "EXIT_CODE=$?"
```

#### 2.2 真实结果

| 项目 | 实测值 |
| --- | --- |
| `node --version` | `v22.22.1` |
| `npm --version` | `9.2.0` |
| **真实 `EXIT_CODE`** | **`1`** |
| `# tests` | `4011` |
| `# suites` | `3` |
| `# pass` | `3787` |
| `# fail` | **`0`** |
| `# cancelled` | **`224`** |
| `# skipped` / `# todo` | `0` / `0` |
| `# duration_ms` | `15656.163145` |
| `verify-package` | ⏸ **未执行**（`npm test` 非零 → `&&` 短路；日志中**无** `Verified dsh-im package artifacts.`） |
| 日志中 `^not ok` 行数 | `224`（全部为 `cancelledByParent`） |
| 日志中 `Promise resolution is still pending` 次数 | `224` |

- 测试统计原文位于 `outputs/runtime/check-node22-verify.log:26609-26616`：

  ```
  # tests 4011
  # suites 3
  # pass 3787
  # fail 0
  # cancelled 224
  # skipped 0
  # todo 0
  # duration_ms 15656.163145
  ```

- 224 条 `not ok` 的失败类型**逐条一致**：`failureType: 'cancelledByParent'`、`error: 'Promise resolution is still pending but the event loop has already resolved'`、`code: 'ERR_TEST_FAILURE'`。**注意 `# fail 0`——没有一条独立断言失败**；退出码 1 完全来自这 224 条"父级取消"。
- **运行身份自证**：该日志内应用运行时自报 `"nodeVersion":"22.22.1"`。
- 该结果与"补充验收"节以 `test/channels/discord/discord.test.mjs` 单独复现的现象（`# pass 1 / # cancelled 30`）方向一致：**父级测试结束后，同批剩余子测试被整体取消**。

---

### 3. 受控对照结论：差异由 Node 版本决定，与命令取巧无关

两次运行**使用完全相同的一组环境修正**（同 `DSH_HOME=$PWD/.test-dsh-home`、同 `npm_config_cache`、同 `npm run check`、同工作目录、同已安装依赖、同剥离代理变量），**唯一变量是 Node 主版本**：

| 运行 | Node | 真实退出码 | tests | pass | fail | cancelled | verify-package |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-Node24**（CI 同版本） | `v24.21.0` | **`0`** | `4027` | `4027` | **`0`** | **`0`** | ✅ `Verified dsh-im package artifacts.` |
| **R-Node22**（本机系统版本） | `v22.22.1` | **`1`** | `4011` | `3787` | `0` | **`224`** | ⏸ 未执行（链被短路） |

由此可确定：

1. **本机 Node 22 的非零退出码属 Node 版本行为差异**，与被验收文档**无关**，也与命令写法无关——同一命令在 Node 24 下退出码为 0。
2. 该差异**独立复现了前几轮确立的第三条事实**：在修正代理与 `$DSH_HOME` 两项环境干扰后，Node 22 仍残留 224 个 `cancelledByParent`；换到仓库 CI 固定的 Node 24 后**同一套命令零取消、零失败**。
3. 前两轮记录的两个环境根因（只读 `$DSH_HOME` 导致的 10 个失败、注入代理导致的 1 个 feishu 失败）在本轮**同一组环境修正下均已消失**：Node 22 的 `# fail` 已经是 `0`，剩余问题只是 224 条级联取消。这与"Node 22 行为差异"是**两个先后叠加、彼此独立**的问题。

---

### 4. 无副作用核验（只记录，未清理、未 revert）

`git status --porcelain` 前后对比（在两次运行**之前**与**之后**各执行一次）：

| 时点 | `git status --porcelain` 输出 |
| --- | --- |
| 两次运行**之前** | `?? .npm-cache/`、`?? docs/方案/微信个人号群聊补充目标与计划.md`、`?? outputs/` |
| 两次运行**之后** | `?? .npm-cache/`、`?? docs/方案/微信个人号群聊补充目标与计划.md`、`?? outputs/` |
| 对比 | **逐行完全一致，无任何新增/变化** |

- **无任何被跟踪文件改动**：`git status --porcelain lib/` 输出为空，`git diff --stat` 输出为空（三处 `??` 均为运行前既有的未跟踪项，非本轮产生的新跟踪改动）。
- **`lib/` 产物逐字节不变**（重点）：

  | 文件 | 运行前 sha256 | 运行后 sha256 | 结论 |
  | --- | --- | --- | --- |
  | `lib/client.js` | `6a11d7d14bdb95bbbdaf2638d76bc478631e65d49a636b41b87ddc9c3b12e248` | `6a11d7d14bdb95bbbdaf2638d76bc478631e65d49a636b41b87ddc9c3b12e248` | **逐字节相同** |
  | `lib/index.js` | `c706a37cafed95fb15c727f3474bc463061c0298868d476f811c88920cd806db` | `c706a37cafed95fb15c727f3474bc463061c0298868d476f811c88920cd806db` | **逐字节相同** |

  （两次 `npm run build` 确实重写了这两个文件——mtime 由 `15:20:53/15:20:54` 变为 `15:22:12/15:22:13`——但**内容完全一致**，属确定性构建；mtime 不被 git 跟踪。）
- **被验收文档未被触碰**：`docs/方案/微信个人号群聊补充目标与计划.md` 前后 `md5` 均为 `3112a8bd0dadef495abcb6ebca4de435`。
- 运行辅助目录 `$PWD/.test-dsh-home/im` 在本轮运行前即已存在（mtime `15:18`，早于本轮 `15:21` 起的两次运行）且**为空目录**，不含任何文件，故对 `git status` **不可见、无影响**。按要求**未做任何清理或删除**。

**副作用结论**：本轮两次全量运行对**版本控制层面零副作用**（被跟踪文件零改动、`lib/` 产物逐字节不变、被验收文档 md5 不变）；唯一可见变化是未被 git 跟踪的 mtime、以及两处按任务书指定的 `outputs/runtime/*-verify.log` 新增日志。

---

### 5. 修订后的最终三项结论（第三轮，最终）

> **最终三项结论**
> - `links-resolve` = **`passing`**（沿用前几轮结论：5/5 Markdown 相对链接可解析；本轮未对文档做任何改动，其 md5 与"补充验收"节核验时一致，故链接与行号事实不变）
> - `no-implemented-claims` = **`passing`**（同上：文档第 3–6 行"计划/决策文档"声明、P2 无 backlog 条目、五项控制均标"无"等均未被本轮触碰）
> - `repo-green` = **`passing`**（在仓库 CI 固定的 **Node 24** 下，`npm run check` **真实退出码 `0`**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，且 `verify-package` 打印 `Verified dsh-im package artifacts.`）

**修订说明（唯一被本轮改动的一项）**：`repo-green` 由前几轮的 `failing` **修订为 `passing`**。依据是本轮**在 CI 同版本 Node 24 下独立复跑得到的真实退出码 0**；前几轮的 `failing` 结论是**在 Node 22（本机系统版本）下**得到的，其残余的 224 个 `cancelledByParent` 已由本节的受控对照证明为**本机 Node 版本差异**，而非仓库或文档缺陷。

**关于 Node 22 非零退出码的定性**：在本机 Node `v22.22.1` 下，即使剥离代理变量并把 `$DSH_HOME` 指向可写目录，`npm run check` 仍以退出码 `1` 结束（`fail 0 / cancelled 224`）——这是**本机 Node 版本行为差异**，与被验收文档**无关**：该文档是仓库内**新增的未跟踪 Markdown**（`git status` 显示为 `?? docs/方案/…md`），不参与任何构建或测试；而两次全量构建对 `lib/` 产物**逐字节不变**、对其余被跟踪文件**零改动**。

**诚实边界（不越界、不伪造）**：
- 本轮结论成立的前提是"**已安装依赖 + 可写 `$DSH_HOME` + 已剥离代理变量 + Node 24**"。这正是仓库 CI（`.github/workflows/ci.yml:21,40` 固定 `node-version: 24`）的复现条件。
- 本轮**未**改动 `src/`、`test/`、`package.json` 或任何构建/测试代码；`repo-green` 的转变**完全来自切换 Node 主版本**，不存在"为了变绿而改代码"的情况。
- 本报告记录的两个日志文件、两次退出码、两套统计数字**均来自本轮实际执行**，无任何一处为推断或伪造；Node 22 的失败结果同样**如实记录**，未只挑绿的一次上报。

### 6. 问题清单更新（本轮）

- 前几轮的 **[高｜环境/门禁] `npm run check` 退出码 1** 一项，在 **CI 同版本 Node 24** 条件下**已消解**（退出码 0）。建议的后续动作：验收与本地复现统一以 Node 24（`.github/workflows/ci.yml` 已固定）执行；若仍需支持 Node 22，则单独排查 Node 22 下 `cancelledByParent` 的级联取消行为（本轮已定位为**版本差异**，未进一步改代码）。
- 前几轮的文档层低优先级项（`email-runtime.mjs:29` 引注粒度过粗、L2 与发送预算接线点的表述张力、"微信群能力为零"与 `wecom` 并列的可读性、"立即可用"缺实机证据）**本轮未复核、未改变**，仍按"补充验收"节的 E 节清单保留，供文档作者决定是否修订。

**第三轮一句话总结**：在仓库 CI 固定的 **Node 24** 下，`npm run check` **真实退出码 0**（`tests 4027 / pass 4027 / fail 0 / cancelled 0`，`verify-package` 通过），故 `repo-green` **修订为 `passing`**；同一命令在本机 **Node 22** 下退出码 **1**（`fail 0 / cancelled 224`），受控对照证明这是**本机 Node 版本差异**，与被验收文档无关——文档是新增的未跟踪 Markdown，且两次全量构建对 `lib/` 产物**逐字节不变**、对全部被跟踪文件**零改动**。

---

*第三轮（最终轮）验收执行者追加。本轮按任务书写入：`outputs/wechatbot-supplement/verification-report.md`（本节，append-only）、`outputs/runtime/check-node24-verify.log`、`outputs/runtime/check-node22-verify.log`。未修改被验收文档（md5 保持 `3112a8bd0dadef495abcb6ebca4de435`）、未修改仓库任何被跟踪文件、未执行任何 revert 或清理。*
