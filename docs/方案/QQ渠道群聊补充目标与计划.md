# QQ 渠道群聊补充目标与计划

> 当前实现更新（2026-10-24）：本文的 P2′ 是历史规划，不能据此判断当前版本不支持自主接话。当前已经实现可配置的“群聊自主参与”，支持不做概率抽样、独立判断模型和可调冷却；实际是否启用及触发结果以运行时配置/统计为准。使用说明见[QQ群聊自主参与](../QQ群聊自主参与.md)。平台仍须投递未 @ 群消息；代码实现与平台实际输入、模型执行、QQ 发送成功是不同事实。


> **状态声明**：本文是**计划与决策文档**，不是已实现能力清单。
> 文中的「改动位置」「验收方式」都是后续落地清单，**当前仓库没有任何一项已实现**；引用 `src/`、`plugin-src/`、`node_modules/` 的路径与行号只用于说明现状与落点。
> 本文由 Vibe run `vibe-linux-1bc2a4ca7da54d96` 产出（工作底稿见 `outputs/qq-supplement/`）。
> 凡未从仓库证据或真实实测确认的，一律标 `未核验`。

## 1. 背景与定位

### 1.1 为什么要单独规划 QQ

微信渠道的群聊诉求已被确认为**协议层不可能**，并已归档结案（见 [微信渠道已达成的能力.md](微信渠道已达成的能力.md)）。QQ 则不同：

| 维度 | 微信 iLink | **QQ 官方机器人** |
| --- | --- | --- |
| 群聊 | 协议层无群概念 | **已具备**（`kind: 'group'`） |
| 未 @ 群消息 | **收不到** | **收得到**（平台提供「群消息（全量模式）」），当前被应用层丢弃 |
| 接入性质 | 官方通道 | 官方通道 |
| 第三方协议风险 | 无（但群能力缺失） | 无 |

因此 QQ 是**不引入第三方协议**就能同时获得「群内 @问答」与「未 @ 群消息」的路径。

### 1.2 定位（不得改写）

1. QQ 计划是**并行的官方路线**，不是微信方案的补救或替代。
2. **官方机器人身份 ≠ 个人号**（`README.md:67`：扫码创建机器人或 AppID + AppSecret 手动绑定）。QQ 满足「群内交互」诉求，**不满足**「个人微信号进普通群」这一账号形态；**不得**表述为"个人号目标已达成"。
3. **控制先于能力**：QQ 群访问策略收紧与发送类控制，**先于**接入全量群消息。
4. 未 @ 低频接话在 QQ 上升级为「**有门槛的候选目标**」，但**默认关闭**。

### 1.3 与微信两份文档的关系

- 引用并结案：[微信渠道已达成的能力.md](微信渠道已达成的能力.md)（微信能力归档）。
- 引用但不修改：[微信个人号群聊补充目标与计划.md](微信个人号群聊补充目标与计划.md)（**已冻结验收**，其证据哈希不得改写）。
- 控制规范的分层词汇（L1 入站 / L2 被动回复 / L3 主动投递 / L4 后台结果补发）、判定顺序与两条改写，沿用 `outputs/wechatbot-supplement/controls-spec.md`，本文只写 QQ 适配。

### 1.4 验收方式

- 每条结论可回溯到仓库文件与行号，或明确标 `未核验`。
- 需要落地的条目，验收门统一为 `npm run check`（`package.json:99-103`：`build` → `node --test` → `scripts/verify-package.mjs`；本仓库**无 lint/typecheck**；CI 固定 **Node 24**）。
- 需要真实账号或平台审核才能回答的问题，不由本计划宣告结论。

## 2. 现状差距矩阵（含证据）

### 2.1 已具备（QQ 不需要重做）

| 能力 | 证据 |
| --- | --- |
| 官方机器人接入（扫码 / AppID+AppSecret）、WebSocket 长连接 | `README.md:67`；`package.json:109-110`（`@tencent-connect/qqbot-connector@1.2.0`、`@tencent-connect/qqbot-nodejs@1.0.4`）；`src/channels/qq/qq-runtime.mjs:2`、`:267` |
| 群聊与私聊双形态、会话隔离 | `src/channels/qq/qq-bridge.mjs:137-138`（`c2c:senderId` / `group:groupOpenid`） |
| 群内 @触发 | `src/channels/qq/qq-mention.mjs:10-15` |
| 文字 / 图片 / 普通文件、Markdown、`/menu`（按钮 + 数字）、私聊 typing | `README.md:67`、`README.md:212`；`docs/方案/渠道原生能力建设方案.md:788` |
| 共享审批、延迟补发 | `src/channels/shared/harness-approval.mjs:13-14`；`src/channels/qq/qq-bridge.mjs:494`、`:740-741` |
| 测试覆盖 | `test/channels/qq/` 下 12 个测试文件 |

### 2.2 未具备

| 缺口 | 现状 | 证据 |
| --- | --- | --- |
| **未 @ 群消息处理** | 事件到达后被判"未点名"并**静默丢弃** | 见 2.3 |
| **群默认开放** | 群作用域 `openScope()`：群内任何人 @ 即进模型、且可执行命令 | `plugin-src/host/channels/shared/access-policy-production.mjs:61-66`、`:105-109`；命令权限 `src/channels/shared/access-policy.mjs:201-207` |
| **发送类控制** | 发送预算/限频、安静时段、dry-run、账号级持久暂停、渠道侧不新增持久化——**五项全无**（全仓库空白） | 最接近的是邮件渠道只读地**读取**平台限额：`src/channels/email/transports/agent-mail.mjs:105`、`:133` |
| 未 @ 的可观测信号 | `messagesRejected` **只在访问策略拒绝时**累加；未 @ 丢弃无计数 | `src/channels/qq/qq-bridge.mjs:936` |
| 群级白名单 | 策略 allowlist 过滤的是 **senderIds（成员 openid）**，不是 `groupOpenid` | `src/channels/qq/qq-bridge.mjs:532`；`src/channels/shared/access-policy.mjs:188-200` |

**注（QQ 与微信的一处差异）**：微信无条件落盘出站正文（`src/channels/weixin/state-store.mjs:14`，`recentOutbound` 命中 9 处），而 QQ 的状态存储**不含任何出站正文**（`src/channels/qq/state-store.mjs:19-27`，`recentOutbound` 0 命中）。**两项陈述不矛盾**：五项控制在 QQ 上确实**都没有实现**（见上表），但其中第五项在 QQ 属**预防性**而非**修复性**——QQ 没有可修复的正文落盘，它防范的是全量模式接入后新引入的入站原文落盘。因此 QQ 当前**被实际需要**的缺口是**前四项**。

### 2.3 关键事实：未 @ 消息"收得到但被代码丢弃"

| 环节 | 证据 |
| --- | --- |
| 平台提供全量模式 | 「群消息（全量模式）」`GROUP_MESSAGE_CREATE`：机器人**开启"接收所有消息"功能后**，群里每条消息（不限于 @机器人）都会推送。来源：<https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html> |
| SDK 已支持（依赖产物，非本仓库源码） | `node_modules/@tencent-connect/qqbot-nodejs@1.0.4` `dist/protocol/gateway/constants.js:60` 定义事件；`dist/protocol/gateway/event-dispatcher.js:121-128` 把它与 `GROUP_AT_MESSAGE_CREATE` 放**同一分支**并产出 `kind: "group"`；`dist/QQBot.js:351` 统一派发 `message` 事件 |
| 应用层判为未点名 | `src/channels/qq/qq-mention.mjs:10-15` 只认 `GROUP_AT_MESSAGE_CREATE` 或平台标记的自 mention |
| **丢弃点（QQ 自己的）** | `src/channels/qq/qq-bridge.mjs:1014`（`if (!isQqMessageAddressed(message)) return;`），交互回复路径另见 `:1288` |
| 分支与回复闸门 | `src/channels/qq/qq-bridge.mjs:517`、`:528`、`:707` |
| **更正** | QQ 的 `QqHarnessBridge`（`qq-bridge.mjs:436`）**不继承** `TextHarnessBridge`——继承它的只有 whatsapp/email/discord/slack/matrix/telegram/imessage。因此共享层 `src/channels/shared/text-harness-bridge.mjs:255` 的未 @ 拒绝对 **QQ 不适用**，QQ 的丢弃点是自己的 `:1014` |

**结论**：瓶颈在 **dsh-im 应用层**，不在平台与 SDK。"接入全量模式"不是换通道、不是协议逆向，而是把 `:1014` 的丢弃改成"入上下文"。

### 2.4 三条渠道的真假区分（不可混写）

| 渠道 | 未 @ 群消息 | 性质 | 证据 |
| --- | --- | --- | --- |
| 微信 iLink | **收不到** | 协议层无群 | `src/channels/weixin/weixin-runtime.mjs:409`（只接受 `kind === 'user'`）；`src/channels/weixin/weixin-api.mjs:14`、`:174`、`:326`（CDN 路径硬编码 `/c2c/`）；旁证 `docs/上下文增强.md:3`「微信当前只支持私聊」 |
| **QQ** | **收得到，被应用层丢弃** | 平台 ✅ + SDK ✅ + 应用层 ❌ | `qq-bridge.mjs:1014` |
| WhatsApp | 收得到，被应用层丢弃 | 协议聚合全量，按未点名丢弃 | `src/channels/whatsapp/whatsapp-runtime.mjs:355`；`text-harness-bridge.mjs:255` |

## 3. 目标分层

| 层 | 目标 | 准入条件 | 交付物 | 退出条件 |
| --- | --- | --- | --- | --- |
| **P0′** | 控制收紧：QQ 群默认策略 + 成员角色/命令权限 + 发送类控制 | 无前置，可立即开始；只动共享控制层与 QQ 接线；不接全量事件、不改平台申请 | `WG-QQ-01`…`WG-QQ-09` | 群默认不再 `openScope()`；dry-run 可观察候选；控制在 QQ 出口生效；关闭时发送行为与现状一致；`npm run check` 通过 |
| **P1′** | 全量接入：识别并接收 `GROUP_MESSAGE_CREATE`，**默认只入上下文、不回复** | **P0′ 全部退出条件满足**（硬前置）；平台"接收所有消息"**已获批且有可复现的脱敏到达记录**（当前 `未核验`） | `WG-QQ-10`、`WG-QQ-11`（`WG-QQ-12` 属 P2′ 的门槛统计、`WG-QQ-13` 属降级分支 D′，**不计入 P1′ 范围**） | 未 @ 群消息进入上下文且**默认回复率 0**；@消息行为零回归；上下文有上限；关开关即回到 @模式 |
| **P2′** | 未 @ 低频自主接话：**有门槛的候选目标**，**默认关闭** | 仅**证据门槛**（见第 8 节）；须先满足 P1′；群成员知情同意；负责人独立书面接受 | **无交付物**（门槛通过后另立独立决策与设计） | **不设退出条件**；未过门槛即维持默认关闭 |
| **降级分支 D′** | 平台未获批时：全量接入不启动，确定回到 @模式 | 申请被拒 / 长期无结论 / 到达证据不可复现 | 否定结论记录 + `WG-QQ-13` 开关默认值 | 全量事件零接线或开关默认关闭；P2′ **因不具备输入源而不启动**；QQ 其余能力无回归 |

**P2′ 的性质变更**：微信计划把未 @ 接话写成"不承诺目标、无 backlog 条目"；QQ 因平台原生提供全量消息而升级为"**有门槛的候选目标**"——但**默认关闭**、门槛与知情前提不变，且**不随 P1′ 完成自动解锁**。

## 4. QQ 群访问策略收紧（P0′ 核心）

### 4.1 现状与风险

现状：群作用域 `openScope()`，即 **`mode: 'open'` + `defaultCanExecuteCommands: true`**（`access-policy-production.mjs:61-66`），新连接的 QQ 机器人 direct 与 group 都开放（`:105-109`）。命令权限在 `open` 模式下由 `defaultCanExecuteCommands` 决定（`access-policy.mjs:201-207`）。

由此产生的三个直接风险：

1. **群内任何人都能触发问答**：群消息只要被 @ 就进入模型（`qq-bridge.mjs:517`、`:528`）。
2. **群内任何人都能执行命令**：涵盖 `/stop`、`/model`、`/preset`、`/m`、`/compact` 等共享本地命令。
3. **无发送侧兜底**：群一旦开放，五项控制全无（见 2.2）。

另两条必须写进迁移说明的事实：

- `ownerUserOpenid` 是**硬编码特权旁路**（`access-policy-production.mjs:123`；`src/channels/shared/inbound-access.mjs:24-27`），命中即放行、绕过整份持久策略。收紧方案把它当作"已知恒定例外"，**不是**要改掉它。
- `ownerUserOpenid: '*'` 的本意是"私聊不限发送者"，但 group 分支与 `*` 无关、恒为 open（`:61-66`）。**收紧时必须明确：`*` 只在 direct 生效，group 不因 `*` 开放。**

### 4.2 建议默认（三档，逐群可覆盖）

| 档 | group 作用域 | 谁能触发问答 | 谁能执行命令 | 定位 |
| --- | --- | --- | --- | --- |
| **A：关闭（推荐默认）** | `mode: 'allowlist'`，`users` 仅显式加入者 | 仅显式加入者 | 仅 owner | **新默认**，需配迁移说明 |
| B：成员白名单 | `mode: 'allowlist'`，`users` = 批准成员 | 白名单成员 | `defaultCanExecuteCommands: false`，逐人显式授予 | 需要群内问答时的推荐档 |
| C：开放 | `mode: 'open'` | 群内所有人 | **至少** `defaultCanExecuteCommands: false` | 仅显式选择，**不得作为默认** |

**两个必须写清的边界**：

- A/B 档在现有数据类型下**可直接表达**（`allowlistScope(users)`），改动是"默认值 + 既有机器人一次性迁移"；迁移位置是 **Host workspace 里已保存的策略文档**（`accessPolicyProvider` 读 `workspaces.accessPolicyFor(botId)`，`access-policy-production.mjs:129-137`），**不在 QQ 的 config-store**。迁移脚本与回滚路径 `未核验`。
- **真正的"群白名单"（按 `groupOpenid`）当前不可表达**：策略 allowlist 匹配的是成员 `member_openid`（`access-policy.mjs:188-200`；QQ 传入 `senderIds: sender`，`qq-bridge.mjs:532`）。在此之前，A 档的效果是"该群里只有白名单成员能触发"，**不等于"整群静默"**。这是需要新增维度的一项，`未核验`。

### 4.3 成员角色用于命令权限（可用性未核验）

- **身份基准是 `senderId`（`author.member_openid`）**；**绝不**用 `senderName`（显示昵称）当身份——昵称可改可重名。仓库现有用法只在上下文增强里传 `senderName`（`qq-bridge.mjs:702`、`:803`、`:880`）。
- **可用性**：SDK 归一化的群消息**不含** `member_role`（群分支只产 `senderId` / `senderName` / `senderIsBot` / `content` / `raw` 等，`event-dispatcher.js:121-148`），整个已安装 SDK 的 `dist/` 内 `member_role` **零命中**。角色只能从保留的原始事件读取：`message.raw.author.member_role`（`raw: ev`，`event-dispatcher.js:143`）。**取值集合**已由官方事件文档给出（`member` / `admin` / `owner`），但**该字段是否真的随载荷到达、以及稳定性 `未核验`**（仓库与 SDK 均 0 命中，只能实测确认）。
- 设计要点：角色**不是身份**，不可作为 allowlist 的键；与 openid 白名单是 **AND** 关系；门槛建议"命令默认仅 `owner`/`admin` 可执行，`member` 需显式授权"；角色缺失按 `member` **fail-closed**；拒绝复用既有 `COMMAND_PERMISSION_DENIED_MESSAGE`（`inbound-access.mjs:4`）与 QQ 拒绝路径（`qq-bridge.mjs:928-936`），该回执属 **L2 被动回复**，不受暂停/预算/安静时段约束。
- 同一用户跨群的 `member_openid` 是否一致 `未核验`，因此成员白名单建议**按群分别维护**。

## 5. 发送类控制在 QQ 的落点（要点）

分层与判定顺序（暂停 → dry-run → 预算 → 安静时段 → 真实发送）沿用微信那份规范。QQ 账号粒度是 `botId`；QQ 的三类出站落点：**L2 被动回复**（`qq-bridge.mjs:707` 等）、**L3 主动投递**（`plugin-src/host/delivery-adapter.mjs:7-13` 的频道集合含 `qq` → `sendProactiveText`）、**L4 后台结果补发**（`qq-bridge.mjs:740-741`）。

| 控制 | 触发点 | 作用域 | 默认值 | 重启行为 | 可观测信号（设计） |
| --- | --- | --- | --- | --- | --- |
| 发送预算/限频 | L3/L4 出口；**不拦 L2** | 账号级（`botId`）为主，可选会话级子预算 | **关闭**（不限额） | 开关与阈值随账号配置持久化；窗口计数是否持久化 `未核验` | `budget: { enabled, window, limit, used, resetsAt }` |
| 安静时段 | L3/L4 出口；**明确不拦 L2** | 账号级默认，可逐群覆盖 | **关闭** | 窗口配置与待投递队列持久化（可行性 `未核验`） | `quietHours: { enabled, window, timezone, active, nextResumeAt, queued }` |
| dry-run | 出站闸门最外层之一，拦 L3/L4；默认不拦 L2（菜单在预览下仍应可见） | 账号级，可会话级覆盖 | **关闭**（真发） | 开关持久化；预览记录内存态 | `dryRun: { enabled, suppressedCount, lastPreviewAt }` |
| 账号级持久暂停 | 出站闸门最外层，优先级最高；不拦 L1/L2 | 账号级 | **未暂停** | **必须持久化**，恢复需显式操作 | `paused: { active, reason, since, by }` |
| 渠道侧不新增持久化 | 渠道 `state-store` 写入点与渠道级正文日志 | 渠道 × 账号 | **不改变现状**（QQ 本无出站正文落盘，属前瞻配置） | 模式持久化；历史数据清理策略 `未核验` | `rawRetention: { mode, since }` |

**QQ 特有的两条依据**：

1. **L2 不需要本地预算**：QQ 被动回复自身有平台硬上限——同一 `msg_id` 最多 `c2c 4 / group 5` 条（`src/channels/qq/markdown-reply.mjs:11`、`:49`）。这恰好印证预算只应作用在 L3/L4。
2. **计数按实际发送段**：QQ 长文切分后逐条发送（`markdown-reply.mjs:46` 调用 `chunkMarkdownParts`，`:49` 起按平台被动上限处理），按调用计数会低估消耗。

## 6. 与 QQ 特有交互的对照

### 6.1 @模式 与 全量模式

| 形态 | 轨迹 | 控制如何生效 |
| --- | --- | --- |
| @模式 `GROUP_AT_MESSAGE_CREATE` | 判为被点名（`qq-mention.mjs:10-15`）→ 访问策略（`qq-bridge.mjs:528`）→ 回合 → L2 | L1 由访问策略收紧；L2 不受暂停/预算/安静时段约束；只有 L3/L4 受控制 |
| 全量模式 `GROUP_MESSAGE_CREATE` | 同分支到达（SDK `event-dispatcher.js:121-128`），但判为未点名 → `qq-bridge.mjs:1014` 直接返回 | 接入后改为"只入上下文、不回复"；此形态下第五项是主控制；只有未来接话把某条晋升为 L3 时其余四项才生效 |

**要点**：接入全量模式**不是放宽控制**，而是把 `:1014` 的丢弃改成"入上下文"；必须独立开关、异常时关掉即回到 @模式。两种形态的 `senderIds` 都是 `member_openid`，因此访问策略与角色判定同样适用；但未 @ 消息即使被策略拒绝也不产生拒绝回执，且该路径**没有** `messagesRejected` 计数，需新增可观测信号。

### 6.2 `/menu` 与数字菜单

显式菜单 `/m`、`/menu`（`qq-menu.mjs:15`）；数字选择仅在 `addressed` 且菜单属于该 `(key, sender)` 时解释（`qq-bridge.mjs:522-527`）。菜单渲染走 `sendQqMenu`（`:768`），属 **L2**：暂停/预算/安静时段**都不得**拦它；dry-run 下菜单仍应可见，否则无法在影子模式下验证。菜单是内存态、TTL 15 分钟（`qq-menu.mjs:6`、`:33`），重启即丢，**不是** L4。

### 6.3 共享审批闭环

QQ 在共享审批渠道列表内（`harness-approval.mjs:13-14`），默认超时 60 分钟并自动拒绝（`:24`），队列实例在 `qq-bridge.mjs:500`。**暂停/预算耗尽/安静时段均不得**取消待审批项、触发自动拒绝或缩短超时；被 L3 拦下时必须保证 Web 端仍可看到并处理。审批回复文本不是命令，不经过角色门槛。

### 6.4 延迟补发（含 `attempts` 硬约束）

QQ 已接共享协调器（`qq-bridge.mjs:494`、`:740-741`、`:796`、`:1111`）。**静默等待、预算耗尽、账号暂停造成的"尚未尝试"一律不计入 `attempts`**，状态保持 `pending`；否则 `attempts >= 3` 即 `failed`（`deferred-delivery.mjs:157`）会永久丢结果。本地控制的"尚未尝试"与 `deliveryOutcome: 'unknown'`（`deferred-delivery-coordinator.mjs:172`，置 `failed` 且不自动重试）是两件事，不得混同。账号暂停期间应**冻结**补发定时器。

**QQ 特有**：待补发的群结果持有 `{ scope: 'group', targetId }`（`qq-bridge.mjs:1111`）。**群默认收紧只作用于 L1 准入，不得回溯阻断已在 `pending` 的 L4 投递**——已被批准进入回合的群，其后端结果仍应能回到原群。

### 6.5 主动投递（QQ 没有 `context_token`）

`context_token` 在**生产代码**中只出现在微信渠道（`src/channels/weixin/weixin-bridge.mjs:425`、`:670` 等；`test/` 下另有少数夹具引用），**QQ 不适用**微信那份文档关于令牌消耗/失效的约束。QQ 主动投递路径：`plugin-src/host/delivery-adapter.mjs:7-13`（频道集合含 `qq`）→ `sendProactiveText` → `#bot.sendText`。**按设计**，控制命中时不会走到平台发送，因而不产生 `providerMessageIds`；需要另行确认的是"目标是否仍可达"（机器人被移出群、群解散、openid 失效），属平台侧错误，诊断须与本地控制可区分（可达性与平台主动消息限制 `未核验`）。

## 7. backlog（`WG-QQ-01`…`WG-QQ-13`）

> **编号性质说明**：`WG-QQ-01`…`WG-QQ-11` 是**实现条目**；`WG-QQ-12` 是 **P2′ 的门槛统计条目**（只有只读统计，不含回复路径），`WG-QQ-13` 是**降级条目**。后两条**不属于 P1′ 范围**，也不构成"P2′ 的实现 backlog"。

### 7.1 P0′：控制收紧

**WG-QQ-01 QQ 群默认策略收紧**
- 现状证据：群作用域 `openScope()`（`access-policy-production.mjs:61-66`），新机器人 direct/group 均开放（`:105-109`）。
- 改动位置：`access-policy-production.mjs` 的 QQ 分支与新机器人种子；**迁移作用于 Host workspace 已保存的策略文档**（`:129-137`）。
- 依赖：无（可立即开始）。
- 验收：新连接默认落 A 档；既有机器人迁移幂等可回滚；`*` 只在 direct 生效；未 @ 行为不变（本就在 `qq-bridge.mjs:1014` 丢弃）；`npm run check` 通过。
- 不做项：不实现按 `groupOpenid` 的群级白名单（另立）；不改 owner 特权旁路；不做静默整群。

**WG-QQ-02 成员角色与群内命令权限**
- 现状证据：`openScope()` 的 `defaultCanExecuteCommands: true`（`access-policy.mjs:201-207`）；`member_role` 在仓库与 SDK 均 0 命中，只能从 `message.raw.author.member_role` 读（`event-dispatcher.js:143`）。
- 改动位置：`qq-bridge.mjs:529-537` 的 `evaluateInboundAccess` 之前。
- 依赖：`WG-QQ-01`。
- 验收：角色缺失按 `member` fail-closed；角色不可作为 allowlist 键；拒绝走既有 L2 文案与路径。
- 不做项：不假设平台一定提供角色字段；不把昵称当身份；不做跨群全局名单。

**WG-QQ-03 账号级持久暂停**
- 现状证据：无持久暂停配置。
- 改动位置：账号状态模块 + 持久化（QQ 的 `src/channels/qq/config-store.mjs:7`、`:109`，或另立文件——落点 `未核验`）。
- 依赖：无；被 `WG-QQ-04`/`05`/`06` 在发送前引用。
- 验收：重启后仍暂停；暂停期间待发项不再执行；恢复须显式操作。
- 不做项：不声称能自动识别只出现在手机端的平台警告；不承诺撤回在途消息。

**WG-QQ-04 发送预算与限频**
- 现状证据：全仓库无账号级发送预算；最接近的是邮件渠道只读平台限额（`agent-mail.mjs:105`、`:133`）。
- 改动位置：建议新增共享模块（**建议名** `src/channels/shared/send-control.mjs`，落地前复核）；接线点 L3（`plugin-src/host/delivery-adapter.mjs:316`/`:407` 之后）与 L4（`qq-bridge.mjs:740-741`）。
- 依赖：`WG-QQ-03`。
- 验收：并发多群不突破账号上限；超限不补发；重放同一消息不产生第二次发送；按"发送段"计数。
- 不做项：不做跨渠道统一预算；不改 L2；不做探测式退避。

**WG-QQ-05 安静时段**
- 现状证据：全仓库无时间窗发送抑制。
- 改动位置：同一共享模块 + 配置读取；时区来源 `未核验`。
- 依赖：`WG-QQ-04`。
- 验收：注入可控时钟的单测——窗口内 L3/L4 零发送；**L2 照常**；窗口结束不补发积压。
- 不做项：不约束被动回复；不做按群差异化时段与节假日日历。

**WG-QQ-06 dry-run**
- 现状证据：全仓库无 dry-run / 预览发送。
- 改动位置：共享发送层 + 客户端入口（`plugin-src/client/channels/qq/*` 与 `delivery-settings.js`）。
- 依赖：`WG-QQ-03`、`WG-QQ-04`。
- 验收：开启时 L3/L4 记录候选且平台调用计数为 0；L2（含菜单、`/stop` 回执）照常；默认关闭。
- 不做项：不做逐条人工确认 UI；不吞掉 L2 反馈。

**WG-QQ-07 渠道侧不新增持久化**
- 现状证据：QQ 状态存储**不含**出站正文（`src/channels/qq/state-store.mjs:19-27`，`recentOutbound` 0 命中），与微信不同。
- 改动位置：QQ `state-store` 写入点 + 配置面。
- 依赖：`WG-QQ-03`。
- 验收：提供配置面且**默认不改变现状**；全量模式接入后入站原文不得因新代码落盘。
- 不做项：**不表述为"QQ 正在落盘原文"**；不做历史数据清理迁移。

**WG-QQ-08 客户端设置入口**（贯穿 P0′/P1′）
- 现状证据：QQ 客户端已有机器人卡片与设置面（`plugin-src/client/channels/qq/index.js`）。
- 改动位置：`plugin-src/client/channels/qq/*`、`access-policy-settings.js`、`delivery-settings.js`。
- 依赖：`WG-QQ-01`…`WG-QQ-07`。
- 验收：群默认档位、角色门槛、五项控制开关可见可回退；默认值与后端一致。
- 不做项：不在面板暴露原始 openid 列表以外的敏感信息；不新增客户端框架。

**WG-QQ-09 测试与质量门**（贯穿）
- 现状证据：唯一质量门 `package.json:99-103`；`test/channels/qq/` 12 个文件。
- 改动位置：`test/channels/qq/*`，**扩展** `mention.test.mjs:59-67` 的既有语义而非删除。
- 依赖：`WG-QQ-01`…`WG-QQ-08`。
- 验收：`npm run check` 在 CI 同版本 Node 24 下通过；覆盖群默认收紧、角色 fail-closed、五项控制与 L2 放行、重启后暂停保持。
- 不做项：不引入 lint/typecheck；不依赖真实 QQ 账号跑 CI。

### 7.2 P1′：全量接入

**WG-QQ-10 平台申请"接收所有消息"（未核验硬前置）**
- 现状证据：官方文档写明需机器人开启该功能后才推送全量事件。
- 改动位置：**仓库外**（开放平台申请 + 运营规范合规）；仓库内只新增结论记录。
- 依赖：无，**应最先启动**（等待周期不可控，但不改代码）。
- 验收：给出获批/被拒的明确结论与（若获批）脱敏、可复现的到达记录；结论可被独立复核。
- 不做项：不在获批前写全量接入代码；不把"能收到"当既定事实；不做平台合规结论。

**WG-QQ-11 全量事件接入（默认只入上下文、不回复）**

实施状态（2026-10-23）：已实现默认关闭的独立开关、按群隔离的有界内存上下文、后续 @ 问答注入，以及面板/RPC/持久化配置。已有[真实到达记录](../../outputs/qq-integration/access-test-report.md)仅证明受测机器人具备输入源；本次新增功能以离线替身验收，未重新连接真实群或测量模型费用。详见[使用说明](../QQ群聊上下文.md)与[验收报告](../../outputs/qq-impl/wg-qq-11-verification.md)。P2′ 不随本条完成启用。

- 实施前证据：未 @ 群消息在当时的 `qq-bridge.mjs:1014` 直接返回；非被点名时 `send` 恒为空操作（`:707`）。
- 改动位置：`qq-mention.mjs`（区分"被点名"与"仅入上下文"）、`qq-bridge.mjs:517/528/707` 与 **`:1014`（丢弃点改为入上下文）**；**须独立开关、默认关闭**。QQ 桥接不继承 `TextHarnessBridge`，共享层不参与该判定。
- 依赖：`WG-QQ-10` 获批；P0′ 全部退出条件。
- 验收：未 @ 群消息进入上下文且**默认回复率 0**；@消息零回归；`group:groupOpenid` 隔离保持；上下文条数/字符/成本有上限；关开关即回到 @模式。
- 不做项：不做未 @ 自动回复（属 P2′）；不动共享层语义；此阶段不写接话策略。

**WG-QQ-12 未 @ 上下文与接话门槛（P2′ 专用）**
- 现状证据：无未 @ 输入（`qq-bridge.mjs:1014` 丢弃）；无参与策略、无冷却、无门槛记录。
- 改动位置：**仅门槛与只读统计**，不新增回复路径。
- 依赖：`WG-QQ-11`（无输入源则本条目不启动）。
- 验收：六项门槛（第 8 节）全部满足才允许讨论启动；统计可复核。
- 不做项：**不写触发规则/冷却/概率/上下文裁剪**；不排入实现 backlog。

**WG-QQ-13 降级回 @模式**
- 现状证据：当前即为 @模式（`qq-mention.mjs:10-15`）。
- 改动位置：`WG-QQ-11` 的开关默认值 + 文档。
- 依赖：`WG-QQ-10`。
- 验收：未获批时全量事件零接线或开关默认关闭；P2′ 明确不启动；QQ 其余能力无回归。
- 不做项：不在降级后把诉求改写成"企微替代"或"微信替代"。

### 7.3 依赖关系

```text
WG-QQ-10（平台申请，仓库外）
   └─ 获批 ──> WG-QQ-11（全量接入，默认只入上下文）──> WG-QQ-12（P2′ 门槛）
   └─ 未获批 ─> WG-QQ-13（降级回 @模式，P2′ 不启动）

P0′：WG-QQ-01 ──> WG-QQ-02
      WG-QQ-03 ──> WG-QQ-04 ──> WG-QQ-05
             └────> WG-QQ-06（dry-run 同时依赖 03 与 04）
      WG-QQ-07（依赖 03）
      WG-QQ-08 / WG-QQ-09（贯穿，最后收口）
P1′ 前置：P0′ 全部退出条件 + WG-QQ-10 获批
```

## 8. P2′ 的证据门槛（仅门槛，不含设计）

**性质**：有门槛的候选目标，**默认关闭**，**不随 P1′ 完成自动解锁**。以下门槛全部满足才允许讨论启动：

| # | 门槛 | 当前状态 |
| --- | --- | --- |
| 1 | 平台"接收所有消息"已获批，且有可复现的脱敏到达记录 | `未核验`（`WG-QQ-10`） |
| 2 | P1′ 稳定运行：未 @ 入上下文、默认回复率 0、有上限 | 依赖 P1′ 退出条件 |
| 3 | P0′ 五项控制在真实账号上验证有效 | 依赖 P0′ 退出条件 |
| 4 | 群成员**知情同意**的证据（群公告、参与范围、退出方式） | 缺失 |
| 5 | 一轮观察期统计：误回复、重复发送、成员反馈、成本 | 缺失 |
| 6 | 负责人对"打扰与账号/合规风险"的独立书面接受 | 缺失 |

**明确不做**：不写自主接话的设计草案（触发规则、冷却、概率、上下文裁剪一律不谈）；不列 P2′ 的**实现** backlog 条目（`WG-QQ-12` 只是门槛统计，不新增回复路径）。

## 9. 明确不做项（全局）

1. 本轮不改任何代码，不创建 issue，不推送远端；不动 `src/`、`plugin-src/`、`README*`、`CHANGELOG.md` 与**已冻结的微信计划文档**。
2. **不把"官方机器人身份"写成"个人号目标已达成"**；不把 QQ 说成微信方案的替代或补救。
3. **不把平台"接收所有消息"当作既定能力**；未获批不写全量接入代码，且 P2′ 不启动。
4. 不在 P0′ 完成前开启全量模式；不让未 @ 群消息在默认配置下触发任何模型调用或回复。
5. 不默认启用预算/安静时段/dry-run；不把 `minimal`/`off` 设为原文保留默认值。
6. 不用安静时段约束 L2（含 `/stop`、菜单、审批提示与拒绝回执）；不让控制吞掉延迟补发反馈。
7. 不把 P2′写成待实现功能，也不为 P2′ 排**实现**条目（`WG-QQ-12` 仅为门槛统计）。
8. 不假设平台提供 `member_role`；字段缺失按最窄权限降级。
9. 不把昵称（`senderName`）当身份。
10. 不改 `test/channels/qq/mention.test.mjs:59-67` 的既有判定语义，只做扩展。
11. 不引入 lint/typecheck 工具链，不新增客户端框架或依赖。

## 10. 未核验项（不得当作已确认）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 开放平台"接收所有消息"能否开通、审核口径与时长 | `未核验`（**P1′ 硬前置**） |
| 2 | 全量模式下平台是否另有接收频率/范围限制 | `未核验` |
| 3 | 全量模式对群成员隐私的影响与平台合规要求 | `未核验`，启用前须评估 |
| 4 | `member_role` 的平台字段名、取值集合、稳定性；SDK 是否补上归一化字段 | `未核验`；仓库与 SDK `dist/` 均 0 命中，只能经 `message.raw.author.member_role` 读取 |
| 5 | 同一用户跨群 `member_openid` 是否一致 | `未核验`（决定成员白名单能否跨群复用） |
| 6 | 按 `groupOpenid` 的群级白名单/开关能否在当前策略模型表达 | `未核验`，可能需新增维度 |
| 7 | QQ 群默认收紧的迁移机制（已保存策略在 Host workspace）、幂等性与回滚 | `未核验` |
| 8 | 五项控制的配置落点与字段命名（并入 QQ `config-store` 还是另立文件） | `未核验`；文中 `send-control.mjs` 为**建议名** |
| 9 | 预算窗口已用计数是否持久化；安静时段队列持久化与时区来源 | `未核验` |
| 10 | dry-run 预览记录保留期与存放位置 | `未核验` |
| 11 | QQ 是否支持真正的主动消息、平台次数限制与目标可达性错误码 | `未核验` |
| 12 | QQ 群消息发送配额与限流阈值 | `未核验`（`README.md:105` 只提到文件上传配额） |
| 13 | 全量模式事件真实到达延迟与顺序保证 | `未核验` |
| 14 | 全量模式"只入上下文"的具体承载与新增可观测信号（QQ 无 `messagesRejected` 路径） | `未核验` |
| 15 | 是否需要新增暂停/dry-run/预算类控制命令（现目录内没有） | 设计建议，未实现 |
| 16 | 未经真实账号实测：本文不含任何实测结论，五项控制在仓库内实现状态为零 | `未核验` |

## 11. 推荐执行顺序

1. **`WG-QQ-10`（平台申请）最先启动**：它是 P1′/P2′ 的唯一外部依赖，等待周期不可控，但**仓库内不改代码**。
2. **`WG-QQ-03` 与 `WG-QQ-01` 并行**：暂停是发送控制的地基，群默认收紧是风险收益比最高的一块。
3. **`WG-QQ-04` → `WG-QQ-05` / `WG-QQ-06` / `WG-QQ-07`**：复用同一发送前检查点。
4. **`WG-QQ-02`、`WG-QQ-08`、`WG-QQ-09`**：角色权限、面板入口与质量门随控制层一并收口。
5. **P1′（`WG-QQ-11`）**：仅在 `WG-QQ-10` 获批且 P0′ 退出条件全部满足后开始。
6. **`WG-QQ-12`（P2′ 门槛）/ `WG-QQ-13`（降级）**：按 `WG-QQ-10` 的二值结论二选一。

## 12. 相关文档

- 微信能力归档（结案）：[微信渠道已达成的能力.md](微信渠道已达成的能力.md)
- 微信计划（对照，已冻结不修改）：[微信个人号群聊补充目标与计划.md](微信个人号群聊补充目标与计划.md)
- 渠道能力基线：[渠道原生能力建设方案.md](渠道原生能力建设方案.md)
- 主动投递与补发语义：[PROACTIVE_DELIVERY.md](../../PROACTIVE_DELIVERY.md)
- 渠道架构决策：[docs/adr/0001-semantic-core-native-channel-adapters.md](../../docs/adr/0001-semantic-core-native-channel-adapters.md)
- 本计划工作底稿（本 run 产物，非规范位置）：`outputs/qq-supplement/impact-analysis.md`、`controls-spec.md`、`goals-backlog.md`
- QQ 开放平台全量群事件：<https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html>
