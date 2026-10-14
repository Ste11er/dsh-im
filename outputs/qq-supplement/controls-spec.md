# QQ 渠道：群默认策略收紧与五项出站控制规范（设计稿）

- 工作单元：`write-controls-spec`（模块 `controls-spec`，QQ 补充）。
- 性质：**规范 / 设计文档**，描述"QQ 侧应该长什么样"，**不是已实现能力**。本单元只新增本文件，不动 `src/`、`plugin-src/`、README、CHANGELOG。
- 本文件是**本 run 的工作产物**，不是 `docs/` 下的规范位置；对外交付物是 `docs/方案/QQ渠道群聊补充目标与计划.md`。
- 上游证据：同目录 `outputs/qq-supplement/impact-analysis.md`（QQ 现状与行号实证）。
- **口径来源（不重复定义，只做 QQ 适配）**：`outputs/wechatbot-supplement/controls-spec.md`。本文件沿用它的分层词汇、判定顺序与两条改写：
  - 分层：**L1 入站 / L2 被动回复 / L3 主动投递 / L4 后台结果补发**；
  - 判定顺序（同一次出站请求）：**账号级持久暂停 → dry-run → 发送预算/限频 → 安静时段 → 真实发送**；
  - 改写一：**安静时段默认关闭，且只约束 L3 与 L4，不约束 L2 被动回复**——被动回复被静默会破坏 `/stop` 回执、审批提示与延迟补发语义；
  - 改写二：**"原文不落盘"= 渠道侧不新增持久化**，不是"聊天记录不留存"；DSH 会话仍需保存上下文才能多轮对话。
- 优先级（用户已确认，不得更改）：**控制先于能力**。QQ 群默认收紧 + 五项控制必须排在"接入全量模式 `GROUP_MESSAGE_CREATE`"之前；全量接入后默认**只入上下文、不回复**。
- 仓库唯一质量门：`package.json:99-103`（`npm run check`），无 lint / typecheck。

## 0. 与微信的三处结构性差异（决定 QQ 不能照搬）

| 维度 | 微信那份文档的前提 | QQ 的前提（已核验） | 对控制的影响 |
| --- | --- | --- | --- |
| 群聊现状 | 协议层无群概念 | 已有群：`kind: 'group'`、群/私聊分离策略 | 群默认收紧是**改现网默认值**，必须带迁移与回滚说明 |
| 未 @ 群消息 | 收不到 | 收得到，被应用层丢弃（`src/channels/qq/qq-bridge.mjs:1014`） | 全量接入前必须先有群默认收紧与出站控制 |
| 主动投递凭据 | `context_token`（`PROACTIVE_DELIVERY.md:324-326`） | **无 `context_token`**；目标是 `{ scope, targetId }`（`src/channels/qq/qq-runtime.mjs:135-137`） | 微信的令牌约束在 QQ 不适用，见 3.5 |
| 被动回复平台上限 | 1,800 字符分段预算 | 同一被动 `msg_id` 最多 `c2c 4 / group 5` 条（`src/channels/qq/markdown-reply.mjs:11`、`:49`） | L2 已有平台硬上限，本地预算的作用点只有 L3/L4 |

> **对上游证据的一处修正**：`impact-analysis.md:49` 把 QQ 未 @ 群消息的丢弃点记为 `src/channels/shared/text-harness-bridge.mjs:255`。已核验：QQ 桥接**不是** `TextHarnessBridge` 子类（该类的使用者只有 whatsapp / email / discord / slack / matrix / telegram / imessage），QQ 真正的丢弃点是 `src/channels/qq/qq-bridge.mjs:1014`（`if (!isQqMessageAddressed(message)) return;`），交互回复路径另有一处 `:1288`。本文件以 `qq-bridge.mjs:1014` 为准。

## 1. QQ 群访问策略收紧方案

### 1.1 现状（已核验）

| 事实 | 证据 |
| --- | --- |
| 群作用域默认 `openScope()`：开放 + `defaultCanExecuteCommands: true` | `plugin-src/host/channels/shared/access-policy-production.mjs:10-19`、`:61-66` |
| 私聊 direct 默认：`ownerUserOpenid` 含 `*` 才开放，否则白名单 | 同上 `:61-66` |
| **新连接**的 QQ 机器人：direct 与 group **都**是 `openScope()` | 同上 `:105-109` |
| owner 是硬编码特权：命中即 `allowed`，**绕过整份持久策略** | `src/channels/shared/inbound-access.mjs:24-27`；`access-policy-production.mjs:123` |
| 命令权限判定：`mode: 'open'` 时默认 `defaultCanExecuteCommands` 决定 | `src/channels/shared/access-policy.mjs:201-207` |
| 白名单在 group 作用域下匹配的是 **senderIds（成员）**，不是 `groupOpenid` | `qq-bridge.mjs:532`（`senderIds: sender`）、`access-policy.mjs:188-200` |
| 未配置策略的默认（`createAccessPolicyScope()` 无参）已是 allowlist + 禁命令 | `access-policy.mjs:128-136` |
| 命令被拒时 QQ 会回一条被动回复 | `qq-bridge.mjs:928-936`，文案 `inbound-access.mjs:4` |

### 1.2 风险（收紧必须解决的点）

1. **群内任何人都能触发问答**：`openScope()` 的 `mode: 'open'` 不校验发送者；群消息只要被 @ 就进入模型（`qq-bridge.mjs:517`、`:528`）。
2. **群内任何人都能执行命令**：`openScope()` 的 `defaultCanExecuteCommands: true`，命令判定走 `isSharedLocalCommand`（`src/channels/shared/command-permission.mjs:20`），涵盖 `/stop`、`/model`、`/preset`、`/m`、`/compact` 等。这是当前 QQ 群最直接的越权面。
3. **`ownerUserOpenid: '*'` 会连带把群开放**：`*` 的本意是"私聊不限发送者"，但 `:61-66` 的 group 分支与 `*` 无关、恒为 open；而 `:107-108` 让新机器人连 direct 也直接 open。**收紧时必须明确：`*` 只在 direct 生效，group 不因 `*` 开放。**
4. **收紧不能把 owner 关在门外**：owner 是 `:123` 的特权旁路，绕过策略。这是既有行为，收紧方案要把它当作"已知恒定例外"写进迁移说明，而不是试图改掉它。
5. **"群白名单"当前不可表达**：策略作用域的 allowlist 过滤的是 `senderIds`（`access-policy.mjs:194`），QQ 传入的是成员 `member_openid`。按 `groupOpenid` 的**群级白名单**是新维度，需要新增代码，`未核验` 现有模型能否承载。
6. **无发送侧兜底**：群一旦开放，全仓库没有任何发送预算/安静时段/dry-run/持久暂停（见 `impact-analysis.md:64-66`）。收紧入站与补齐出站控制必须同时做。

### 1.3 建议默认（三档，逐群可覆盖）

| 档 | group 作用域建议 | 谁能触发问答 | 谁能执行命令 | 建议 |
| --- | --- | --- | --- | --- |
| **A：关闭（推荐默认）** | `mode: 'allowlist'`，`users` 仅显式加入者（owner 由特权旁路恒可用） | 仅显式加入者 | 仅 owner（`canExecuteCommands: true` 只给 owner；`defaultCanExecuteCommands: false`） | **新默认**，落地时配迁移说明 |
| B：成员白名单 | `mode: 'allowlist'`，`users` = 批准的成员 | 白名单成员 | `defaultCanExecuteCommands: false`；逐人 `canExecuteCommands` 显式授予（可含 admin） | 需要群内问答时的推荐档 |
| C：开放 | `mode: 'open'` | 群内所有人 | **至少** `defaultCanExecuteCommands: false`；命令权限逐人白名单 | 仅显式选择，不得作为默认 |

配置差异与风险（对照 `access-policy-production.mjs:61-66` / `:107-108`）：

- A/B 档在现有数据类型下**可以直接表达**（`allowlistScope(users)`，见 `:21-30`），改动是默认值本身加已有机器人的一次性迁移；**迁移位置是 Host workspace 里已保存的策略文档，不在 QQ 的 config-store 里**（`accessPolicyProvider` 读 `workspaces.accessPolicyFor(botId)`，`access-policy-production.mjs:129-137`）——迁移脚本与回滚路径 `未核验`。
- 真正的"群白名单"（按 `groupOpenid` 决定该群是否可用）需要新维度；在那之前 A 档的效果是"该群里只有白名单成员能触发"，不等于"整群静默"。
- 收紧后**未 @ 的群消息行为不变**（本来就在 `qq-bridge.mjs:1014` 丢弃），因此 A 档不会让现有 @问答链路之外的东西变差。

### 1.4 `member_role` 用于命令权限判定

**身份基准**：`senderId`（`author.member_openid`）。**绝不能用 `senderName`（`author.username`，显示昵称）当身份**——昵称可随时修改且可重名；仓库现有用法也只在上下文增强里传 `senderName`（`qq-bridge.mjs:702`、`:803`、`:880`、`:1096`）。

**可用性（已核验）**：SDK 归一化的群消息**不含** `member_role`。群分支只产出 `senderId` / `senderName` / `senderIsBot` / `content` / `raw` 等字段（`node_modules/@tencent-connect/qqbot-nodejs/dist/protocol/gateway/event-dispatcher.js:121-148`），且在整个已安装 SDK 的 `dist/` 内检索 `member_role` **零命中**。因此角色只能从保留的原始事件读取：`message.raw.author.member_role`（`raw: ev` 见 `event-dispatcher.js:146` 附近）。字段名、取值集合与稳定性 `未核验`。

| 设计点 | 建议 |
| --- | --- |
| 判定位置 | `qq-bridge.mjs:529-537` 的 `evaluateInboundAccess(...)` 之前，作为**命令权限的前置门槛**（与 `isCommand` 同一决策点） |
| 与 openid 白名单的关系 | **AND**：openid 白名单决定"是谁"，角色决定"是否允许执行命令"。角色**不是**身份，绝不可作为 allowlist 的键 |
| 角色映射 | `owner`（群主）> `admin`（管理员）> `member`；门槛建议"命令默认仅 `owner` / `admin` 可执行，`member` 需显式授权" |
| 缺失/未知角色 | **fail-closed**，按 `member` 处理（最小权限） |
| 拒绝行为 | 复用既有 `COMMAND_PERMISSION_DENIED_MESSAGE`（`inbound-access.mjs:4`）与 QQ 既有拒绝路径（`qq-bridge.mjs:928-936`）——注意这是 **L2 被动回复**，不受暂停/预算/安静时段约束（见 2.2、2.4） |
| 与 owner 特权的关系 | `ownerUserOpenid` 仍是硬编码特权（`:123`），不参与角色判定；角色门槛只约束其余成员 |
| 风险 | 同一用户在不同群的 `member_openid` 是否一致 `未核验`，因此成员白名单建议**按群分别维护**，不做跨群全局名单 |

## 2. 五项控制在 QQ 的落点

分层与判定顺序**完全沿用** `outputs/wechatbot-supplement/controls-spec.md` 第 1 节，不在此重述。QQ 的账号粒度是 `botId`（`qq_<sha256(appId) 前 24 位>`，`src/channels/qq/config-store.mjs:27-31`）；会话/群粒度是会话键 `kind:conversationId`。

QQ 三类出站落点的别名（下文直接引用）：

| 别名 | QQ 位置 |
| --- | --- |
| L2 被动回复 | `qq-bridge.mjs:630`、`:650`、`:707`、`:892`、`:904`、`:914`、`:932`、`:1027`、`:1033`、`:1039`、`:1045`、`:1057`、`:1066`、`:1081`、`:1236`；菜单 `sendQqMenu` `:768`；`qq-runtime.mjs:140`、`:145` |
| L3 主动投递 | `plugin-src/host/delivery-adapter.mjs:7`（CHANNELS 含 `qq`）→ `:313`/`:316`/`:407` → `coreController.sendProactiveText` → `src/channels/shared/text-harness-bridge.mjs:652` |
| L4 后台结果补发 | `qq-bridge.mjs:494`（协调器）→ `:740-741`（`#deliverDeferredOutcome`）；目标注入 `:796`、`:1111` |

### 2.1 发送预算 / 限频

| 要素 | QQ 落点 |
| --- | --- |
| 触发点 | L3 与 L4 的唯一出口——即 `delivery-adapter.mjs:316`/`:407` 之后、`sendProactiveText` 真正调用 `#bot.sendText` 之前。**不拦 L2 被动回复** |
| 作用域 | 账号级（`botId`）为主；可选会话级子预算（群 = 会话级子集） |
| 默认值 | **关闭（不限额）**。仓库现状无任何限频，默认开启等于静默改变现有投递行为 |
| 重启行为 | 开关与阈值随账号配置持久化（QQ 的 `{version:1, bots:[...]}` 文档，`src/channels/qq/config-store.mjs:7`、保存入口 `:109`；控制配置是否并入该文档 `未核验`）；窗口内已用计数是否持久化 `未核验` |
| 可观测信号 | 状态 `budget: { enabled, window, limit, used, resetsAt }`；诊断挂 `diagnostic-details.mjs:92`（含 `qq`），只放计数与窗口，`hint` 受 `:88` 的 500 字符截断；日志 `[dsh-im] outbound budget exhausted`；用户可见"已达本账号发送上限" |

QQ 特有：

- **计数按"实际发送段"**：QQ 长文经 `chunkMarkdownParts` 切分后逐条发送（`src/channels/qq/markdown-reply.mjs:7`、`:49`），按调用计数会低估消耗。
- **L2 无需本地预算**：被动回复自身有平台硬上限（同一 `msg_id` 最多 `c2c 4 / group 5` 条，`:11`、`:49`）。这恰好印证预算的作用域只应落在 L3/L4。
- 仓库内**没有** QQ 的平台配额声明可读（README 只提"当日文件上传配额"，`README.md:105`），因此无法给出平台派生的默认阈值。
- 超额行为沿用微信口径：不排队、不静默丢弃，返回可区分的"预算耗尽"结果；已生成内容不重新生成。

### 2.2 安静时段

| 要素 | QQ 落点 |
| --- | --- |
| 触发点 | L3 与 L4 的出口闸门。**明确不作用于 L2**：用户在安静时段发言仍立刻收到回复，`/menu`、`/stop` 回执、审批提示、命令拒绝回执照常 |
| 作用域 | 账号级默认；可会话级覆盖（"只静默这个群"） |
| 默认值 | **关闭**（用户已确认）。开启后默认形状为每日 `HH:MM–HH:MM` |
| 重启行为 | 窗口配置持久化；已排队待投递的静默项是否持久化 `未核验`（不持久化则必须显式标注"重启丢失静默队列"） |
| 可观测信号 | 状态 `quietHours: { enabled, window, timezone, active, nextResumeAt, queued }`；日志 `[dsh-im] quiet hours deferred delivery until <nextResumeAt>`；设置页显示当前是否静默与下次恢复时间。时区来源 `未核验` |

QQ 特有：

- 命中时**延迟投递而非丢弃**，内容与目标不变（沿用微信口径）。
- **关键约束**：静默等待**不得计入延迟补发的失败尝试**——`markFailedAttempt` 会把 `attempts + 1` 并在 `attempts >= 3` 时置 `failed`（`src/channels/shared/deferred-delivery.mjs:157`）。三次静默就会永久丢掉一条后台结果。
- 安静时段不改变入站：未 @ 群消息本来就在 `qq-bridge.mjs:1014` 被丢弃，安静时段不参与该判定。

### 2.3 dry-run

| 要素 | QQ 落点 |
| --- | --- |
| 触发点 | 出站闸门最外层之一（顺序见第 2 节引用的判定顺序），拦 L3、L4 与连接测试路径（`text-harness-bridge.mjs:643 sendConnectionTest`；QQ 的连接自检回复在 `qq-bridge.mjs:1039`）。命中后**不调用真实发送**，只生成预览记录。默认**不作用于 L2** |
| 作用域 | 账号级开关；允许会话级覆盖 |
| 默认值 | **关闭**（真发） |
| 重启行为 | 开关是配置项，须持久化；内存预览记录重启即清空（可接受） |
| 可观测信号 | 状态 `dryRun: { enabled, suppressedCount, lastPreviewAt }`；日志 `[dsh-im] dry-run suppressed outbound`；设置页显著标识"dry-run 中，不会真实发送"；调用方收到"已被 dry-run 拦截"，与真实失败区分 |

QQ 特有：

- **dry-run 不得吞掉 L2 菜单**：`/menu` 的菜单渲染与数字选择的回执都是 L2（`qq-bridge.mjs:768`、`:892`/`:904`），影子模式下仍应可见，否则用户无法验证菜单；被 dry-run 的只是它们触发的主动投递。
- 预览记录不得写入渠道侧持久化（见 2.5），也不得写入 QQ 的 `state-store`。
- 未 @ 群消息在 dry-run 下同样不产生出站——全量模式接入后它们默认"只入上下文"，与 dry-run 是两件独立的事。

### 2.4 账号级持久暂停

| 要素 | QQ 落点 |
| --- | --- |
| 触发点 | 出站闸门最外层，优先级最高。作用于 L3、L4 与连接测试；**不作用于 L1 入站，也不作用于 L2 被动回复**——暂停期间消息仍进入 DSH 会话并照常开启回合，否则 `/stop` 本身也会失效 |
| 作用域 | 账号级（`botId`）；可扩展会话级"只静音这个群" |
| 默认值 | **未暂停**（active）。必须由显式操作设置（Web 设置页或新增控制命令；现有命令目录无暂停类命令，属设计建议） |
| 重启行为 | **必须持久化**，重启后仍为暂停；恢复同样必须显式。落点建议 `src/channels/qq/config-store.mjs` 的 bot 记录（`:49-56`），字段与迁移 `未核验` |
| 可观测信号 | 状态 `paused: { active, reason, since, by }`；诊断在 `diagnostic-details.mjs:92` 的渠道集合内可见 `paused`；设置页横幅；被拦投递回执"该机器人已暂停发送，未投递" |

QQ 特有：

- 与 QQ 的"协议在线状态"不同：本项是**持久配置**，重连即失效的东西不算。
- 暂停期间**审批照常可处理**：QQ 的审批队列在 `qq-bridge.mjs:500`，待审批项不因暂停被取消或自动拒绝（详见 3.3）。
- 暂停不阻止 QQ 的访问策略判定：被拒消息仍走 `qq-bridge.mjs:928-936` 的 L2 拒绝回执。

### 2.5 渠道侧不新增持久化（原"原文落盘开关"）

| 要素 | QQ 落点 |
| --- | --- |
| 准确含义 | 渠道适配器**不再额外写一份原文/日志**；**不是**"聊天记录不留存"。DSH 会话仍保存上下文（沿用微信口径） |
| 触发点 | QQ `state-store` 的写入点，以及任何渠道级正文日志写入点 |
| 作用域 | 渠道 × 账号（`botId`） |
| 默认值 | **不改变现状**。三档 `full` / `minimal`（推荐）/ `off`；QQ 现状已接近 `minimal`/`off`：`src/channels/qq/state-store.mjs:7` 的文档只有 `{ version, sessions, seenMessageIds }`，加 `includeArchivedSessions` 与 `deferred`（`:18-25`），**不含任何出站原文**——与微信的 `recentOutboundMessages` 形成对照 |
| 重启行为 | 模式是配置项须持久化；切档后是否清理既有落盘数据 `未核验` |
| 可观测信号 | 状态 `rawRetention: { mode, since }`；诊断展示"渠道侧是否保存正文"的布尔结论，**不得把原文写进诊断**（`diagnostic-details.mjs:88` 有 500 字符截断与脱敏约束） |

QQ 特有（这条在 QQ 上是**预防性**的，比微信更关键）：

- QQ 现状不落盘出站原文，所以本项在 QQ 的现实风险不在"关闭存量"，而在**全量模式接入时新引入的入站持久化**：若为了"未 @ 消息只入上下文"而把每条群消息原文写进 `state-store`，那就是新增落盘。**该开关必须先于全量模式能力存在**，新写入点默认 `off`。
- QQ 菜单是**纯内存**（`QqMenuStore` 的 `#entries` Map，`src/channels/qq/qq-menu.mjs:33`；TTL 15 分钟，`:6`），不落盘，不受本控制影响。
- 会话映射（`sessions`）与会话键是路由必需，属于"ID 而非正文"，保留不违背本控制。

## 3. 与 QQ 特有交互的对照

### 3.1 @模式 与 全量模式的两种输入形态

| 形态 | 判定与轨迹 | 控制如何生效 |
| --- | --- | --- |
| @模式 `GROUP_AT_MESSAGE_CREATE` | `isQqMessageAddressed` 为真（`qq-mention.mjs:10-15`）→ `qq-bridge.mjs:528` 评估访问策略 → 回合 → L2 被动回复 | L1 由访问策略收紧（第 1 节）；L2 不受暂停/预算/安静时段约束；只有 L3/L4 受五项控制 |
| 全量模式 `GROUP_MESSAGE_CREATE` | 事件同分支到达（SDK `event-dispatcher.js:121-128`），但 `qq-mention.mjs:10-15` 判为**未点名** → `qq-bridge.mjs:1014` 直接 `return` | 默认**只入上下文、不回复**：此形态下第 5 项（渠道侧不新增持久化）是主控制；只有未来"主动接话"能力把某条晋升为 L3 时，其余四项才生效 |

要点：

- 接入全量模式**不是放宽控制**，而是把 `qq-bridge.mjs:1014` 的丢弃改成"入上下文"。出站控制不因此放宽，且该能力必须先有独立开关，异常时关掉即回到 @模式。
- 两种形态的 `senderIds` 都是 `member_openid`，所以访问策略与角色判定对两者同样适用；但**未 @ 消息即使被策略拒绝也不产生拒绝回执**——策略在全量路径上只决定"是否允许进入上下文"（QQ 侧无 `messagesRejected` 计数，需为此路径新增可观测信号，见第 4 节）。
- 未 @ 群消息当前**不计入** `messagesRejected`：`qq-bridge.mjs:1014` 是静默 `return`；`messagesRejected` 只在访问策略拒绝时累加（`:936`）。

### 3.2 `/menu` 与数字菜单

- 显式菜单命令 `/m`、`/menu`（`qq-menu.mjs:15`）；数字选择仅在 `addressed` 且菜单属于 `(key, sender)` 时解释（`qq-bridge.mjs:522-527`），普通输入会清掉菜单（`:561`）。
- 菜单渲染走 `sendQqMenu`（`:768`），属 **L2 被动回复**：暂停 / 预算 / 安静时段**都不得**拦它；dry-run 下菜单仍应可见（预览模式），否则用户无法在影子模式下验证菜单。
- 菜单是内存态、TTL 15 分钟（`qq-menu.mjs:6`、`:33`）且 `clear` 依赖一次 `addressed` 输入；重启即丢。它不是 L4，不参与补发重试。
- 数字选择的回执在 `qq-bridge.mjs:892`/`:904`，同为 L2，语义同上。

### 3.3 共享审批闭环

- QQ 在共享审批渠道列表内（`src/channels/shared/harness-approval.mjs:13-14` 含 `qq`），默认超时 60 分钟并自动拒绝（`:24`），回复词表见 `:5-12`；QQ 的审批队列实例在 `qq-bridge.mjs:500`。
- **暂停 / 预算耗尽 / 安静时段均不得**取消待审批项、触发自动拒绝或缩短超时；审批超时只按既有规则走。
- 审批提示与审批回执若是 L2（`qq-bridge.mjs:707` 的 `send`、`:932` 的拒绝回执），三项出站控制都不拦它。
- 若某条审批结果通知走 L3 被拦，必须保证 **Web 端仍可看到并处理**，不能使审批结论只在机器人端可见（沿用微信口径）。
- 审批回复文本不是命令，不经过 1.4 的角色门槛。

### 3.4 延迟补发（含 `attempts` 约束）

- QQ 已接共享协调器（`qq-bridge.mjs:494`；目标注入 `:796`、`:1111`），投递出口 `#deliverDeferredOutcome`（`:740-741`）。
- **硬约束（沿用微信口径，QQ 同样适用）**：静默等待、预算耗尽、账号暂停造成的"尚未尝试"，**一律不计入 `attempts`**，状态保持 `pending`；否则 `attempts >= 3` 即 `failed`（`deferred-delivery.mjs:157`）会永久丢结果。
- 本地控制（暂停/预算/静默）造成的"没发出去"语义是"**尚未尝试**"，与"平台结果未知"是两件事：`deliveryOutcome: 'unknown'` 按现有规则置 `failed` 且**不自动重试**（`deferred-delivery-coordinator.mjs:172`），不要混同。
- 账号暂停期间应**冻结**补发定时器，不投递、不计尝试；恢复后继续；暂停不得导致"超时丢弃"。
- QQ 特有：待补发的群结果持有 `{ scope: 'group', targetId }`（`qq-bridge.mjs:1111`）。**群默认策略收紧只作用于 L1 准入，不得回溯阻断已在 `pending` 的 L4 投递**——已被批准进入回合的群，其后台结果仍应能回到原群；若实现选择在 L4 出口复查群策略，必须显式记录该分支及用户可见降级（`未核验` 是否需要）。

### 3.5 主动投递与 `context_token`（QQ 不适用微信那一节）

- **QQ 没有 `context_token`**：全仓库该字段只出现在微信（`src/channels/weixin/weixin-bridge.mjs:425`、`:670` 等）。因此微信那份文档 3.4 关于令牌消耗/失效的约束**在 QQ 不成立**，不适用于 QQ 适配。
- QQ 主动投递路径：`delivery-adapter.mjs:7`（CHANNELS 含 `qq`）→ `:313`/`:316`、`:407` → `coreController.sendProactiveText` → `text-harness-bridge.mjs:652` → `#bot.sendText(target, text)`；目标由 `normalizeDeliveryTarget(channel, ...)` 归一，运行时目标形状见 `qq-runtime.mjs:135-137`。
- 控制命中时（暂停 / dry-run / 预算 / 安静时段）**没有走到平台发送**，因此不消耗任何平台侧令牌（QQ 本也无令牌）；被拦不产生 `providerMessageIds`，`deliveryHandle` / `idempotencyKey` 语义与微信那份文档 3.4 一致——控制命中时该语义不变。
- QQ 侧需要另行确认的是"目标是否仍可达"（机器人被移出群、群解散、目标 openid 失效），这属于平台侧错误，与本地控制是不同来源，诊断须可区分。可达性与平台主动消息限制 `未核验`。
- 计数按发送段（`markdown-reply.mjs:7`、`:49`）。

### 3.6 汇总：QQ 在途对象 × 控制状态

| 在途对象 | 账号暂停期间 | 预算耗尽时 | 安静时段内 | 恢复后 |
| --- | --- | --- | --- | --- |
| 已生成的回答（已在 DSH 会话历史中） | 保留，不撤回、不删除 | 保留 | 保留 | 不重新生成；按需投递 |
| 待审批项（`qq-bridge.mjs:500`） | 不取消、不自动拒绝；超时仍按 60 分钟（`harness-approval.mjs:24`） | 同左 | 同左 | Web 端仍可随时处理 |
| 延迟补发条目（`pending`） | 冻结定时器，不计 `attempts` | 退避重排，保持 `pending`，不计失败 | 推迟到窗口结束，`attempts` 不变 | 继续投递；`attempts` 仍受 3 次上限（`deferred-delivery.mjs:157`） |
| `/menu`、数字菜单、`/stop` 与命令拒绝回执（L2） | 照常发送 | 照常发送 | 照常发送 | — |
| 未 @ 群消息（全量模式） | 不投递、不回复 | 不适用 | 不适用 | 仅入上下文（第 5 项控制生效） |

## 4. 未核验项（不得当作已确认）

1. `member_role` 的平台字段名、取值集合、稳定性，以及 SDK 是否会补上归一化字段——已安装 SDK 的 `dist/` 内零命中，只能经 `message.raw.author.member_role` 读取 → `未核验`。
2. 同一用户在不同群的 `member_openid` 是否一致（决定成员白名单能否跨群复用）→ `未核验`。
3. 按 `groupOpenid` 的**群级**白名单/开关在当前策略模型中能否表达，以及是否必须新增维度 → `未核验`。
4. QQ 群默认收紧的**迁移机制**：已保存策略在 Host workspace（`access-policy-production.mjs:129-137`），迁移脚本、幂等性与回滚路径 → `未核验`。
5. 五项控制的配置落点：并入 `src/channels/qq/config-store.mjs` 的 bot 记录（`:49-56`、`:109`），还是另立账号配置文件 → `未核验`；预算窗口内已用计数是否持久化 → `未核验`。
6. 安静时段时区来源（Host 本地或每账号配置）、静默队列持久化可行性 → `未核验`。
7. dry-run 预览记录的保留期与存放位置 → `未核验`。
8. QQ 是否支持真正的"主动消息"以及平台侧的主动投递次数限制与目标可达性错误码 → `未核验`。
9. 全量模式下"只入上下文"的具体承载（是否新增 QQ 侧入站持久化、写在哪）与为此新增的可观测信号（QQ 无 `messagesRejected` 计数路径）→ `未核验`。
10. 是否需要新增暂停 / dry-run / 预算类控制命令（现有 `src/channels/shared/command-catalog.mjs` 目录内没有）→ 设计建议，未实现。
11. 未经真实账号实测：本文不含任何实测结论；五项控制在仓库内的实现状态为零（`impact-analysis.md:64-66`）。

## 5. 明确不做

- 本单元不改 `src/`、`plugin-src/`、`README.md`、`README.en.md`、`CHANGELOG.md`，不修改已冻结的 `docs/方案/微信个人号群聊补充目标与计划.md`，不声明任何能力已存在。
- 不重复微信那份文档的正文；本文只写 QQ 适配，分层词汇与判定顺序引用它作为口径来源。
- 不在本文引入全量模式 `GROUP_MESSAGE_CREATE` 的接入设计——控制先于能力，接入属后续工作单元。
- 不承诺"聊天记录不留存"；会话上下文仍由 DSH 保存以支持多轮对话。
- 不用安静时段约束 L2 被动回复，也不用暂停/预算吞掉 `/stop`、`/menu`、审批与延迟补发的反馈。
- 不默认启用预算，不把 `full` 设为原文保留的默认值，不用显示昵称（`senderName`）充当身份。
