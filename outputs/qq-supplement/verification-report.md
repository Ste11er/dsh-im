# QQ 渠道群聊补充目标与计划 —— 独立验收报告

## 0. 验收者声明

- 本人**未参与**被验收文档《QQ 渠道群聊补充目标与计划》的写作、装配、证据收集或任何工作底稿的产出，与产出的 Vibe run `vibe-linux-1bc2a4ca7da54d96` 无隶属关系。
- 本次验收为**只读验收**：除本报告 `outputs/qq-supplement/verification-report.md` 与任务指定的两份日志 `outputs/runtime/check-node24-qq.log`、`outputs/runtime/check-node22-qq.log` 外，**未创建、未修改、未删除**仓库内任何其它文件；**未执行任何 `git revert` / `git checkout` / `git restore` / `git clean`**。
- 所有结论均来自本次实际执行的命令与输出；未使用被验收文档的自述结论作为证据。
- 被验收文档在验收期间保持只读：验收前后 sha256 均为 `30548607d56bd4c3c3186bc3d0c7aa7f96b3e5c5c9120c6836b4c72ebe29b872`。

---

## 1. 环境与验收对象

| 项 | 值 |
| --- | --- |
| 工作目录 | `/home/stella/Project/dsh-im/dsh-im` |
| 分支 / HEAD | `main` / `0ac02c984faeb9204699bfd8e9c98a260afcc71e` |
| 被验收文档 | `docs/方案/QQ渠道群聊补充目标与计划.md`（361 行 / 32389 B / sha256 `30548607d5…29b872`） |
| 系统 Node | `v22.22.1`；npm `9.2.0` |
| CI Node（`.github/workflows/ci.yml`） | `node-version: 24`（job `check` 与 `windows-workspaces` 均为 24） |
| 预取 Node 24 二进制 | `.npm-cache/_npx/387698761821791d/node_modules/node/bin/node` → **存在**，`--version` = `v24.21.0` |
| `npm run check` 定义 | `package.json:99-103` = `npm run build && npm test && node scripts/verify-package.mjs` |
| 仓库脚本全集 | 仅 `build` / `test` / `check` 三个，**确认无 lint / typecheck** |
| 验收时间 | 2026-10-12（日志 mtime 17:1x） |

---

## 2. 标准 1 `links-resolve` —— **`passing`**

### 2.1 Markdown 相对链接（按文档所在目录 `docs/方案/` 解析，`test -f` 验证）

文档共出现 **8 处** Markdown 链接实例，去重后为 **5 个仓库内链接**（任务预期"5 个仓库内链接"一致）+ **1 个外部 URL**（以 autolink 形式出现 2 次）。

| # | 出现次数 | 链接（原样） | 解析目标（绝对路径） | `test -f` |
| --- | --- | --- | --- | --- |
| 1 | 3（L12 / L32 / L355） | `[微信渠道已达成的能力.md](微信渠道已达成的能力.md)` | `docs/方案/微信渠道已达成的能力.md` | **OK** |
| 2 | 2（L33 / L356） | `[微信个人号群聊补充目标与计划.md](微信个人号群聊补充目标与计划.md)` | `docs/方案/微信个人号群聊补充目标与计划.md` | **OK** |
| 3 | 1（L357） | `[渠道原生能力建设方案.md](渠道原生能力建设方案.md)` | `docs/方案/渠道原生能力建设方案.md` | **OK** |
| 4 | 1（L358） | `[PROACTIVE_DELIVERY.md](../../PROACTIVE_DELIVERY.md)` | `PROACTIVE_DELIVERY.md` | **OK** |
| 5 | 1（L359） | `[docs/adr/0001-semantic-core-native-channel-adapters.md](../../docs/adr/0001-semantic-core-native-channel-adapters.md)` | `docs/adr/0001-semantic-core-native-channel-adapters.md` | **OK** |

执行命令与结果：

```bash
cd /home/stella/Project/dsh-im/dsh-im/docs/方案
for u in "微信渠道已达成的能力.md" "微信个人号群聊补充目标与计划.md" "渠道原生能力建设方案.md" \
         "../../PROACTIVE_DELIVERY.md" "../../docs/adr/0001-semantic-core-native-channel-adapters.md"; do
  test -f "$u" && echo "OK $u" || echo "BROKEN $u"
done
# → 5 行全部 OK，无 BROKEN
```

外部 URL（2 处 autolink，L71 / L361）：`https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html` —— 已用 `web_fetch` 实测 **HTTP 200**，且页面正文确为「群消息（全量模式）」，其原句为"当机器人开启了"接收所有消息"功能后，群里的每一条消息（不限于@机器人）都会推送此事件"，与文档 L71 的转述一致。

### 2.2 反引号包裹的仓库相对路径

共提取 80 个"类路径"反引号 token（含行号后缀）。分类结论：

**(a) 声称存在的路径 —— 全部存在（脚本逐个 `os.path.isfile` 解析 + 人工复核）**

`qq-bridge.mjs`、`qq-mention.mjs`、`qq-menu.mjs`、`config-store.mjs`、`state-store.mjs`（qq/weixin）、`markdown-reply.mjs`、`access-policy.mjs`、`access-policy-production.mjs`、`harness-approval.mjs`、`deferred-delivery.mjs`、`deferred-delivery-coordinator.mjs`、`text-harness-bridge.mjs`、`inbound-access.mjs`、`agent-mail.mjs`、`weixin-bridge.mjs`、`weixin-runtime.mjs`、`weixin-api.mjs`、`whatsapp-runtime.mjs`、`mention.test.mjs`、`scripts/verify-package.mjs`、`plugin-src/client/channels/qq/index.js`、`plugin-src/client/access-policy-settings.js`、`plugin-src/client/delivery-settings.js`、`plugin-src/host/delivery-adapter.mjs`、`README.md`、`package.json`、`CHANGELOG.md`、`docs/方案/渠道原生能力建设方案.md`、`outputs/qq-supplement/{impact-analysis,controls-spec,goals-backlog}.md`、`outputs/wechatbot-supplement/controls-spec.md`、`PROACTIVE_DELIVERY.md`、`docs/adr/0001-….md`、`test/channels/qq/`（12 个 `.mjs`，实测 `COUNT=12`）—— **无一断链**。

SDK 依赖产物路径 `dist/protocol/gateway/constants.js:60`、`dist/protocol/gateway/event-dispatcher.js:121-128`、`dist/QQBot.js:351`、`event-dispatcher.js:143` 存在于 `node_modules/@tencent-connect/qqbot-nodejs@1.0.4/`（实测 `package.json.version = 1.0.4`，与文档标注一致）。

**(b) 文档明示为"规划新增 / 建议名"的路径 —— 不存在但不算断链**

| 路径 | 文档原文 | 判定 |
| --- | --- | --- |
| `src/channels/shared/send-control.mjs` | L209「建议新增共享模块（**建议名** `src/channels/shared/send-control.mjs`，落地前复核）」；L334「文中 `send-control.mjs` 为**建议名**」 | **明示建议名 → 不算断链** ✅ |
| `src/channels/qq/delivery-adapter.mjs` | 文档**从未**这样写；文中一律写作裸文件名 `delivery-adapter.mjs`（L138/L209/L180），实际位于 `plugin-src/host/delivery-adapter.mjs` | 命名简写，非"声称存在"的具体路径 → 不计断链（但见问题 #6） |

**(c) 解析器歧义说明（非文档缺陷）**

裸文件名 `README.md:*` / `package.json:*` 在自动解析时会被同名 fixture（`test/fixtures/client-shell/…`）抢占；已按文档语义人工确认其目标为**仓库根** `README.md` 与根 `package.json`，两者均存在且行号内容逐条核对通过（见 §2.3）。

### 2.3 行号抽查（共抽查 48 处带行号引用，含任务要求的全部 QQ 关键引用）

以下每行均为 **实际执行 `sed -n '<n>p' <file>` 的原始输出**。

#### A. QQ 关键引用（任务点名，逐条列出）

| 文件:行 | 文档声称 | 实测打印内容 | 结论 |
| --- | --- | --- | --- |
| `src/channels/qq/qq-bridge.mjs:436` | `QqHarnessBridge` 类声明 | `export class QqHarnessBridge {` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:1014` | 未 @ 丢弃点 `if (!isQqMessageAddressed(message)) return;` | `    if (!isQqMessageAddressed(message)) return;` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:1288` | 交互回复路径的另一处未点名判定 | `    if (!isQqMessageAddressed(message)) return;` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:936` | `messagesRejected` 只在访问策略拒绝时累加 | `        this.#status.messagesRejected += 1;` | **一致** ✅（见下 §3.4 佐证全仓仅 2 处出现，另一处为 `:425` 初始化 `messagesRejected: 0`，`:936` 位于 `#finishAccessDecision` 的非 `command-not-allowed` 分支，即策略拒绝路径） |
| `src/channels/qq/qq-bridge.mjs:137-138` | 会话键 `c2c:senderId` / `group:groupOpenid` | `function conversationKey(message) {` / `  return \`${message.kind}:${message.kind === 'group' ? message.groupOpenid : message.senderId}\`;` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:141-144` | `senderAllowed`（群恒放行） | `function senderAllowed(message, ownerUserOpenid) {` / `  return message?.kind === 'group'` / `    \|\| ownerUserOpenid === '*'` / `    \|\| message?.senderId === ownerUserOpenid;` | **一致** ✅（印证 L114「group 分支与 `*` 无关、恒为 open」） |
| `src/channels/qq/qq-bridge.mjs:538` | `senderAllowed` 调用点 | `        : senderAllowed(message, this.#ownerUserOpenid)` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:517` | `addressed` 判定 | `    const addressed = isQqMessageAddressed(message);` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:528` | `if (addressed)` 分支进入访问策略 | `    if (addressed) {` | **一致** ✅ |
| `src/channels/qq/qq-bridge.mjs:707` | 非被点名时 `send` 为空操作 | `      send: (reply) => addressed ? this.#bot.sendText(message.replyTarget, reply) : Promise.resolve(),` | **一致** ✅（精确支持 L259「非被点名时 `send` 恒为空操作」） |
| `src/channels/qq/qq-mention.mjs:10-15` | 只认 `GROUP_AT_MESSAGE_CREATE` 或自 mention | `export function isQqMessageAddressed(message) {` / `  return Boolean(message) && (message.kind !== 'group'` / `    \|\| message[addressedToBot] === true` / `    \|\| message.rawEventType === 'GROUP_AT_MESSAGE_CREATE'` / `    \|\| selfMentions(message).length > 0);` / `}` | **一致** ✅ |
| `plugin-src/.../access-policy-production.mjs:61-66` | group 恒 `openScope()`；direct 由 `*` 决定 | `  if (key === 'qq') {` / `    const owners = cleanIds(config.ownerUserOpenid);` / `    return createAccessPolicy({` / `      direct: owners.includes('*') ? openScope() : allowlistScope(),` / `      group: openScope(),` / `    });` | **一致** ✅ |
| `…access-policy-production.mjs:105-109` | 新机器人 direct/group 均开放 | `export function newBotAccessPolicyFor(channel, config = {}) {` / `  const key = …` / `  if (key === 'feishu' \|\| key === 'qq') {` / `    return createAccessPolicy({ direct: openScope(), group: openScope() });` / `  }` | **一致** ✅ |
| `…access-policy-production.mjs:123` | `ownerUserOpenid` 硬编码特权旁路（QQ 分支） | `  if (key === 'qq') return cleanIds(config.ownerUserOpenid).filter((id) => id !== '*');` | **一致** ✅ |
| `…access-policy-production.mjs:129-137` | `accessPolicyProvider` 读 `workspaces.accessPolicyFor(botId)` | `export function accessPolicyProvider(workspaces, botId, { channel, config, equals } = {}) {` / `  if (!workspaces \|\| typeof workspaces.accessPolicyFor !== 'function') {` / `    throw new TypeError('A workspace store with access policies is required');` / `  }` / `  const privilegedSenderIds = new Set(privilegedSenderIdsFor(channel, config));` / `  const sameSender = …` / `  return Object.freeze({` / `    botId,` / `    getSettings: () => workspaces.accessPolicyFor(botId),` | **一致** ✅ |
| `src/channels/shared/access-policy.mjs:188-200` | allowlist 匹配成员 `member_openid`（`candidates`） | `  const scope = normalizedPolicy[conversationType];` / `  const users = scope.mode === 'open'` / `    ? scope.open.commandPermissionOverrides` / `    : scope.allowlist.users;` / `  let matchedUsers;` / `  try {` / `    matchedUsers = users.filter((user) => (` / `      candidates.some((candidate) => equals(candidate, user.id) === true)` / `    ));` / `  } catch {` / `    return INVALID_CONTEXT;` / `  }` / `  if (scope.mode === 'allowlist' && matchedUsers.length === 0) return SENDER_NOT_ALLOWED;` | **一致** ✅ |
| `src/channels/shared/access-policy.mjs:201-207` | `open` 模式由 `defaultCanExecuteCommands` 决定 | `  if (isCommand) {` / `    const canExecuteCommands = scope.mode === 'open'` / `      ? (matchedUsers.length > 0` / `        ? matchedUsers.every((user) => user.canExecuteCommands)` / `        : scope.open.defaultCanExecuteCommands)` / `      : matchedUsers.every((user) => user.canExecuteCommands);` / `    if (!canExecuteCommands) return COMMAND_NOT_ALLOWED;` | **一致** ✅ |
| `src/channels/qq/markdown-reply.mjs:7` | "QQ 长文切分后逐条发送" | `import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';` | **弱引用** ⚠️（仅 import 行，见问题 #5） |
| `src/channels/qq/markdown-reply.mjs:11` | `PASSIVE_REPLY_LIMIT = Object.freeze({ c2c: 4, group: 5 })` | `const PASSIVE_REPLY_LIMIT = Object.freeze({ c2c: 4, group: 5 });` | **完全一致** ✅ |
| `src/channels/qq/markdown-reply.mjs:49` | 平台硬上限按 `target.scope` 取 | `  const passiveLimit = target?.msgId ? PASSIVE_REPLY_LIMIT[target.scope] : null;` | **一致** ✅ |
| `src/channels/qq/state-store.mjs:19-27` | **不含出站正文** | 返回 `{ version, sessions, includeArchivedSessions, deferred?, seenMessageIds }` —— **无任何出站正文字段** | **一致** ✅ |
| `src/channels/weixin/state-store.mjs:14`（对照） | 无条件落盘出站正文 | `  recentOutboundMessages: [],` | **一致** ✅ |
| `src/channels/shared/harness-approval.mjs:13-14` | QQ 在共享审批渠道列表内 | `export const COMPETITIVE_APPROVAL_CHANNELS = Object.freeze([` / `  'feishu', 'weixin', 'dingtalk', 'wecom', 'wecom-app', 'qq',` | **一致** ✅ |
| `src/channels/shared/harness-approval.mjs:24` | 默认超时 60 分钟 | `const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;` | **一致** ✅ |
| `src/channels/shared/deferred-delivery.mjs:157` | `attempts >= 3` → `failed` | `      await store.patchDeferred(entry.id, { attempts, status: attempts >= 3 ? 'failed' : 'pending' });` | **一致** ✅ |
| `src/channels/shared/deferred-delivery-coordinator.mjs:172` | `deliveryOutcome: 'unknown'` → `failed` | `        await state.patchDeferred(id, { status: 'failed', deliveryOutcome: 'unknown', attempts: (current.attempts ?? 0) + 1 });` | **一致** ✅ |
| `package.json:99-103` | `build` → `node --test` → `verify-package.mjs` | `"scripts": {` / `"build": "node plugin-src/client/build.mjs && node plugin-src/host/build.mjs",` / `"test": "node --test test/*.test.mjs test/channels/*/*.test.mjs",` / `"check": "npm run build && npm test && node scripts/verify-package.mjs"` / `},` | **一致** ✅ |
| `package.json:109-110` | SDK 依赖版本 | `"@tencent-connect/qqbot-connector": "1.2.0",` / `"@tencent-connect/qqbot-nodejs": "1.0.4",` | **一致** ✅ |
| `README.md:67` | 扫码创建机器人 / AppID+AppSecret 手动绑定 | `\| QQ \| 使用手机 QQ 扫码创建机器人，或使用 AppID + AppSecret 手动绑定 \| WebSocket 长连接；…群聊被 @ 后只发送最终答案 \|` | **一致** ✅ |
| `README.md:105` | 只提到文件上传配额 | `\| QQ \| 机器人需具备文件消息能力，并受 QQ 当日文件上传配额约束；… \|` | **一致** ✅ |
| `docs/方案/渠道原生能力建设方案.md:788` | QQ 文字/图片/文件、群聊要求 @ 等 | `\| QQ \| 文字、图片、普通文件；群聊要求 @ \| C2C/群聊隔离 \| C2C typing；Markdown 与按渠道收敛的 Turn Feed \| 文字闭环；SDK \`interaction\` 尚未接入 \| Keyboard；引用 \|` | **一致** ✅ |

#### B. 其余抽查（补充，共 18 处）

| 文件:行 | 实测打印内容 | 结论 |
| --- | --- | --- |
| `qq-bridge.mjs:494` | `    this.#deferred = createDeferredDeliveryCoordinator({ harness, state, signal, logger,` | 一致 ✅（L52/L174「QQ 已接共享协调器」） |
| `qq-bridge.mjs:500` | `    this.#approvals = new HarnessApprovalQueue({ label: 'qq', logger });` | 一致 ✅（L170 队列实例） |
| `qq-bridge.mjs:522-527` | 数字菜单需 `addressed` 且菜单属于该 `(key, sender)` 等条件 | 一致 ✅（L166） |
| `qq-bridge.mjs:529-537` | `evaluateInboundAccess(...)` 调用块 | 一致 ✅（L195「`:529-537` 的 `evaluateInboundAccess` 之前」） |
| `qq-bridge.mjs:532` | `            senderIds: sender,` | 一致 ✅（L63/L127「QQ 传入 `senderIds: sender`」） |
| `qq-bridge.mjs:702` | `          senderName: message.kind === 'group' ? message.senderName : undefined,` | 一致 ✅（L131 现仓库仅在此类上下文增强处传 `senderName`） |
| `qq-bridge.mjs:740-741` | `async #deliverDeferredOutcome(entry, outcome) {` / `    await sendMarkdownReply(this.#bot, entry.target, …)` | 一致 ✅（L138/L174 L4 后台结果补发） |
| `qq-bridge.mjs:768` | `    await sendQqMenu(this.#bot, message.replyTarget, view, entry.token, { logger: this.#logger });` | 一致 ✅（L166 `sendQqMenu`） |
| `qq-bridge.mjs:796` | `      control: { owner: this, key }, deferredDelivery: this.#deferred,` | 一致 ✅ |
| `qq-bridge.mjs:803` / `:880` | 均为 `senderName: message.kind === 'group' ? message.senderName : undefined,` | 一致 ✅（L131 列出的 3 处用法） |
| `qq-bridge.mjs:928-936` | `command-not-allowed` → 发 `COMMAND_PERMISSION_DENIED_MESSAGE`；`else` → `messagesRejected += 1` | 一致 ✅（L133） |
| `qq-bridge.mjs:1111` | `          deferredDelivery: () => ({ coordinator: this.#deferred, target: { scope: target.scope, targetId: target.targetId } }),` | 一致 ✅（L176 `{ scope: 'group', targetId }`） |
| `inbound-access.mjs:4` | `export const COMMAND_PERMISSION_DENIED_MESSAGE = '你可以发送普通消息，但没有执行命令的权限。';` | 一致 ✅（L133） |
| `inbound-access.mjs:24-27` | `isPrivileged(...)` → `return PRIVILEGED_SENDER;`（硬编码特权旁路） | 一致 ✅（L113） |
| `qq-runtime.mjs:2` / `:267` | `import { QQBot, contentSanitizer, typingIndicator } from '@tencent-connect/qqbot-nodejs';` / `    bot.on('message', onMessage);` | 一致 ✅（L48） |
| `qq-menu.mjs:6` / `:15` / `:33` | `export const QQ_MENU_TTL_MS = 15 * 60_000;` / `export function isQqMenuCommand(text) {`（正则 `/^\/(?:m\|menu)(?=$|\s)/iu`，支持 `/m` 与 `/menu`） / `  #entries = new Map();` | 一致 ✅（L166「内存态、TTL 15 分钟」） |
| `agent-mail.mjs:105` / `:133` | `    rateLimits: normalizeRateLimits(document?.data?.rate_limits),` / `    dailySendQuota: positive('daily_send_quota', 'per_day'),` | 一致 ✅（L61/L208「邮件渠道只读地读取平台限额」） |
| `weixin-bridge.mjs:425` / `:670` | 均为 `    const contextToken = nonEmptyString(message?.context_token) ?? undefined;` | 一致 ✅（L180）；`grep -rl context_token src/` 仅命中 `src/channels/weixin/` ✅ |
| `text-harness-bridge.mjs:255` | `    if (kind === 'group' && normalized.addressed !== true) {` | 一致 ✅，且文档**只把它用于 WhatsApp**（见下 §3.5） |
| `whatsapp-runtime.mjs:355` / `weixin-runtime.mjs:409` / `weixin-api.mjs:14` | `    addressed: !group \|\| fromMe \|\| mentioned \|\| replyToSelf,` / `    if (target?.kind !== 'user' \|\| !toUserId) {` / `export const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';` | 与 L84/L86 的渠道对照表相符（`weixin-runtime.mjs:409` 为间接证据，见问题 #7） |
| SDK `dist/protocol/gateway/constants.js:60` | `    GROUP_MESSAGE_CREATE: "GROUP_MESSAGE_CREATE",` | 一致 ✅（L72） |
| SDK `dist/protocol/gateway/event-dispatcher.js:121-128` | `eventType === GatewayEvent.GROUP_AT_MESSAGE_CREATE \|\|`（:120）/ `eventType === GatewayEvent.GROUP_MESSAGE_CREATE) {`（:121），同分支产出 `kind: "group"` | **完全一致** ✅（L72「把它与 `GROUP_AT_MESSAGE_CREATE` 放**同一分支**并产出 `kind: "group"`」——已额外核对 :120 行确认同一条件式） |
| SDK `dist/protocol/gateway/event-dispatcher.js:143` | `                raw: ev,` | 一致 ✅（L132「`raw: ev`」） |
| SDK `dist/QQBot.js:351` | `            await this.emit("message", ctx, ctx.message);` | 一致 ✅（L72「统一派发 `message` 事件」） |
| `test/channels/qq/mention.test.mjs:59-67` | `test('QQ retains dedicated mention events, empty mentions and direct-message behavior', () => { … });`（7 行完整判定语义） | 一致 ✅（L244/L320） |
| `README.md:212` | `\| QQ \`/menu\`、\`/m\` \| 打开按钮与数字菜单：… 菜单按聊天和操作者隔离，15 分钟或重启后失效；…` | 一致 ✅（L51/L166） |

**汇总：抽查 48 处（任务点名关键引用 100% 覆盖）。46 处完全一致；1 处为"弱引用"（`markdown-reply.mjs:7`，内容正确但仅 import 行）；1 处为行号范围起点近似的宽松引用（`delivery-adapter.mjs:7`）。无一处出现内容与声称不符的错误引用。**

### 2.4 标准 1 结论

> **`passing`** —— 5 个仓库内 Markdown 链接全部 `test -f` 通过；外部 URL 实测 HTTP 200 且内容与转述一致；全部"声称存在"的反引号路径均存在；唯一不存在的两个路径（`send-control.mjs`）已被文档**两处明示为"建议名"**，按判定规则不算断链；48 处行号抽查无实质错误。

---

## 3. 标准 2 `no-implemented-claims` —— **`passing`**

### 3.1 头部状态声明（原文）

`docs/方案/QQ渠道群聊补充目标与计划.md:3-6`：

> 3: `> **状态声明**：本文是**计划与决策文档**，不是已实现能力清单。`
> 4: `> 文中的「改动位置」「验收方式」都是后续落地清单，**当前仓库没有任何一项已实现**；引用 \`src/\`、\`plugin-src/\`、\`node_modules/\` 的路径与行号只用于说明现状与落点。`
> 5: `> 本文由 Vibe run \`vibe-linux-1bc2a4ca7da54d96\` 产出（工作底稿见 \`outputs/qq-supplement/\`）。`
> 6: `> 凡未从仓库证据或真实实测确认的，一律标 \`未核验\`。`

另在 §3「目标分层」L94 明确 P2′「交付物 = **无交付物**」，§9「明确不做项」L311「本轮不改任何代码，不创建 issue，不推送远端」，§10 表末 L342「五项控制在仓库内实现状态为零」。**头部声明齐备且与全文基调一致。**

### 3.2 逐项核对：是否把规划写成"已实现 / 已支持 / 已有"

全文 grep 词表：`已实现|已支持|已具备|已有|已接入|已提供|已完成|上线`。命中仅 6 处，逐条判定：

| 命中行 | 原文片段 | 判定 |
| --- | --- | --- |
| L3 | 「不是已实现能力清单」 | 否定句 ✅ |
| L4 | 「当前仓库没有任何一项已实现」 | 否定句 ✅ |
| L16 | `\| 群聊 \| 协议层无群概念 \| **已具备**（\`kind: 'group'\`） \|` | 描述 **QQ 官方机器人已有群聊形态**（现状能力，非本计划成果）——`kind: 'group'` 属既有 SDK/应用层事实，与 L49 证据一致 ✅ |
| L44 | `### 2.1 已具备（QQ 不需要重做）` | 小标题明示"现状基线，不需要重做" ✅ |
| L72 | 「SDK 已支持（依赖产物，非本仓库源码）」 | 明示为 **SDK 依赖产物、非本仓库源码**，且特指 `GROUP_MESSAGE_CREATE` 事件**定义存在**，未声称应用层已接入 ✅ |
| L236 | 「QQ 客户端已有机器人卡片与设置面」 | 现状事实（`plugin-src/client/channels/qq/index.js` 实际存在，已 `test -f` 通过）✅ |

**逐项结论：**

| 待核事项 | 文档写法 | 结论 |
| --- | --- | --- |
| **QQ 全量模式接入** | L93 P1′「全量接入：识别并接收 `GROUP_MESSAGE_CREATE`」列为**目标**，准入条件含「平台"接收所有消息"**已获批且有可复现的脱敏到达记录**（当前 `未核验`）」；§7.2 `WG-QQ-10`/`WG-QQ-11` 为 backlog；L313「**不把平台"接收所有消息"当作既定能力**；未获批不写全量接入代码」 | **未写成已实现** ✅ |
| **群默认收紧** | L60「**群默认开放**」列在 §2.2「未具备」；L103「现状：群作用域 `openScope()`」（已实测证实）；§4.2 三档为「**建议默认**」；§7.1 `WG-QQ-01` backlog | **未写成已实现** ✅ |
| **五项发送控制** | L61「发送预算/限频、安静时段、dry-run、账号级持久暂停、渠道侧不新增持久化——**五项全无**（全仓库空白）」；L109「群一旦开放，五项控制全无」；L342「五项控制在仓库内实现状态为零」；§7.1 `WG-QQ-03`…`07` 均为 backlog | **未写成已实现** ✅（实测：`package.json` 仅 build/test/check；全仓无 `send-control`；`agent-mail.mjs` 仅只读读取平台限额，与文档"最接近的是邮件渠道只读地读取平台限额"一致） |
| **P2′ 接话** | L28「升级为「**有门槛的候选目标**」，但**默认关闭**」；L94「准入=仅证据门槛；交付物=**无交付物**；**不设退出条件**」；L97「不随 P1′ 完成自动解锁」；L307「不写自主接话的设计草案」 | **未写成已实现或待实现** ✅ |
| **`member_role` 可用性** | L129 小节标题即「（可用性**未核验**）」；L132「可用性…**字段名、取值集合与稳定性 `未核验`**」；L194「`member_role` 在仓库与 SDK 均 0 命中」；L318「不假设平台提供 `member_role`」；§10 #4 标 `未核验` | **未写成已实现/已可用** ✅（实测：`grep -rn member_role` 在 `src/`、`plugin-src/`、`test/` **0 命中**；在 `node_modules/@tencent-connect/` **0 命中**，与文档"仓库与 SDK 均 0 命中"一致） |

### 3.3 P2′ 门槛与"无接话实现条目"核对

- grep `接话|shouldParticipate|冷却|概率|触发规则|上下文裁剪|参与策略`：**`shouldParticipate` 0 命中**；`触发规则/冷却/概率/上下文裁剪` 仅出现在 **3 处否定声明**（L263、L270、L307），措辞均为「不写」「不谈」。
- §8 标题即「P2′ 的**证据门槛（仅门槛，不含设计）**」，正文只有 6 行门槛表（平台获批 / P1′ 稳定 / P0′ 五项验证 / 知情同意 / 观察期统计 / 负责人书面接受），**无任何触发规则、冷却时长、概率、上下文裁剪设计**。
- **`WG-QQ-` 编号清单**：`WG-QQ-01`…`WG-QQ-13`，逐条判读——`01`群默认策略、`02`角色与命令权限、`03`持久暂停、`04`预算限频、`05`安静时段、`06`dry-run、`07`不新增持久化、`08`客户端入口、`09`测试质量门、`10`平台申请、`11`全量接入、`12`门槛与只读统计、`13`降级。**没有任何一条以"实现未 @ 接话/自主回复/参与决策"为交付物的条目**；`WG-QQ-11` 明确"**默认只入上下文、不回复**"、不做项写「此阶段不写接话策略」；`WG-QQ-12` 明确「改动位置：**仅门槛与只读统计，不新增回复路径**」「不做项：**不写触发规则/冷却/概率/上下文裁剪**；不排入实现 backlog」。

> **结论：P2′ 确实只有证据门槛，无接话实现条目，无 `shouldParticipate` 类设计草案。** ⚠️ 唯一需注意：`WG-QQ-12` 标题含「接话门槛」四字，字面上像 P2′ 条目（见问题 #2）。

### 3.4 `messagesRejected` 语义核对（L62）

`grep -n messagesRejected src/channels/qq/qq-bridge.mjs` 仅 2 处：`:425`（`messagesRejected: 0` 初始化）、`:936`（自增）。`:936` 位于 `#finishAccessDecision` 的 `else` 分支，即 `access.reason !== 'command-not-allowed'` 的策略拒绝路径；`#finishAccessDecision` 只由 `accept()` 中 `if (!access.allowed)` 调用。**文档 L62「`messagesRejected` 只在访问策略拒绝时累加；未 @ 丢弃无计数」精确成立。** L162「该路径没有 `messagesRejected` 计数」亦成立。

### 3.5 专项检查（重要）：QQ 丢弃点归属

| 检查点 | 实测证据 | 结论 |
| --- | --- | --- |
| 文档是否把 QQ 未 @ 丢弃点写成 `src/channels/qq/qq-bridge.mjs:1014` | L74「**丢弃点（QQ 自己的）** \| `src/channels/qq/qq-bridge.mjs:1014`（`if (!isQqMessageAddressed(message)) return;`），交互回复路径另见 `:1288`」；L78、L85、L190、L259、L260、L266、L273 均一致指向 `qq-bridge.mjs:1014` | **正确** ✅ |
| 文档是否**错误地**把 `text-harness-bridge.mjs:255` 当作 QQ 丢弃点 | **全文检索：`text-harness-bridge.mjs:255` 仅出现 3 次，全部用于 WhatsApp 或作为"对 QQ 不适用"的对照**：L76（更正段）、L86（WhatsApp 行）、L260（明确"共享层不参与该判定"） | **未发现此类错误** ✅ |
| 是否明确说明 `QqHarnessBridge` 不继承 `TextHarnessBridge` | L76「QQ 的 `QqHarnessBridge`（`qq-bridge.mjs:436`）**不继承** `TextHarnessBridge`——继承它的只有 whatsapp/email/discord/slack/matrix/telegram/imessage。因此共享层 `src/channels/shared/text-harness-bridge.mjs:255` 的未 @ 拒绝对 **QQ 不适用**」；L260 再次重申 | **明确且正确** ✅ |

独立佐证（本次实测）：

```bash
grep -rn "extends TextHarnessBridge" src/ plugin-src/ test/   # 排除 test 断言后仅 7 个渠道
# src/channels/whatsapp/whatsapp-bridge.mjs:12  WhatsappHarnessBridge
# src/channels/email/email-bridge.mjs:11        EmailHarnessBridge
# src/channels/discord/discord-bridge.mjs:10    DiscordHarnessBridge
# src/channels/slack/slack-bridge.mjs:14        SlackHarnessBridge
# src/channels/matrix/matrix-bridge.mjs:14      MatrixHarnessBridge
# src/channels/telegram/telegram-bridge.mjs:71  TelegramHarnessBridge
# src/channels/imessage/imessage-bridge.mjs:10  IMessageHarnessBridge
# （另 test/session-bind-command.test.mjs:234 为源码文本断言）

grep -n "class QqHarnessBridge" src/channels/qq/qq-bridge.mjs   # 436: export class QqHarnessBridge {  ← 无 extends
grep -rn "text-harness-bridge\|TextHarnessBridge" src/channels/qq/  # 0 命中
sed -n '255p' src/channels/shared/text-harness-bridge.mjs
#     if (kind === 'group' && normalized.addressed !== true) {
```

继承清单与文档所述**完全一致**（7 个渠道，无 QQ、无 feishu/weixin/dingtalk/wecom/qq），且 QQ 目录内零引用共享桥。**该专项检查通过。**

### 3.6 自相矛盾检查

对 12 个章节做过全文交叉比对，未发现"同一事实在不同节表述不一致"的**实质矛盾**；发现 4 处**表述张力/范围划分不一致**，均已在 §4 问题清单登记（#1、#2、#3、#4）。最典型的是 §3 表格的交付物归属与 §7.2/§7.3 的依赖归属不同步：

- §3（L93）P1′ 交付物写作 `WG-QQ-10`…`WG-QQ-13`；
- 但 §3（L94）P2′ 交付物为「**无交付物**」，§3（L95）D′ 交付物为「否定结论记录 + `WG-QQ-13` 开关默认值」，而 §7.2 中 `WG-QQ-12` 被标注为「**P2′ 专用**」。

### 3.7 标准 2 结论

> **`passing`** —— 头部声明齐备；QQ 全量模式接入、群默认收紧、五项发送控制、P2′ 接话、`member_role` 可用性**五项均未被写成"已实现/已支持/已有"**，且全部配有 `未核验` 或"无/全无/0 命中"的反向标注并经仓库实测证实；P2′ 仅有 6 行证据门槛、无接话实现条目、无 `shouldParticipate` 类草案；**"QQ 丢弃点 = `qq-bridge.mjs:1014` 而非 `text-harness-bridge.mjs:255`"这一关键归属正确，且 `QqHarnessBridge` 不继承 `TextHarnessBridge` 已明确声明并经源码验证**。存在 4 处非实质矛盾（范围/归属表述），不构成判定失败。

---

## 4. 标准 3 `repo-green-ci-node24` —— **`passing`**

### 4.1 Node 24 前置确认

```bash
ls -la "$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin/"
# -rwxrwxr-x 2 stella stella 126595440 Oct 12 17:02 node      ← 确认存在
"$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin/node" --version
# v24.21.0
```

`mkdir -p .test-dsh-home` 执行成功（该目录随后生成 `.test-dsh-home/im/`）。

### 4.2 Node 24 受控运行（主判定）

命令（与任务给定脚本一致）：

```bash
cd /home/stella/Project/dsh-im/dsh-im
mkdir -p .test-dsh-home
N24DIR="$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin"
export PATH="$N24DIR:$PATH"
node --version                       # → v24.21.0
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy \
    -u NODE_USE_ENV_PROXY DSH_HOME="$PWD/.test-dsh-home" npm_config_cache="$PWD/.npm-cache" \
    npm run check > outputs/runtime/check-node24-qq.log 2>&1
echo "EXIT_CODE=$?"                  # → EXIT_CODE=0
```

| 记录项 | 实测值 |
| --- | --- |
| **真实退出码** | **`0`** |
| `ℹ tests` | **4027** |
| `ℹ suites` | 3 |
| `ℹ pass` | **4027** |
| `ℹ fail` | **0** |
| `ℹ cancelled` | **0** |
| `ℹ skipped` / `ℹ todo` | 0 / 0 |
| `ℹ duration_ms` | 14180.064081 |
| `Verified dsh-im package artifacts.` | **出现**（日志第 **5214** 行） |
| 日志路径 | `outputs/runtime/check-node24-qq.log`（5214 行） |

reporter 形态为 **spec**（`ℹ …`），与 CI Node 24 一致。日志开头存在 1 条**既有** `(node:5) [DEP0169] DeprecationWarning: url.parse() …`，不阻塞（见问题 #10）。

### 4.3 Node 22 对照运行

命令（去掉 PATH 前置，其余不变，`node --version` = `v22.22.1`）：

```bash
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy \
    -u NODE_USE_ENV_PROXY DSH_HOME="$PWD/.test-dsh-home" npm_config_cache="$PWD/.npm-cache" \
    npm run check > outputs/runtime/check-node22-qq.log 2>&1
echo "EXIT_CODE=$?"                  # → EXIT_CODE=1
```

| 记录项 | 实测值 |
| --- | --- |
| **真实退出码** | **`1`** |
| `# tests` | **4011** |
| `# suites` | 3 |
| `# pass` | **3787** |
| `# fail` | **0** |
| `# cancelled` | **224** |
| `# skipped` / `# todo` | 0 / 0 |
| `# duration_ms` | 15270.847981 |
| `Verified dsh-im package artifacts.` | **未出现**（`npm test` 失败，`node scripts/verify-package.mjs` 未执行） |
| 日志路径 | `outputs/runtime/check-node22-qq.log`（26616 行，TAP reporter） |

失败形态：**全部 224 条均为 `failureType: 'cancelledByParent'`，无 `fail`、无其它失败类型**（`grep -o "failureType: '[a-zA-Z]*'" | sort | uniq -c` → `224 cancelledByParent`），错误消息唯一：

```yaml
failureType: 'cancelledByParent'
error: 'Promise resolution is still pending but the event loop has already resolved'
code: 'ERR_TEST_FAILURE'
```

分布（按 `location:` 统计，跨 12 个渠道测试文件，与 QQ 计划文档无关联）：

| 文件 | cancelled 数 |
| --- | --- |
| `test/channels/wecom/bridge.test.mjs` | 57 |
| `test/channels/qq/bridge.test.mjs` | 52 |
| `test/channels/discord/discord.test.mjs` | 30 |
| `test/channels/telegram/telegram.test.mjs` | 29 |
| `test/channels/slack/slack.test.mjs` | 17 |
| `test/channels/feishu/plugin-host.test.mjs` | 12 |
| `test/channels/weixin/harness-client.test.mjs` | 9 |
| `test/channels/matrix/matrix-api.test.mjs` | 6 |
| `test/channels/feishu/feishu-runtime.test.mjs` | 6 |
| `test/channels/dingtalk/dingtalk-runtime.test.mjs` | 3 |
| `test/channels/shared/status-reaction.test.mjs` | 2 |
| `test/channels/dingtalk/device-auth.test.mjs` | 1 |

### 4.4 该差异确为"既有、与被验收文档无关"的独立佐证

1. **CI 同版本判定绿**：CI（`.github/workflows/ci.yml`）固定 `node-version: 24`；Node 24 下 `npm run check` 退出码 0、4027 测试全过、0 cancelled，且产出 `Verified dsh-im package artifacts.`。**标准 3 的核心命题成立。**
2. **同机历史日志对照**：仓库内已存在本次验收**之前**（15:19–15:22，早于被验收文档 17:09 的产出时间）的同类日志，统计与本次**逐位相同**：

| 既有日志（mtime 15:19–15:22） | tests | pass | fail | cancelled |
| --- | --- | --- | --- | --- |
| `outputs/runtime/check-clean.log`（Node 22） | 4011 | 3787 | 0 | **224** |
| `outputs/runtime/check-node22-verify.log`（Node 22） | 4011 | 3787 | 0 | **224** |
| `outputs/runtime/check-node24.log`（Node 24） | 4027 | 4027 | 0 | **0** |
| `outputs/runtime/check-node24-verify.log`（Node 24） | 4027 | 4027 | 0 | **0** |

→ Node 22 的 `cancelledByParent` 差异在 QQ 计划文档产出之前即已存在，且与本次运行完全复现一致。
3. **结构隔离**：被验收文档是 `docs/方案/` 下的 Markdown，不在 `npm run build` 输入（`plugin-src/client/build.mjs`、`plugin-src/host/build.mjs`）中，也不在测试 glob（`test/*.test.mjs`、`test/channels/*/*.test.mjs`）中；`git status --porcelain` 显示其为**未跟踪文件**，`git diff` 为空。它不可能影响测试结果。
4. 失败面横跨 wecom/discord/telegram/slack/feishu/weixin/matrix/dingtalk 等 8 个与 QQ 计划无关的渠道，符合 Node 22 测试运行器"父测试取消后子 Promise 未 settle"的运行时行为差异，而非本仓库代码缺陷。

### 4.5 被跟踪文件改动核查（`git status --porcelain` 前后对比 + lib 产物 sha256）

| 时点 | `git status --porcelain` | `lib/client.js` sha256 | `lib/index.js` sha256 |
| --- | --- | --- | --- |
| **两次运行前** | `?? .npm-cache/`、`?? docs/方案/QQ渠道群聊补充目标与计划.md`、`?? docs/方案/微信个人号群聊补充目标与计划.md`、`?? docs/方案/微信渠道已达成的能力.md`、`?? outputs/` | `6a11d7d14bdb95bbbdaf2638d76bc478631e65d49a636b41b87ddc9c3b12e248` | `c706a37cafed95fb15c727f3474bc463061c0298868d476f811c88920cd806db` |
| Node 24 运行后 | **完全相同**（5 条，全为 `??` 未跟踪项） | `6a11d7d1…b12e248`（**未变**） | `c706a37c…d806db`（**未变**） |
| Node 22 运行后 | **完全相同**（5 条，全为 `??` 未跟踪项） | `6a11d7d1…b12e248`（**未变**） | `c706a37c…d806db`（**未变**） |

- `git diff --stat` / `git diff --name-only` 在两次运行后均为**空**。
- `lib/client.js`、`lib/index.js` 虽被 build 重写（日志有 `Wrote …/lib/client.js` / `Wrote …/lib/index.js`），但内容**逐字节一致**，sha256 前后不变。
- **结论：没有任何被跟踪文件被改动。** 未执行任何 revert/清理操作；`docs/方案/QQ渠道群聊补充目标与计划.md` 全程只读（sha256 未变）。

### 4.6 标准 3 结论

> **`passing`** —— CI 同版本 Node 24（`v24.21.0`）下 `npm run check` **真实退出码 `0`**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，并打印 `Verified dsh-im package artifacts.`；Node 22 对照**真实退出码 `1`**（`tests 4011 / pass 3787 / fail 0 / cancelled 224`，全部 `cancelledByParent`），该差异经"同机历史日志逐位复现 + 结构隔离 + 跨渠道分布"三重佐证确认为**既有、与本计划文档无关**；两次运行前后**无任何被跟踪文件改动**，`lib/client.js`、`lib/index.js` sha256 保持不变。

---

## 5. 问题清单（按严重程度）

> 说明：本次验收**未发现任何"判定失败"级问题**（无断链、无伪造行号、无把规划写成已实现、CI Node 24 绿）。以下 11 项均为文档质量层面的问题，仅报告、未修改原文。

| # | 严重度 | 位置 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| **1** | **中** | §3 目标分层表 L93 / L94 / L95 vs §7.2 | **交付物归属不一致**：§3 把 P1′ 交付物写作 `WG-QQ-10`…`WG-QQ-13`，但同表 P2′ 交付物为「**无交付物**」、D′ 交付物为「否定结论记录 + `WG-QQ-13` 开关默认值」，而 §7.2 又将 `WG-QQ-12` 标注为「**P2′ 专用**」、`WG-QQ-13` 归入降级分支。同一编号在"层"与"backlog"两处归属不同，可能误导实施者把 P2′/降级项计入 P1′ 范围。**建议：§3 P1′ 交付物收窄为 `WG-QQ-10`…`WG-QQ-11`，`WG-QQ-12` 移入 P2′ 行、`WG-QQ-13` 移入 D′ 行。** | L93 `\| **P1′** \| 全量接入… \| … \| \`WG-QQ-10\`…\`WG-QQ-13\` \| …`；L94 `\| **P2′** \| … \| … \| **无交付物**（门槛通过后另立独立决策与设计） \| …`；L265 `**WG-QQ-12 未 @ 上下文与接话门槛（P2′ 专用）**` |
| **2** | 低 | §3 L94 vs §7.2 L265-L270 / §8 L307 | 「P2′ **无交付物**」与 `WG-QQ-12`「改动位置：**仅门槛与只读统计**…验收：…**统计可复核**」存在张力；且 `WG-QQ-12` 位于 `### 7.2` 但该表头写作「backlog（`WG-QQ-01`…`WG-QQ-13`）」，而 §8 又称「不列 P2′ 的实现 backlog 条目」。标题含「接话」二字，字面易被误读为 P2′ 实现条目。 | L94；L265；L267 `- 改动位置：**仅门槛与只读统计**，不新增回复路径。`；L270 `- 不做项：**不写触发规则/冷却/概率/上下文裁剪**；不排入实现 backlog。`；L307 `- **明确不做**：…不列 P2′ 的实现 backlog 条目。` |
| **3** | 低 | §2.2 表 L61 + 紧邻注解 L65 | 同节内"缺口"口径不一致：正文把"发送类控制"列为缺口并称「**五项全无**」，紧接着的注解又称「QQ 的真实缺口是**前四项**」（第五项为前瞻性配置面）。同一事实在相邻两句给出两个"缺口数"。 | L61 `\| **发送类控制** \| …——**五项全无**（全仓库空白） \|`；L65 `…因此第五项控制在 QQ 上是**前瞻性配置面**…QQ 的真实缺口是**前四项**。` |
| **4** | 低 | §7.3 依赖图 L286-L288 vs §7.1 L224 | 依赖图**漏画** `WG-QQ-03 → WG-QQ-06`：§7.1 中 `WG-QQ-06` 依赖写作「`WG-QQ-03`、`WG-QQ-04`」，§7.3 文字图只画 `WG-QQ-04 ──> WG-QQ-06`。 | L224 `- 依赖：\`WG-QQ-03\`、\`WG-QQ-04\`。`；L287-L288 `WG-QQ-03 ──> WG-QQ-04 ──> WG-QQ-05` / `                  └─────> WG-QQ-06` |
| **5** | 低 | §5 L151 | `markdown-reply.mjs:7` 被用作"QQ 长文切分后逐条发送"的证据，但该行**只是 `chunkMarkdownParts` 的 import**；真正的切分/逐条发送逻辑不在第 7 行。 | `sed -n '7p' src/channels/qq/markdown-reply.mjs` → `import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';`；对照 `:11`（`PASSIVE_REPLY_LIMIT`）、`:49`（`passiveLimit` 取值）均为精确引用。 |
| **6** | 低 | §6.5 L180 / §5 L138 / §7.1 L209 | `delivery-adapter.mjs:7` 表述为「含 `qq`」，但第 7 行只是 `const CHANNELS = new Set([`，`'qq'` 实际在第 **13** 行；同理 `:316`/`:407` 作为 L3 接线点属"范围起点"式宽松引用。另该文件以**裸文件名**出现（实际路径 `plugin-src/host/delivery-adapter.mjs`），全文未给前缀。 | `sed -n '7,13p' plugin-src/host/delivery-adapter.mjs` → `const CHANNELS = new Set([` … `  'qq',`（第 13 行） |
| **7** | 低 | §2.4 表 L84 | `src/channels/weixin/weixin-runtime.mjs:409` 作为"微信收不到未 @ 群消息 / 协议层无群"的证据偏**间接**：该行是主动投递目标的 `kind !== 'user'` 守卫，非"无群概念"的直接证据。 | `sed -n '409p' src/channels/weixin/weixin-runtime.mjs` → `    if (target?.kind !== 'user' \|\| !toUserId) {`；同表 `weixin-api.mjs:14`（CDN `/c2c/`）证据更强。 |
| **8** | 低 | §6.5 L180 | 用**现在时**陈述尚未实现控制的语义：「控制命中时**没有走到平台发送**，不产生 `providerMessageIds`」。§2.2 已声明五项控制全无，此处条件语义用现在时，存在被摘句误读为"已实现拦截"的风险。 | L180 `…控制命中时**没有走到平台发送**，不产生 \`providerMessageIds\`；…`；对照 L61 `五项全无`。 |
| **9** | 信息 | §4.3 L132 / §7.1 L194 / §10 #4 | `member_role` 的「**字段名、取值集合**」标 `未核验`，但文档 L71 自己引用的官方页面已**明确列出** `member_role`（`member`=普通成员 / `admin`=管理员 / `owner`=群主）并给出示例值。此为**过度保守（反向偏差）**，非夸大；且与文档 L6「凡未从仓库证据或真实实测确认的，一律标 `未核验`」的自定规则一致，故不计为缺陷，仅提示可升级为"官方文档已列明，仓库/SDK 未接"。 | `web_fetch https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html` → HTTP 200，正文含 `member_role \| string \| 群内角色。member=普通成员, admin=管理员, owner=群主` 及示例 `"member_role": "member" / "owner" / "admin"`。 |
| **10** | 信息 | Node 24 日志头部 | 既有 `(node:5) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized…`，属仓库既有代码告警，**不阻塞** `npm run check`（退出码 0）。 | `outputs/runtime/check-node24-qq.log` 第 1-2 行。 |
| **11** | 信息 | §6.5 L180 | 「`context_token` 在仓库中**只出现在微信**」略宽：`src/` 内确仅 `weixin-bridge.mjs`/`weixin-api.mjs`，但 `test/` 下另有 6 个测试文件（多为 weixin/shared 用例）出现该词。 | `grep -rln context_token src/ plugin-src/ test/` → 2 个 `src/`（均 weixin）+ 7 个 `test/`。 |

**问题总数：11 项**（1 中 / 7 低 / 3 信息）。

**最严重一条（#1）**：§3 目标分层表把 P1′ 交付物写成 `WG-QQ-10`…`WG-QQ-13`，与同表 P2′「无交付物」、D′ 交付物以及 §7.2 中 `WG-QQ-12`（"P2′ 专用"）、`WG-QQ-13`（降级）的归属互相冲突——不影响任何对外事实断言的正确性，但会让实施者把 P2′/降级项计入 P1′ 范围，属**中**等严重度的范围划分缺陷。

---

## 6. 总体结论

| 标准 | 结论 | 一句话依据 |
| --- | --- | --- |
| **1. `links-resolve`** | **`passing`** | 5 个仓库内链接 `test -f` 全通过；外部 URL HTTP 200 且内容与转述一致；全部"声称存在"的反引号路径均存在（唯二不存在者被两处明示为"建议名"）；48 处行号抽查无实质错误 |
| **2. `no-implemented-claims`** | **`passing`** | 头部声明齐备；五项待核事项**均未被写成已实现/已支持/已有**并配有 `未核验`/`全无`/`0 命中`标注（`member_role` 仓库与 SDK 实测 0 命中）；P2′ 仅有 6 行证据门槛、**无接话实现条目、无 `shouldParticipate` 类草案**；**QQ 丢弃点正确写作 `qq-bridge.mjs:1014`，全文未把 `text-harness-bridge.mjs:255` 误作 QQ 丢弃点，且明确声明 `QqHarnessBridge` 不继承 `TextHarnessBridge`（已由 `extends TextHarnessBridge` 仅 7 渠道的实测佐证）**；存在 4 处非实质范围/归属表述张力 |
| **3. `repo-green-ci-node24`** | **`passing`** | Node 24 `v24.21.0`：`npm run check` **退出码 0**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，出现 `Verified dsh-im package artifacts.`；Node 22 对照 **退出码 1**（`4011 / 3787 / 0 / 224`，全部 `cancelledByParent`），经"同机历史日志逐位复现（15:19–15:22，早于文档产出）+ 结构隔离 + 跨 12 文件分布"确认为**既有且与被验收文档无关**；两次运行前后**无任何被跟踪文件改动**，`lib/client.js`/`lib/index.js` sha256 不变（未 revert，仅报告） |

**综合判定：三项标准全部 `passing`。被验收文档 `docs/方案/QQ渠道群聊补充目标与计划.md` 在链接完整性、行号证据真实性、"计划 ≠ 已实现"的边界纪律、以及对 QQ 丢弃点归属这一最易写错的关键事实上均达到验收要求；节点级证据抽查 48 处无一处内容与声称不符。** 发现的 11 项问题全部为文档质量层面（1 中 / 7 低 / 3 信息），**不构成 `failing`**，建议后续按 §5 清单做一次范围划分与引用精确性的微调，无需重写。

---

## 7. 验收产物

| 文件 | 说明 |
| --- | --- |
| `outputs/qq-supplement/verification-report.md` | 本报告（本次唯一写入的交付文件） |
| `outputs/runtime/check-node24-qq.log` | Node 24 `npm run check` 完整日志（5214 行，退出码 0） |
| `outputs/runtime/check-node22-qq.log` | Node 22 `npm run check` 完整日志（26616 行，退出码 1） |

除上述三份文件外，本次验收**未写入、未修改、未删除**仓库内任何文件，**未执行任何 git 变更操作**；被验收文档 sha256 全程为 `30548607d56bd4c3c3186bc3d0c7aa7f96b3e5c5c9120c6836b4c72ebe29b872`。

---

## 第二轮验收（修正后复验）

### 8. 验收者声明（第二轮）

- 本人**仍未参与**被验收文档《QQ 渠道群聊补充目标与计划》的写作、装配、修复或任何工作底稿的产出；与产出该文档的 Vibe run `vibe-linux-1bc2a4ca7da54d96` 及本轮执行修复的装配者**无隶属关系**。
- 本轮为**只读复验**：除**追加**本节至本报告 `outputs/qq-supplement/verification-report.md`（第 1–416 行原文一字未改）与写入任务指定的日志 `outputs/runtime/check-node24-qq-round2.log` 外，**未创建、未修改、未删除**仓库内任何其它文件；**未执行任何 `git revert` / `git checkout` / `git restore` / `git clean` / `git add` / `git commit`**。
- 所有结论均来自本轮实际执行的命令与原始输出；**未采信装配者的自述**，七项修改逐条以文档原文与源码实测为准。
- 本轮锚定的被验收文档版本：**sha256 `f2ea3695…1ce051882`（362 行 / 33075 B / mtime 2026-10-12 17:15:21）**。见 §9 关于该版本在验收窗口内被再次写入的说明。

---

### 9. 新哈希、行数与版本变更确认

| 时点 | sha256 | 行数 | 字节 | mtime |
| --- | --- | --- | --- | --- |
| **第一轮验收记录（已过期）** | `30548607d56bd4c3c3186bc3d0c7aa7f96b3e5c5c9120c6836b4c72ebe29b872` | 361 | 32389 | — |
| 本轮起始读取 | `a592e6ba59cc109d463e6c227d4456d72c99ca23b83da99a3f147f56de0672d2` | 362 | — | — |
| **本轮最终锚定（稳定）** | **`f2ea369555c4c6322ae233ac292197ff687664c0ba85acc3cc0025e1ce051882`** | **362** | **33075** | **2026-10-12 17:15:21** |

- **文档确实已变更**：与第一轮记录的 `30548607…` 不同，行数 361 → 362（+1 行），字节 32389 → 33075（+686 B）。变更确认成立。
- ⚠️ **验收窗口内发生二次写入（须如实记录）**：本轮起始读取到 `a592e6ba…`，随后该文件 mtime 变为 `17:15:21`、内容稳定为 `f2ea3695…`（本轮全部证据采集于该时刻之后）。因此**第一轮哈希、本轮起始哈希均已过期**，本报告全部结论以 **`f2ea3695…`** 为准。该次写入使 `lib/client.js`（17:15:16）与 `npm run check` 日志（17:15:32）处于同一时间带，但三次连续 `sha256sum`（间隔 3 s）结果完全一致，且报告写入前后再校验仍为 `f2ea3695…`，快照稳定。
- 被验收文档在 `git` 中仍为**未跟踪文件**（`??`），无 `git diff` 可比对历史；上述差异由第一轮报告留存的哈希与行数直接判定。

---

### 10. 七项修改逐条核实

| # | 装配者声称的修改 | 判定 | 关键证据（行号 + 实测原文片段） |
| --- | --- | --- | --- |
| **1** | §3 表 **P1′ 交付物**收窄为 `WG-QQ-10`、`WG-QQ-11`，并注明 `WG-QQ-12`（P2′ 门槛统计）与 `WG-QQ-13`（降级 D′）不计入 P1′ | **✅ 生效** | **L93**：`` \| **P1′** \| 全量接入：… \| … \| `WG-QQ-10`、`WG-QQ-11`（`WG-QQ-12` 属 P2′ 的门槛统计、`WG-QQ-13` 属降级分支 D′，**不计入 P1′ 范围**） \| … \| ``；L95 D′ 行仍为「否定结论记录 + `WG-QQ-13` 开关默认值」。第一轮 #1 所指的范围冲突已消除 |
| **2** | §4.3 `member_role` 表述改为：取值集合由官方文档给出（member/admin/owner），**字段是否随载荷到达与稳定性**仍标 `未核验` | **✅ 生效** | **L132**：「**取值集合**已由官方事件文档给出（`member` / `admin` / `owner`），但**该字段是否真的随载荷到达、以及稳定性 `未核验`**（仓库与 SDK 均 0 命中，只能实测确认）」；小节标题 L129 仍为「（可用性未核验）」。官方页面实测确有 `member_role \| string \| 群内角色。member=普通成员, admin=管理员, owner=群主`，与改后表述一致 |
| **3** | `markdown-reply.mjs:7` → `:46`（调用 `chunkMarkdownParts`）+ `:49` | **✅ 生效** | **L151**：「QQ 长文切分后逐条发送（`markdown-reply.mjs:46` 调用 `chunkMarkdownParts`，`:49` 起按平台被动上限处理）」；实测 `sed -n '46p' src/channels/qq/markdown-reply.mjs` → `  const chunks = chunkMarkdownParts(text);` ✅；`:49p` → `  const passiveLimit = target?.msgId ? PASSIVE_REPLY_LIMIT[target.scope] : null;` ✅。全文已无 `markdown-reply.mjs:7` |
| **4** | `delivery-adapter.mjs:7` → `:7-13`（频道集合含 `qq`） | **✅ 生效** | **L138**、**L180** 均写作 `` `delivery-adapter.mjs:7-13` ``；实测 `sed -n '7,13p' plugin-src/host/delivery-adapter.mjs` = `const CHANNELS = new Set([` / `'weixin'` / `'feishu'` / `'dingtalk'` / `'wecom'` / `'wecom-app'` / `  'qq',` —— `'qq'` 确在**第 13 行**，区间完整覆盖 ✅ |
| **5** | §6.5 `context_token` 限定为**生产代码**只出现在微信渠道，并把拦截语义标为**按设计** | **✅ 生效** | **L180**：「`context_token` 在**生产代码**中只出现在微信渠道（`src/channels/weixin/weixin-bridge.mjs:425`、`:670` 等；`test/` 下另有少数夹具引用），**QQ 不适用**…」+「**按设计**，控制命中时不会走到平台发送，因而不产生 `providerMessageIds`」。实测 `grep -rn context_token src/ plugin-src/` 仅命中 `src/channels/weixin/weixin-api.mjs`、`src/channels/weixin/weixin-bridge.mjs`（生产代码仅微信 ✅）；`test/` 下另有 7 个文件引用（与"另有少数夹具引用"相符 ✅）。第一轮 #8（现在时口吻）与 #11（口径过宽）同时消除 |
| **6** | §7.3 依赖图补上 `WG-QQ-03 → WG-QQ-06` | **⚠️ 生效但不完整（引入重复边残留）** | **L288** 已新增 ``              └────> WG-QQ-06（dry-run 同时依赖 03 与 04） ``（13 空格缩进，正确指向 `WG-QQ-03`），与 §7.1 L224「依赖：`WG-QQ-03`、`WG-QQ-04`」一致；**但旧边未被删除**——**L289** 仍残留 `                        └─────> WG-QQ-06`（24 空格缩进，原为 `WG-QQ-04 → WG-QQ-06`），现被嵌到 L288 的 `WG-QQ-06` 之下，字面上构成 `WG-QQ-06 → WG-QQ-06` 的假边。全文 `WG-QQ-06` 共出现 4 处（L221 定义、L288、L289、L349）。**结论：声称的目标达成，但修复不干净，新增一处图形缺陷（见残余 R1）** |
| **7** | §2.2 注解改写，明确"五项都无实现"与"被实际需要的缺口是前四项"不矛盾 | **✅ 生效** | **L65**：「**两项陈述不矛盾**：五项控制在 QQ 上确实**都没有实现**（见上表），但其中第五项在 QQ 属**预防性**而非**修复性**——QQ 没有可修复的正文落盘，它防范的是全量模式接入后新引入的入站原文落盘。因此 QQ 当前**被实际需要**的缺口是**前四项**。」第一轮 #3 的相邻两句"缺口数不一致"已显式消解 |

**小计：6 项完全生效（#1、#2、#3、#4、#5、#7），1 项部分生效（#6，目标边已补但旧边残留）。**

附带观测（非声称项，供参考）：`text-harness-bridge.mjs:255` 在全文的出现次数由第一轮的 3 次（L76/L86/L260）降为 2 次（**L76** 对照更正、**L86** WhatsApp 行）；L260 现写作「QQ 桥接不继承 `TextHarnessBridge`，共享层不参与该判定」（去掉了显式路径引用，语义未削弱）。

---

### 11. 标准 1 `links-resolve`（当前版本）—— **`passing`**

#### 11.1 Markdown 相对链接（按 `docs/方案/` 解析，`test -f` 实测）

全文 Markdown 链接实例 **8 处**，去重为 **5 个仓库内链接**（与第一轮一致）+ 1 个外部 URL（autolink 2 处）：

| # | 出现次数 | 链接 | 解析目标 | `test -f` |
| --- | --- | --- | --- | --- |
| 1 | 3 | `[微信渠道已达成的能力.md](微信渠道已达成的能力.md)` | `docs/方案/微信渠道已达成的能力.md` | **OK** |
| 2 | 2 | `[微信个人号群聊补充目标与计划.md](微信个人号群聊补充目标与计划.md)` | `docs/方案/微信个人号群聊补充目标与计划.md` | **OK** |
| 3 | 1 | `[渠道原生能力建设方案.md](渠道原生能力建设方案.md)` | `docs/方案/渠道原生能力建设方案.md` | **OK** |
| 4 | 1 | `[PROACTIVE_DELIVERY.md](../../PROACTIVE_DELIVERY.md)` | 仓库根 `PROACTIVE_DELIVERY.md` | **OK** |
| 5 | 1 | `[docs/adr/0001-….md](../../docs/adr/0001-semantic-core-native-channel-adapters.md)` | `docs/adr/0001-…md` | **OK** |

**5/5 全部 `test -f` 通过，BROKEN 计数为 0。**

外部 URL（L71 / L362，`https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html`）本轮 `web_fetch` 实测 **HTTP 200**，正文含「当机器人开启了"接收所有消息"功能后，群里的每一条消息（不限于@机器人）都会推送此事件」及 `member_role` 取值表，与 L71、L132 转述一致。

#### 11.2 反引号包裹的仓库路径（自动提取 31 个 token）

自动解析后 **26 个直接命中**；5 个"未命中"经人工复核**全部为解析器口径问题，无一是文档断链**：

| 未命中 token | 复核结论 |
| --- | --- |
| `dist/QQBot.js:351` | 相对 SDK 包根，实测存在：`node_modules/@tencent-connect/qqbot-nodejs/dist/QQBot.js` ✅ |
| `dist/protocol/gateway/constants.js:60` | 同上路径存在 ✅；`sed -n '60p'` → `    GROUP_MESSAGE_CREATE: "GROUP_MESSAGE_CREATE",` ✅ |
| `dist/protocol/gateway/event-dispatcher.js:121-128` | 同上路径存在 ✅；`:118-122` 实测为 `if (eventType === GatewayEvent.GROUP_AT_MESSAGE_CREATE \|\|` / `    eventType === GatewayEvent.GROUP_MESSAGE_CREATE) {` → 确为**同一分支**并产出 `kind: "group"` ✅ |
| `qq-bridge.mjs:517/528/707` | 斜杠连写的多行号引用（L260），非单一路径；三个行号实测均正确（见 11.3） |
| `src/channels/shared/send-control.mjs` | 文档 L209 明示为「**建议名**」、L336 §10 #8 再次标注「文中 `send-control.mjs` 为**建议名**」→ 按规则**不算断链** ✅ |

SDK 版本核对：`node_modules/@tencent-connect/qqbot-nodejs/package.json` → `"version": "1.0.4"`，与文档标注一致。

#### 11.3 行号抽查（本轮 15 处，含任务点名的全部位置）

| # | 文件:行 | 文档/任务声称 | 实测输出 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `src/channels/qq/markdown-reply.mjs:46` | 调用 `chunkMarkdownParts` | `  const chunks = chunkMarkdownParts(text);` | **一致** ✅ |
| 2 | `src/channels/qq/markdown-reply.mjs:49` | 按平台被动上限取值 | `  const passiveLimit = target?.msgId ? PASSIVE_REPLY_LIMIT[target.scope] : null;` | **一致** ✅ |
| 3 | `src/channels/qq/markdown-reply.mjs:11` | `PASSIVE_REPLY_LIMIT = { c2c: 4, group: 5 }` | `const PASSIVE_REPLY_LIMIT = Object.freeze({ c2c: 4, group: 5 });` | **一致** ✅ |
| 4 | `plugin-src/host/delivery-adapter.mjs:7-13` | 频道集合含 `qq` | `const CHANNELS = new Set([` … `  'qq',`（`'qq'` 在第 13 行） | **一致** ✅ |
| 5 | `docs/方案/…md:93`（§3 表 P1′ 行） | 交付物为 `WG-QQ-10`、`WG-QQ-11` | 见 §10 #1 原文 | **一致** ✅ |
| 6 | `docs/方案/…md:132`（`member_role` 段） | 取值集合官方给出、到达与稳定性 `未核验` | 见 §10 #2 原文 | **一致** ✅ |
| 7 | `docs/方案/…md:180`（`context_token` 段） | 生产代码仅微信 + 按设计 | 见 §10 #5 原文 | **一致** ✅ |
| 8 | `src/channels/qq/qq-bridge.mjs:1014` | 未 @ 丢弃点 | `    if (!isQqMessageAddressed(message)) return;` | **一致** ✅ |
| 9 | `src/channels/qq/qq-bridge.mjs:1288` | 交互回复路径另一处丢弃 | `    if (!isQqMessageAddressed(message)) return;` | **一致** ✅ |
| 10 | `src/channels/qq/qq-bridge.mjs:436` | `QqHarnessBridge` 类声明（无 `extends`） | `export class QqHarnessBridge {` | **一致** ✅ |
| 11 | `src/channels/qq/qq-bridge.mjs:707` | 非被点名时 `send` 空操作 | `      send: (reply) => addressed ? this.#bot.sendText(message.replyTarget, reply) : Promise.resolve(),` | **一致** ✅ |
| 12 | `src/channels/qq/qq-bridge.mjs:936` | `messagesRejected` 仅在策略拒绝时累加 | `        this.#status.messagesRejected += 1;` | **一致** ✅ |
| 13 | `src/channels/shared/text-harness-bridge.mjs:255` | 共享层未 @ 判定（**对 QQ 不适用**） | `    if (kind === 'group' && normalized.addressed !== true) {` | **一致** ✅ |
| 14 | `plugin-src/host/channels/shared/access-policy-production.mjs:61-66` | QQ `group: openScope()`、direct 由 `*` 决定 | `  if (key === 'qq') {` … `      group: openScope(),` … `    });` | **一致** ✅ |
| 15 | `src/channels/shared/access-policy.mjs:201-207` | `open` 模式由 `defaultCanExecuteCommands` 决定 | `  if (isCommand) {` … `    if (!canExecuteCommands) return COMMAND_NOT_ALLOWED;` | **一致** ✅ |

补充复核：`src/channels/qq/qq-mention.mjs:10-15`（`isQqMessageAddressed` 只认 `GROUP_AT_MESSAGE_CREATE` 或自 mention）实测一致 ✅；`src/channels/qq/state-store.mjs:19-27` 返回体确无出站正文字段（`recentOutbound` **0 命中**），对照 `src/channels/weixin/state-store.mjs` **7 命中** ✅；`src/channels/qq/markdown-reply.mjs:11/49`、`package.json:99-103`（`build` / `test` / `check` 三脚本）均一致 ✅。

#### 11.4 QQ 未 @ 丢弃点归属专项（任务点名）

| 检查点 | 实测证据 | 结论 |
| --- | --- | --- |
| 文档是否仍把 QQ 未 @ 丢弃点写成 `qq-bridge.mjs:1014` | `qq-bridge.mjs:1014` 在文档中出现 **6 次**（L74、L85、L160、L190、L259、L266），L74 另注「交互回复路径另见 `:1288`」 | **正确** ✅ 仍是文档中 QQ 未 @ 的**唯一**丢弃点 |
| 文档是否把 `text-harness-bridge.mjs:255` 误当作 QQ 丢弃点 | 该字面串全文**仅 2 次**：L76（明确「共享层 … 的未 @ 拒绝对 **QQ 不适用**，QQ 的丢弃点是自己的 `:1014`」）、L86（**WhatsApp 行**） | **未发现此类错误** ✅ |
| 独立源码佐证 | `grep -n "isQqMessageAddressed(message)) return" src/channels/qq/qq-bridge.mjs` → 仅 `:1014`、`:1288` 两处（均被文档覆盖）；`grep -rn "extends TextHarnessBridge" src/ plugin-src/` → 仅 whatsapp/email/discord/slack/matrix/telegram/imessage **7 个渠道**，无 QQ（另 `test/session-bind-command.test.mjs:234` 为文本断言）；`src/channels/qq/qq-runtime.mjs:213` 的 `if (!isQqMessageAddressed(message)) return false;` 位于 typing-indicator 的 `predicate`（仅决定是否保活"正在输入"），**不丢弃消息**，与文档归属不冲突 | **归属正确** ✅ |

#### 11.5 标准 1 结论

> **`passing`** —— 5 个仓库内 Markdown 链接全部 `test -f` 通过、BROKEN = 0；外部 URL 实测 HTTP 200 且内容与转述一致；31 个反引号路径 token 中 26 个直接命中，其余 5 个经复核或为 SDK 包内相对路径（实测存在）、或为斜杠连写、或被文档两处明示为"建议名"；15 处行号抽查**全部一致**；`qq-bridge.mjs:1014`（+ `:1288`）仍是文档中 QQ 未 @ 的唯一丢弃点，`text-harness-bridge.mjs:255` 未被误作 QQ 丢弃点。

---

### 12. 标准 2 `no-implemented-claims`（当前版本）—— **`passing`**

- **头部声明仍在（逐字未变）**：L3「本文是**计划与决策文档**，不是已实现能力清单」、L4「**当前仓库没有任何一项已实现**」、L5 Vibe run 出处、L6「一律标 `未核验`」。L310 §9「本轮不改任何代码…」、L318 §9.7「不把 P2′ 写成待实现功能或排入 backlog」仍在。
- **词表扫描**（`已实现|已支持|已具备|已有|已接入|已提供|已完成|上线`）命中 **6 处**，与第一轮相同且逐条为否定句或**现状基线/SDK 依赖**描述：L3、L4（否定句）；L16「**已具备**（`kind: 'group'`）」与 L44「### 2.1 已具备（QQ 不需要重做）」均指 QQ 官方机器人**既有群聊形态**；L72「SDK 已支持（**依赖产物，非本仓库源码**）」；L236「QQ 客户端已有机器人卡片与设置面」。**无一处把本计划成果写成已实现。**
- **重点复核被修改的 §6.5（L180）未引入"已实现"口吻**：改后为「**按设计**，控制命中时**不会**走到平台发送，因而不产生 `providerMessageIds`」——由第一轮的现在时事实口吻改为**设计意图/条件语义**，且同段保留「可达性与平台主动消息限制 `未核验`」。**未引入"已实现"口吻** ✅（第一轮 #8 已消解）。
- **P2′ 仍无实现条目**：L94 P2′ 交付物为「**无交付物**」、退出条件「**不设退出条件**」；§8 标题「P2′ 的证据门槛（**仅门槛，不含设计**）」；L308「**明确不做**：不写自主接话的设计草案（触发规则、冷却、概率、上下文裁剪一律不谈）；**不列 P2′ 的实现 backlog 条目**」。`WG-QQ-12`（L265-270）改动位置为「**仅门槛与只读统计，不新增回复路径**」、不做项「**不写触发规则/冷却/概率/上下文裁剪**；不排入实现 backlog」——**不是**接话实现条目。
- **`shouldParticipate` 命中数 = 0**（`grep -c` → 0，`grep -o | wc -l` → 0）✅；`触发规则|冷却|概率|上下文裁剪|参与策略` 仅出现在 L263/L270/L308 三处**否定声明**中。
- **五项待核事项仍全部标为未实现/未核验，并经仓库实测证实**：QQ 全量模式接入（P1′ 目标 + L93 `未核验` 硬前置 + L313「不把平台"接收所有消息"当作既定能力」）、群默认收紧（L60/L103 + `WG-QQ-01`）、五项发送控制（L61「**五项全无**」、L65「都没有实现」、实测 `package.json` 仅 build/test/check、`src/channels/shared/send-control.mjs` **不存在**、全仓无 dry-run 实现）、P2′ 接话（见上）、`member_role`（L132/L194/L335：仓库与 SDK `dist/` 均 **0 命中**，实测 `grep -rn member_role src/ plugin-src/ test/` = 0、`node_modules/@tencent-connect/` = 0）。

> **`passing`** —— 头部声明齐备；被修改的 §6.5 未滑向"已实现"口吻；P2′ 仍只有证据门槛、无接话实现条目、`shouldParticipate` 0 命中；五项待核能力与 `member_role` 均被明确标为未实现/未核验且经实测证实。存在 1 处非实质范围表述张力（残余 R2），不构成判定失败。

---

### 13. 标准 3 `repo-green-ci-node24`（当前版本）—— **`passing`**

#### 13.1 前置与命令

Node 24 二进制 `.npm-cache/_npx/387698761821791d/node_modules/node/bin/node` → **存在**，`--version` = **`v24.21.0`**。按任务给定脚本原样执行（日志：`outputs/runtime/check-node24-qq-round2.log`）：

```bash
cd /home/stella/Project/dsh-im/dsh-im
mkdir -p .test-dsh-home
N24DIR="$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin"
export PATH="$N24DIR:$PATH"
node --version
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY \
  DSH_HOME="$PWD/.test-dsh-home" npm_config_cache="$PWD/.npm-cache" \
  npm run check > outputs/runtime/check-node24-qq-round2.log 2>&1
echo "EXIT_CODE=$?"
```

#### 13.2 结果

| 记录项 | 实测值 |
| --- | --- |
| `node --version` | **`v24.21.0`** |
| **真实退出码** | **`0`** |
| `ℹ tests` | **4027** |
| `ℹ suites` | 3 |
| `ℹ pass` | **4027** |
| `ℹ fail` | **0** |
| `ℹ cancelled` | **0** |
| `ℹ skipped` / `ℹ todo` | 0 / 0 |
| `ℹ duration_ms` | 14171.901456 |
| `Verified dsh-im package artifacts.` | **出现**（日志第 **5214** 行，即末行） |
| 日志行数 | 5214 |

日志开头仍有 1 条既有 `(node:5) [DEP0169] DeprecationWarning: url.parse() …`，**不阻塞**（退出码 0，见残余 R5）。

#### 13.3 被跟踪文件改动核查

| 时点 | `git status --porcelain` | `lib/client.js` sha256 | `lib/index.js` sha256 |
| --- | --- | --- | --- |
| **运行前** | 5 条，全为 `??`：`.npm-cache/`、`docs/方案/QQ渠道群聊补充目标与计划.md`、`docs/方案/微信个人号群聊补充目标与计划.md`、`docs/方案/微信渠道已达成的能力.md`、`outputs/` | `6a11d7d14bdb95bbbdaf2638d76bc478631e65d49a636b41b87ddc9c3b12e248` | `c706a37cafed95fb15c727f3474bc463061c0298868d476f811c88920cd806db` |
| **运行后** | **逐字相同**（5 条，全为 `??`） | **未变** `6a11d7d1…b12e248` | **未变** `c706a37c…d806db` |

- `git diff --stat` / `git diff --name-only` 运行前后均为**空**。
- **结论：无任何被跟踪文件被改动**（`lib/` 虽被 build 重写，内容逐字节一致）；未执行任何 revert/清理；被验收文档在本轮全程只读，报告写入前后 sha256 均为 `f2ea3695…`。

> **`passing`** —— CI 同版本 Node 24（`v24.21.0`）下 `npm run check` **真实退出码 `0`**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，并打印 `Verified dsh-im package artifacts.`；运行前后**无任何被跟踪文件改动**。

---

### 14. 残余问题清单（第二轮）

> 第一轮 11 项中 **7 项已修复**（#1、#3、#5、#8、#9、#11，以及 #6 的行号部分），**4 项未处理**（#2 的张力部分、#6 的裸文件名部分、#7、#10）。另有 **1 项为本次修复引入的新残留**（R1）。以下 6 项均为文档质量层面，**不构成 `failing`**。

| # | 严重度 | 位置 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| **R1** | **低（本次修复引入）** | §7.3 L288-L289 | **依赖图残留重复边**：新增的 `WG-QQ-03 → WG-QQ-06` 已到位，但被取代的旧行 `                        └─────> WG-QQ-06` **未删除**，且缩进使其视觉上挂在 L288 的 `WG-QQ-06` 之下，字面形成 `WG-QQ-06 → WG-QQ-06` 的假边。**建议删除 L289。** | L288 `             └────> WG-QQ-06（dry-run 同时依赖 03 与 04）`；L289 `                        └─────> WG-QQ-06`；`cat -A` 确认两者缩进分别为 13 / 24 空格 |
| **R2** | 低 | §3 L94 vs §7.2 L182/L265-L270 vs §8 L308 | P2′ 行称「**无交付物**」，而 `WG-QQ-12` 标注「**P2′ 专用**」且含「改动位置/验收」；同时 §7.2 表头为 `backlog（WG-QQ-01…WG-QQ-13）`（含 `WG-QQ-12`），与 §8 L308「**不列 P2′ 的实现 backlog 条目**」字面冲突。M1 只消除了 P1′ 范围归属问题，未消除此张力 | L94；L182 `## 7. backlog（`WG-QQ-01`…`WG-QQ-13`）`；L265；L270；L308 |
| **R3** | 低 | §5/§6.5/§7.1 L138 / L180 / L209 | `delivery-adapter.mjs` 仍以**裸文件名**出现（含 `:316`/`:407`），全文未给出实际路径前缀 `plugin-src/host/`；读者无法唯一定位（仓库内另有 `plugin-src/client/delivery-*.js` 等近名文件） | L138、L180、L209；实测实际路径为 `plugin-src/host/delivery-adapter.mjs` |
| **R4** | 低 | §2.4 L84 | `src/channels/weixin/weixin-runtime.mjs:409` 仍被用作"微信协议层无群"的直接证据，但该行实为主动投递目标的 `kind !== 'user'` 守卫，属**间接**证据（同表 `weixin-api.mjs:14` 的 CDN `/c2c/` 证据更强）。（第一轮 #7，未处理） | L84；`sed -n '409p'` → `    if (target?.kind !== 'user' \|\| !toUserId) {` |
| **R5** | 信息 | Node 24 日志第 1-2 行 | 既有 `[DEP0169] DeprecationWarning: url.parse() …` 仍在，属仓库既有代码告警，**不阻塞**（退出码 0）。（第一轮 #10，未处理） | `outputs/runtime/check-node24-qq-round2.log:1` |
| **R6** | 信息（流程） | 被验收文档本身 | **验收窗口内发生二次写入**：本轮起始读取 `a592e6ba…`，其后 mtime 变为 17:15:21 且内容稳定为 `f2ea3695…`。虽两次均为 362 行，但字节/内容不同，说明装配者在复验开始后仍在写入。**建议：后续复验前先冻结文档（或提供不可变快照），否则任何验收结论都可能随时失效。** | §9 表；三次间隔 3 s 的 `sha256sum` 一致；报告写入前后再校验不变 |

**残余问题总数：6 项**（4 低 / 2 信息，其中 R1 为本次修复引入）。

---

### 15. 第二轮总体结论

| 标准 | 第一轮 | **第二轮（当前版本 `f2ea3695…`）** | 一句话依据 |
| --- | --- | --- | --- |
| **1. `links-resolve`** | passing | **`passing`** | 5 个仓库内链接 `test -f` 全通过、BROKEN = 0；外部 URL HTTP 200；31 个路径 token 无真实断链；15 处行号抽查全一致（含 `markdown-reply.mjs:46`、`delivery-adapter.mjs:7-13`、§3 P1′ 行、`member_role` 段、`context_token` 段）；`qq-bridge.mjs:1014` 仍是 QQ 未 @ 的唯一丢弃点，`text-harness-bridge.mjs:255` 未被误作 QQ 丢弃点 |
| **2. `no-implemented-claims`** | passing | **`passing`** | 头部声明仍在；改后的 §6.5 未引入"已实现"口吻；P2′ 仍只有证据门槛、无接话实现条目、`shouldParticipate` 0 命中；五项能力与 `member_role` 均标未实现/未核验且经实测证实 |
| **3. `repo-green-ci-node24`** | passing | **`passing`** | Node 24 `v24.21.0`：`npm run check` **退出码 0**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，出现 `Verified dsh-im package artifacts.`（日志 5214 行）；运行前后 `git status --porcelain` 逐字相同、`git diff` 为空、`lib/client.js`/`lib/index.js` sha256 不变 |

**一句话总体结论：针对当前版本（sha256 `f2ea3695…`，362 行）三项标准全部 `passing`，装配者声称的 7 项修改中 6 项完全生效、1 项（§7.3 补边）目标达成但遗留一条重复边，残余 6 项均为低/信息级文档质量与流程问题，不构成 `failing`。**

**本轮写入的产物（仅此二者）：**

| 文件 | 说明 |
| --- | --- |
| `outputs/qq-supplement/verification-report.md` | 本报告（仅**追加** §8–§15，第 1–416 行原文未改） |
| `outputs/runtime/check-node24-qq-round2.log` | Node 24 `npm run check` 完整日志（5214 行，退出码 0） |

---

## 第三轮验收（最终确认）

> 本轮为**独立最终确认验收**。装配者声明被验收文档 `docs/方案/QQ渠道群聊补充目标与计划.md` 为**最终版**，之后不再修改。
> 本轮只写入两个文件：本报告的**本节（仅追加）** 与 `outputs/runtime/check-node24-qq-final2.log`。
> **未修改被验收文档、未 revert、未清理任何文件**（与第二轮相同，`git status --porcelain --untracked-files=no` 运行前后皆为空）。

### 16. 锚定（第 1 步）

| 项 | 值 |
| --- | --- |
| 文档路径 | `docs/方案/QQ渠道群聊补充目标与计划.md` |
| **开头 sha256** | `446ffcf2f17120c4891284946034d56f34d43ed4da576b047effa556201f4833` |
| 行数 / 字节数 | **363 行** / 33625 字节 |
| 上一轮锚点 | `f2ea369555c4c6322ae233ac292197ff687664c0ba85acc3cc0025e1ce051882`（362 行） → **已按预期变更**（+1 行） |
| **末尾 sha256（第 4 步复校）** | `446ffcf2f17120c4891284946034d56f34d43ed4da576b047effa556201f4833` —— **与开头逐位一致** |

**复校结论**：验收窗口内文档 sha256、行数、字节数三者均未变化，**证明被验收文档在本次验收期间未被写入**。

新增的那 1 行即 §7 标题下的「编号性质说明」（见 R2）。

### 17. 四项修正逐条核实（第 2 步）

#### R1 `§7.3` 依赖图内 `WG-QQ-06` 只出现 1 次、无自环假边 —— **生效**

`§7.3` 代码块（L283–L292）原文：

```text
P0′：WG-QQ-01 ──> WG-QQ-02
      WG-QQ-03 ──> WG-QQ-04 ──> WG-QQ-05
             └────> WG-QQ-06（dry-run 同时依赖 03 与 04）
      WG-QQ-07（依赖 03）
      WG-QQ-08 / WG-QQ-09（贯穿，最后收口）
```

- 代码块内 `WG-QQ-06` **恰好出现 1 次**（L290，`grep -c` → `1`）。
- 正则 `WG-QQ-06\s*(──>|─+>|→|->)\s*WG-QQ-06` 全文 **0 命中** —— 上一轮的 `WG-QQ-06 → WG-QQ-06` 假边（旧 L289，24 空格缩进的残留边）**已删除**。
- L290 以 13 空格缩进指向 `WG-QQ-03`，与 §7.1 中 `WG-QQ-06` 的依赖声明（**L226**：`- 依赖：\`WG-QQ-03\`、\`WG-QQ-04\`。`）**一致**。
- 全文 `WG-QQ-06` 共 3 处：L223（条目标题）、L290（依赖图）、L350（§9 第 3 条说明），均在预期位置。

#### R2 `§7` 编号性质说明 + `§8`/`§9` 第 7 条一致 —— **生效**

- `§7` 标题（L182）`## 7. backlog（\`WG-QQ-01\`…\`WG-QQ-13\`）` 正下方 **L184** 为：

> **编号性质说明**：`WG-QQ-01`…`WG-QQ-11` 是**实现条目**；`WG-QQ-12` 是 **P2′ 的门槛统计条目**（只有只读统计，不含回复路径），`WG-QQ-13` 是**降级条目**。后两条**不属于 P1′ 范围**，也不构成"P2′ 的实现 backlog"。

- `§8`「明确不做」（**L309**）原文片段：`…不列 P2′ 的**实现** backlog 条目（\`WG-QQ-12\` 只是门槛统计，不新增回复路径）。`
- `§9` 第 7 条（**L319**）原文片段：`7. 不把 P2′写成待实现功能，也不为 P2′ 排**实现**条目（\`WG-QQ-12\` 仅为门槛统计）。`
- 两处对「不为 P2′ 排**实现**条目、`WG-QQ-12` 只是门槛统计」的表述**语义一致**。
- 附带收益：§3 目标分层表 L93 的 P1′ 交付物已收窄为 `` `WG-QQ-10`、`WG-QQ-11` ``，并注明「`WG-QQ-12` 属 P2′ 的门槛统计、`WG-QQ-13` 属降级分支 D′，**不计入 P1′ 范围**」，**第一轮 #1/#2 的范围划分张力随之消解**。

#### R3 全文无裸文件名 `` `delivery-adapter.mjs…` ``，3 处引用均带 `plugin-src/host/` 前缀 —— **生效**

- `grep -nP '`delivery-adapter\.mjs'`（反引号紧跟裸文件名）→ **0 命中**。
- 全文 3 处引用 **L138、L180、L211** 全部为 `plugin-src/host/delivery-adapter.mjs` 形式：
  - L138：`**L3 主动投递**（\`plugin-src/host/delivery-adapter.mjs:7-13\` 的频道集合含 \`qq\` → \`sendProactiveText\`）`
  - L180：`QQ 主动投递路径：\`plugin-src/host/delivery-adapter.mjs:7-13\`（频道集合含 \`qq\`）`
  - L211：`接线点 L3（\`plugin-src/host/delivery-adapter.mjs:316\`/\`:407\` 之后）`
- 第一轮 #6 的「裸文件名」部分**已修复**。

#### R4 `§2.4` 表「微信 iLink」行证据齐备 —— **生效**

`§2.4` 表 L84 原文：

```
| 微信 iLink | **收不到** | 协议层无群 | `src/channels/weixin/weixin-runtime.mjs:409`（只接受 `kind === 'user'`）；`src/channels/weixin/weixin-api.mjs:14`、`:174`、`:326`（CDN 路径硬编码 `/c2c/`）；旁证 `docs/上下文增强.md:3`「微信当前只支持私聊」 |
```

逐行实测（全部与声称相符）：

| 引用 | 实测内容 |
| --- | --- |
| `weixin-runtime.mjs:409` | `if (target?.kind !== 'user' \|\| !toUserId) {` |
| `weixin-api.mjs:14` | `export const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';` |
| `weixin-api.mjs:174` | `\|\| (url.port && url.port !== '443') \|\| !url.pathname.startsWith('/c2c/')) {` |
| `weixin-api.mjs:326` | `\|\| (url.port && url.port !== '443') \|\| url.pathname !== '/c2c/upload'` |
| `docs/上下文增强.md:3` | 行末「…微信当前只支持私聊。」 |

即：`/c2c/`（单聊）硬编码证据已补齐，微信"协议层无群"不再只靠 `kind === 'user'` 单一间接证据 —— 第一轮 #7 的「证据偏间接」提示**已实质性缓解**。

### 18. 三项标准结论（第 3 步）

#### 标准 `links-resolve` —— **`passing`**

- **相对链接 `test -f`**：文档内全部 5 个 Markdown 相对链接（按 `docs/方案/` 为基准解析）**全部存在**：

| 链接 | 结果 |
| --- | --- |
| `../../docs/adr/0001-semantic-core-native-channel-adapters.md` | OK |
| `../../PROACTIVE_DELIVERY.md` | OK |
| `微信个人号群聊补充目标与计划.md` | OK |
| `微信渠道已达成的能力.md` | OK |
| `渠道原生能力建设方案.md` | OK |

- **行号抽查（本轮 12 处，含任务要求的 5 处强制项，全部相符）**：

| # | 引用 | 实测 |
| --- | --- | --- |
| 1 | `docs/上下文增强.md:3` ★ | 「…微信当前只支持私聊。」 |
| 2 | `weixin-api.mjs:174` ★ | `!url.pathname.startsWith('/c2c/')` |
| 3 | `weixin-api.mjs:326` ★ | `url.pathname !== '/c2c/upload'` |
| 4 | `plugin-src/host/delivery-adapter.mjs:316` ★ | `await coreController.sendProactiveText(botId, normalized, text, options);` |
| 5 | `plugin-src/host/delivery-adapter.mjs:407` ★ | `await coreController.sendProactiveText(botId, target, text, options);` |
| 6 | `weixin-runtime.mjs:409` | `if (target?.kind !== 'user' \|\| !toUserId) {` |
| 7 | `weixin-api.mjs:14` | `WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'` |
| 8 | `plugin-src/host/channels/shared/access-policy-production.mjs:61-66` | `if (key === 'qq') { … group: openScope(), … }` |
| 9 | `qq-bridge.mjs:707` | `send: (reply) => addressed ? this.#bot.sendText(message.replyTarget, reply) : Promise.resolve(),` |
| 10 | `qq-bridge.mjs:740-741` | `async #deliverDeferredOutcome(entry, outcome) {` + `await sendMarkdownReply(…)` |
| 11 | `qq-mention.mjs:10-15` | `export function isQqMessageAddressed(message) { … }` |
| 12 | `access-policy.mjs:201-207` | `if (isCommand) { const canExecuteCommands = … defaultCanExecuteCommands … }` |

- **QQ 丢弃点归属**：
  - `src/channels/qq/qq-bridge.mjs:1014` = `if (!isQqMessageAddressed(message)) return;` —— 位于**主入口消息处理路径**，是未 @ 群消息退回的**唯一终结点**。✅
  - 精确说明（非缺陷）：全文另有 **`:1288`** 同形 guard，位于交互回复子路径 `#processInteractionReply`（仅处理待决交互的回复，非一般消息入站）。文档 **L74 已自行披露**「交互回复路径另见 `:1288`」，故**不存在未披露的第二丢弃点**；`§3`/L78/L85 的 `:1014` 简写应理解为「主入口路径唯一」。
  - `src/channels/shared/text-harness-bridge.mjs:255` **未被当作 QQ 丢弃点**：文档 L76 明确更正「QQ 的 `QqHarnessBridge` … **不继承** `TextHarnessBridge` … 共享层 `:255` 的未 @ 拒绝对 **QQ 不适用**」；L86 仅把它列为 **WhatsApp** 的丢弃点。实测该行确为共享层 `if (kind === 'group' && normalized.addressed !== true) {`，与文档归属一致。✅

#### 标准 `no-implemented-claims` —— **`passing`**

- **头部声明仍在**（L3–L6）：`> **状态声明**：本文是**计划与决策文档**，不是已实现能力清单。` / `**当前仓库没有任何一项已实现**` / `凡未从仓库证据或真实实测确认的，一律标 未核验`。✅
- **`shouldParticipate` 命中 0**（`grep -c` → `0`）—— 无参与/接话策略草案。✅
- **P2′ 无实现条目**：L94 P2′ 交付物为「**无交付物**（门槛通过后另立独立决策与设计）」；L184 编号性质说明明确 `WG-QQ-12` 只是门槛统计、不含回复路径；L267–L270 仅「门槛与只读统计」并「不排入实现 backlog」；L309/L319 再次重申。✅
- 被修改过的 §2.4 / §7 未滑向「已实现」口吻，全部证据仍以现状/落点表述。

#### 标准 `repo-green-ci-node24` —— **`passing`**

```bash
cd /home/stella/Project/dsh-im/dsh-im
mkdir -p .test-dsh-home
export PATH="$PWD/.npm-cache/_npx/387698761821791d/node_modules/node/bin:$PATH"
node --version   # → v24.21.0
env -u HTTPS_PROXY … npm run check > outputs/runtime/check-node24-qq-final2.log 2>&1
```

| 项 | 结果 |
| --- | --- |
| Node 版本 | **`v24.21.0`** |
| **真实退出码** | **`0`** |
| `ℹ tests` | **4027** |
| `ℹ suites` | 3 |
| `ℹ pass` | **4027** |
| `ℹ fail` | **0** |
| `ℹ cancelled` | **0** |
| `ℹ skipped` / `ℹ todo` | 0 / 0 |
| `ℹ duration_ms` | 14057.38 |
| `Verified dsh-im package artifacts.` | **出现**（日志 L5214） |
| 日志规模 | `outputs/runtime/check-node24-qq-final2.log`，5214 行 / 490650 字节 |

- **被跟踪文件改动**：运行前 `git status --porcelain --untracked-files=no` → 空；运行后 → **空**。**无任何被跟踪文件改动**，未 revert、未清理。运行前后 `git status --porcelain` 的未跟踪项集合一致（`.npm-cache/`、三个 `docs/方案/*.md`、`outputs/`）。
- 日志头部有 3 处**仓库既有** `(node:5) [DEP0169] DeprecationWarning: url.parse() …`，不阻塞（退出码 0），见残余 N2。

### 19. 残余问题（第 5 步）

> 本轮**未发现任何 `failing` 级问题**（无断链、无伪造行号、无「计划写成已实现」、Node 24 CI 全绿、四项修正全部生效）。
> 第二轮列出的 R1（依赖图重复边）、R2（范围张力）、R3（裸文件名）、R4（微信证据偏间接）**均已消解**。以下 3 项均为**信息级**、可选打磨项：

| # | 级别 | 位置 | 说明 | 是否需要改 |
| --- | --- | --- | --- | --- |
| **N1** | 信息 | §2.3 / §3 / §6.1 | 「丢弃点」简写为 `qq-bridge.mjs:1014`（主入口路径唯一为真）。严格讲交互回复路径另有同形 guard `:1288`，但**文档 L74 已自行披露**，故非遗漏，仅阅读精度提示。 | 否 |
| **N2** | 信息 | 本轮日志头部 | 既有 `DEP0169 url.parse()` Node 24 弃用告警（3 处），属仓库既有代码告警，退出码 0，**不阻塞**。 | 否 |
| **N3** | 信息 | §7.2 L267 | `WG-QQ-12` 条目标题仍含「接话门槛」四字（已标「P2′ 专用」）；实质已被 L184 编号性质说明与「仅门槛与只读统计，不新增回复路径」约束，仅措辞可再收紧。 | 否 |

**残余问题总数：3 项，全部信息级（0 低 / 0 中 / 0 高 / 0 `failing`）。**

### 20. 总体结论（第三轮 · 最终确认）

| 标准 | 结论 |
| --- | --- |
| `links-resolve` | **`passing`** |
| `no-implemented-claims` | **`passing`** |
| `repo-green-ci-node24` | **`passing`** |

- 锚定与末尾复校 sha256 逐位一致（`446ffcf2…f4833`，363 行 / 33625 字节），窗口内文档未被写入。
- 四项修正 **R1–R4 全部生效**，无残留、无回归。
- Node 24（`v24.21.0`）`npm run check` **退出码 0**，`tests 4027 / pass 4027 / fail 0 / cancelled 0`，`Verified dsh-im package artifacts.` 出现；运行前后**无被跟踪文件改动**。
- 残余问题 3 项，全部信息级。

**最终版本通过验收，可提交。**
