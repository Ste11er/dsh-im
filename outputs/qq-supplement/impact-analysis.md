# 影响面分析：QQ 渠道群聊与未 @ 消息

- 工作单元：`map-qq-impact`（模块 `qq-impact`）
- Vibe run：`vibe-linux-1bc2a4ca7da54d96`
- 性质：本 run 的工作产物，**不是** `docs/` 下的规范位置。对外交付物是 `docs/方案/QQ渠道群聊补充目标与计划.md`。

## 0. 结论摘要

1. **QQ 渠道已经具备群聊**：`kind: 'group'`、群会话隔离、群内 @触发、群/私聊分离的访问策略、`/menu`、审批与延迟补发。wechatbot 调研里的"群内 @问答 + 多轮"在 QQ 上**已经可用**。
2. **QQ 是唯一"官方接口就能拿到未 @ 群消息"的渠道**：开放平台提供「群消息（全量模式）」`GROUP_MESSAGE_CREATE`，且仓库已依赖的 SDK 已实现该事件并把它与 `GROUP_AT_MESSAGE_CREATE` 走同一分支。**瓶颈只在 dsh-im 应用层**。
3. **当前的丢弃链**：全量消息到达 → `isQqMessageAddressed()` 判为未点名 → QQ 桥接内部直接 `return`（`src/channels/qq/qq-bridge.mjs:1014`），**不进模型**。这是"收得到但被代码丢弃"，与微信 iLink 的"根本收不到"性质完全不同。
   **注意**：QQ 的桥接类 `QqHarnessBridge`（`qq-bridge.mjs:436`）是**独立类，不继承** `TextHarnessBridge`——继承它的只有 whatsapp/email/discord/slack/matrix/telegram/imessage。因此共享层的 `text-harness-bridge.mjs:255` 拒绝对 QQ **不适用**，QQ 的丢弃点是自己的 `:1014`（交互回复路径另有 `:1288`）。
4. **默认策略是风险点**：QQ 的**群**作用域默认 `openScope()`，即群消息默认全收、@ 即应答，而全仓库**没有任何发送预算/安静时段/dry-run/持久暂停/原文落盘开关**。先接全量消息而不先收紧控制，等于把群里每条消息都送进模型。
5. 不可逆性：本次只新增文档。落地时新能力应挂在既有 QQ 渠道与共享控制层上，可通过配置与开关回退。

## 1. 证据方法与可信度

- **仓库实证**：`src/`、`plugin-src/`、`test/`、`docs/` 内的文件与行号，写入前逐条 `grep -n` / `sed -n` 复核。
- **外部事实**（第 3 节）：QQ 开放平台官方文档与 `node_modules` 中已安装的 SDK 源码。SDK 属于依赖产物而非本仓库源码，故单独成节并标明版本；平台侧「能否开通接收所有消息」**未核验**。
- 无法确认的一律标 `未核验`，不推断。

## 2. QQ 渠道现状（仓库实证）

### 2.1 接入与身份

| 事实 | 证据 |
| --- | --- |
| 官方 QQ 机器人：扫码创建机器人，或 AppID + AppSecret 手动绑定 | `README.md:67` |
| 使用腾讯官方 SDK | `package.json:109`（`@tencent-connect/qqbot-connector@1.2.0`）、`:110`（`@tencent-connect/qqbot-nodejs@1.0.4`）；`src/channels/qq/qq-runtime.mjs:2` |
| WebSocket 长连接，`bot.on('message')` 统一入口 | `src/channels/qq/qq-runtime.mjs:267`、`:253` |
| 只装了 `contentSanitizer` 与 typing 中间件，**未使用** SDK 的 `mentionGate` | `src/channels/qq/qq-runtime.mjs:208`（`bot.use(contentSanitizer…)`） |

### 2.2 会话与路由

| 事实 | 证据 |
| --- | --- |
| 会话键 `c2c:senderId` / `group:groupOpenid` | `src/channels/qq/qq-bridge.mjs:138` |
| 私聊进入 `conversationType: 'direct'`，群聊进入 `'group'` | `src/channels/qq/qq-bridge.mjs:531` |
| 群会话与私聊会话互相隔离，跨群不串话 | 同上（会话键含 `groupOpenid`） |
| 群/私聊均可携带图文与文件 | `README.md:67`；`docs/方案/渠道原生能力建设方案.md:788` |

### 2.3 @模式判定与丢弃点（本次核心）

| 环节 | 代码 | 行为 |
| --- | --- | --- |
| 判定 | `src/channels/qq/qq-mention.mjs:10-15` | 群消息只有在 `rawEventType === 'GROUP_AT_MESSAGE_CREATE'` 或存在平台标记的自mention 时才算"被点名" |
| 归一化 | 同上 `:18-36` | 把自身 mention 从正文剥掉，并打上 `addressedToBot` 标记 |
| 分支 | `src/channels/qq/qq-bridge.mjs:517`、`:528` | 只有 `addressed` 为真才评估访问策略与进入处理 |
| 回复闸门 | `src/channels/qq/qq-bridge.mjs:707` | `addressed ? sendText(...) : Promise.resolve()` |
| 处理闸门（**QQ 真正的丢弃点**） | `src/channels/qq/qq-bridge.mjs:1014` | `if (!isQqMessageAddressed(message)) return;`——未 @ 群消息在此返回，不进入模型；交互回复路径另有 `:1288`。**共享层的 `text-harness-bridge.mjs:255` 对 QQ 不适用**（QQ 桥接不继承 `TextHarnessBridge`） |
| 可观测性缺口 | `src/channels/qq/qq-bridge.mjs:936` | `messagesRejected` **只在访问策略拒绝时**累加；未 @ 丢弃目前**没有计数**，"只入上下文"需要 QQ 自己新增可观测信号 |

**推论**：全量模式的群消息会带着 `rawEventType: 'GROUP_MESSAGE_CREATE'`、`kind: 'group'` 到达 `accept()`，但 `isQqMessageAddressed` 返回 false，于是在**进入模型之前**就被丢掉。这不是"平台不给"，而是**应用层选择不处理**。

### 2.4 访问策略默认值（风险点）

| 作用域 | 默认 | 证据 |
| --- | --- | --- |
| 私聊 direct | owner 白名单（`ownerUserOpenid` 为 `*` 时开放） | `plugin-src/host/channels/shared/access-policy-production.mjs:61-66` |
| **群 group** | **`openScope()`：默认开放** | 同上 |
| 无策略回退路径 | 未注入访问策略时走 `senderAllowed()`，其对**任何**群消息直接返回 true（`:142`） | `src/channels/qq/qq-bridge.mjs:141-144`，调用点 `:538`（分支条件 `this.#accessPolicy ? … : senderAllowed(…)`，`:529-540`） |
| owner 特权 | `ownerUserOpenid` | 同上 `:123` |
| 新机器人种子策略 | `qq` 与 `feishu` 走同一条：direct/group 均开放 | 同上 `:107` |

即：**当前 QQ 群默认接收并响应**，没有群白名单、没有成员角色判定、没有发送预算。

### 2.5 发送类控制缺失（全仓库空白）

发送预算/限频、安静时段、dry-run、账号级持久暂停、渠道侧原文落盘开关——五项均无实现（唯一相近的是邮件渠道只读地**读取**平台限额：`src/channels/email/transports/agent-mail.mjs:105`、`:133`；`src/channels/email/email-runtime.mjs:29` 只管读取轮询）。

**QQ 与微信的一处重要差异**：微信渠道会**无条件落盘出站正文**（`src/channels/weixin/state-store.mjs:14`，全目录 `recentOutbound` 命中 9 处），而 **QQ 的状态存储不含任何出站正文**——`src/channels/qq/state-store.mjs:19-27` 的归一化形状是 `{ version, sessions, includeArchivedSessions, deferred, seenMessageIds }`，`src/channels/qq/` 下 `recentOutbound` **0 命中**。因此第五项"渠道侧不新增持久化"在 QQ 上是**前瞻性配置面**（防止将来新增），不是修复既有违规；QQ 的真实缺口是**前四项**。

### 2.6 测试面

`test/channels/qq/` 下 12 个测试文件（`bridge`、`mention`、`menu`、`markdown-reply`、`runtime`、`state-store`、`state-recovery`、`config-and-qr`、`controller-and-rpc`、`client-api`、`client-ui`、`production`），其中 `test/channels/qq/mention.test.mjs:60` 直接锁定 `GROUP_AT_MESSAGE_CREATE` 的判定语义——**接入全量模式会触达该用例的边界，需要同步扩展而不是删除**。

## 3. 外部事实：平台与 SDK（含未核验边界）

### 3.1 平台侧

QQ 开放平台官方文档列出两个群事件（页面更新于 2026-09-16）：

| 事件 | 语义 |
| --- | --- |
| `GROUP_AT_MESSAGE_CREATE` | 用户在群里 @机器人 时触发 |
| `GROUP_MESSAGE_CREATE` | **群消息（全量模式）**：机器人**开启了"接收所有消息"功能后**，群里每一条消息（不限于 @机器人）都会推送；各字段与前者完全一致 |

来源：<https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html>、<https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html>

**未核验**：开通"接收所有消息"的条件、审核口径与时间，平台运营规范的具体要求——本地无法核验，必须作为落地硬前置单独确认。

### 3.2 SDK 侧（已安装依赖，非本仓库源码）

| 事实 | 证据（`node_modules/@tencent-connect/qqbot-nodejs@1.0.4`） |
| --- | --- |
| 事件常量已定义 | `dist/protocol/gateway/constants.js:60` |
| 全量模式与 @模式**同一分支**处理 | `dist/protocol/gateway/event-dispatcher.js:121`（`eventType === GatewayEvent.GROUP_AT_MESSAGE_CREATE \|\| eventType === GatewayEvent.GROUP_MESSAGE_CREATE`） |
| 产出统一消息结构 | 同上 `:127-128`（`rawEventType: eventType`、`kind: "group"`、`senderId: ev.author.member_openid`、`groupOpenid: ev.group_openid`） |
| 以统一 `message` 事件派发 | `dist/QQBot.js:351`（`this.emit("message", ctx, ctx.message)`） |
| SDK 自带 `mentionGate`（含 `requireMention` 决策）但本仓库未使用 | `dist/middleware/mention-gate.js:77-80`（注释明确写"某些机器人会收到 GROUP_MESSAGE_CREATE，即每条群消息"）；导出见 `dist/index.d.ts:38` |

**结论**：SDK 层不存在阻塞；全量模式事件会以 `kind: 'group'` 抵达 dsh-im 的 `accept()`。

## 4. "收不到" vs "收得到但被代码丢弃"（三渠道对照）

| 渠道 | 未 @ 群消息 | 性质 | 证据 |
| --- | --- | --- | --- |
| 微信 iLink | 收不到 | 协议层无群概念 | `src/channels/weixin/weixin-runtime.mjs:409`；`weixin-api.mjs:14` CDN `/c2c/` |
| **QQ** | **收得到，被应用层丢弃** | 平台 ✅ + SDK ✅ + 应用层 ❌ | `qq-mention.mjs:13`；`qq-bridge.mjs:528/707`；丢弃点 `qq-bridge.mjs:1014`（**非**共享层） |
| WhatsApp | 收得到，被应用层丢弃 | 协议聚合全量，按"未点名"丢弃 | `src/channels/whatsapp/whatsapp-runtime.mjs:355`；`text-harness-bridge.mjs:255` |

这条区分直接决定"群聊与接话该在哪个渠道做"：微信需要换通道，QQ 只需要改应用层 + 拿到平台能力。

## 5. 改动面（落地时，本次不改）

| 面 | 位置 | 说明 |
| --- | --- | --- |
| 事件接入 | `src/channels/qq/qq-mention.mjs`、`qq-runtime.mjs` | 识别 `GROUP_MESSAGE_CREATE`，并保持默认"未 @ 不回复" |
| 分支闸门与丢弃点 | `src/channels/qq/qq-bridge.mjs:517`、`:528`、`:707`、**`:1014`**（交互回复路径另见 `:1288`） | 区分"被点名"与"仅入上下文"，不要把未 @ 直接放进回复路径；`:1014` 是当前真正的返回点 |
| 可观测信号 | `src/channels/qq/qq-bridge.mjs:936` | 现状只有访问策略拒绝计数；未 @ 入上下文需新增独立信号 |
| 访问策略默认 | `plugin-src/host/channels/shared/access-policy-production.mjs:61-66`、`:107` | 群默认由 `openScope()` 收紧为关闭/白名单；群内命令权限若要用 `member_role`，其可得性**未核验**（见第 7 节第 4 条），缺失时按最窄权限降级 |
| 共享控制层 | 建议新增共享模块（如 `src/channels/shared/send-control.mjs`，**建议名**，落地前需复核命名） | 控制在 QQ 的落点；QQ 复用同一套。其中"渠道侧不新增持久化"在 QQ 属前瞻配置（见 2.5） |
| 客户端设置 | `plugin-src/client/channels/qq/*` | 群默认策略与控制开关的入口 |
| 测试 | `test/channels/qq/*` | 扩展现有 `mention.test.mjs`，不改其既有语义 |

## 6. 本次改的 / 本次不动的

**改（新增）**：`docs/方案/QQ渠道群聊补充目标与计划.md`、`outputs/qq-supplement/*.md`
**不动**：`src/`、`plugin-src/`、`lib/`、`README*`、`CHANGELOG.md`、已冻结的 `docs/方案/微信个人号群聊补充目标与计划.md`

## 7. 未核验项

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 开放平台"接收所有消息"能否开通、审核口径与时长 | `未核验`（外部事实） |
| 2 | 全量模式下平台是否对机器人的接收频率/范围另有限制 | `未核验` |
| 3 | 全量模式对群成员隐私的影响与平台合规要求 | `未核验`，需在启用前评估 |
| 4 | `member_role`（owner/admin/member）是否可用于群内命令权限 | 官方事件体文档在 User 结构中列出该字段，但**本仓库与已装 SDK 均 0 命中**（`src/`、`plugin-src/`、`test/` 及 SDK `dist/` 全无 `member_role`/`memberRole`）；SDK 的归一化消息**不暴露**该字段，不过 group 分支保留了原始事件 `raw: ev`（`node_modules/@tencent-connect/qqbot-nodejs/dist/protocol/gateway/event-dispatcher.js:143`），理论上可读 `message.raw.author.member_role`。实际载荷是否携带该字段 `未核验`；缺失时必须按最窄权限降级，不得假设平台一定提供 |
| 5 | QQ 群消息的发送配额与限流阈值 | `未核验`（README 只提到文件上传配额，`README.md:105`） |
| 6 | 全量模式事件在真实机器人上的到达延迟与顺序保证 | `未核验` |

## 8. 不可逆性与回滚

- 本次：只新增文档，无不可逆操作。
- 落地时：全量模式接入应保留"未 @ 只入上下文、不回复"的默认与独立开关；异常时关闭该开关即回到 @模式，不影响其余 13 个渠道。群默认策略收紧属于配置默认值变更，需要迁移说明与回滚路径。
