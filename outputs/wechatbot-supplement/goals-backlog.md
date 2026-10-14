# 微信个人号群聊补充：分层目标与 backlog

> **本文件是本 run 的工作产物，不是规范位置，随时可删。**
> 对外交付物是 `docs/方案/微信个人号群聊补充目标与计划.md`；本文件只作为它的输入草稿与证据底稿。
> 本 run 不修改 `src/`、`plugin-src/`、README、CHANGELOG，不创建 issue、不推送远端。

## 0. 定位、对照与证据约定

- **对照物**：`/home/stella/Project/wechatbot/md/` 只提供**目标能力对照**；本文档不复制其内容，也不把它当作 dsh-im 的目标定义。
- **P0 控制规范**：五项控制的字段、默认值与状态机见本 run 同目录 `controls-spec.md`（并行单元产出）。本文档只写目标、准入、交付物、退出与 backlog，**不重复规范细节**。
- **影响面**：注册点与改动清单见同目录 `impact-analysis.md` 第 2.1、2.5、5 节。
- **证据约定**：所有行号均已用 `grep -n` / `sed -n` 复核；无法从仓库确认的外部事实一律标 `未核验`。
- **状态**：本 run 只写文档，**零代码变更**；下文"改动位置"是后续落地清单，不代表已实现。

## 1. 四层目标总览

| 层 | 目标一句话 | 准入条件 | 交付物 | 退出条件 |
| --- | --- | --- | --- | --- |
| **P0** | 在现有官方 iLink 单聊渠道与共享层补齐五项发送控制 | 无前置，可立即开始；只动共享层 + `weixin` 接线；不引入群语义、不新增渠道、不接第三方协议 | WG-01…WG-05：发送预算/限频、安静时段、dry-run、账号级持久暂停、原文落盘开关 | 默认 dry-run 可观察候选；关闭开关时所有出口零发送；重启不解除暂停；超限/窗口内不补发；`npm run check` 通过 |
| **P1a** | Wechaty 独立 sidecar 的最小可行性 spike：只验证"能进群、能收未 @、能发" | P0 完成；测试账号与风险承受范围已由负责人确认（当前**缺失**）；sidecar 运行环境已核验 | WG-06…WG-08：sidecar 契约 + 默认 mock + 真实收发 spike 记录 + 能力矩阵与 go/no-go | 三条路径各有可复现、脱敏的原始记录；`receive_unmentioned` / `send_reply` 有明确结论；未核验项默认禁用 |
| **P1b** | 个人微信渠道完整适配器（群内 @问答） | **P1a 通过**（硬前置）；WG-12 风险与停用文档完成；负责人书面接受账号风险 | WG-09…WG-14：`wechat-personal` 渠道（约 10 新文件 + 约 15 注册点）、群语义接线、默认 mock、文档、测试 | 默认启动不连 Wechaty；显式启用后群内 @问答闭环；`npm run check` 通过；停用演练成功且其余 14 渠道不受影响 |
| **P2** | 未 @ 群消息低频自主接话（wechatbot 的 `shouldParticipate`） | 仅证据门槛，见第 5 节 | **无交付物、无 backlog 条目** | 不设退出条件 |

> **P2 是"不承诺目标"**：本文档不为它写设计草案，也不为它排 backlog。它是否启动由一次**独立决策**决定，不随 P1b 完成自动解锁。

---

## 2. P0：官方 iLink 单聊渠道的控制补齐

**范围界定**：P0 只解决"发得出去、发得可控、发得可停"。它不解决群能力——`src/channels/weixin/weixin-runtime.mjs:409` 只接受 `kind === 'user'`，`weixin-bridge.mjs:124` 会话键写死 `p2p:${userId}`，`:393` 入站强制 `conversationType: 'direct'`，`weixin-api.mjs:14` CDN 走 `/c2c/`，`docs/上下文增强.md:3` 明确"微信当前只支持私聊"。**群能力不是开关，而是换通道（P1）。**

**准入条件**

1. 只改共享层与 `weixin` 渠道接线，不改 `whatsapp`/`wecom` 等其它渠道行为。
2. 控制逻辑放在共享层，避免 P1b 重写；但 P0 不为群语义预留空壳。
3. 遵守 `controls-spec.md`：字段名、默认值、状态机以它为准。

**交付物**：WG-01…WG-05。

**退出条件**

- 默认 `dry-run`：所有发送出口（群回复、命令结果、错误提示、投递）只记录候选，不产生平台调用。
- 总开关关闭时，mock 记录的发送次数为 **0**；并发多会话不突破账号级上限；超限不集中补发。
- 暂停状态持久化：进程重启后仍暂停，后台任务不能绕过。
- 原文落盘默认关闭后，磁盘快照不含正文。
- `npm run check` 通过（`package.json:99-103`：`build` → `node --test` → `verify-package`；无 lint/typecheck）。

### P0 backlog

#### WG-01 发送预算与限频（账号级 + 会话级）

| 项 | 内容 |
| --- | --- |
| 现状证据 | 全仓库无账号级发送预算/限流实现。邮件渠道只**读取**平台声明（`src/channels/email/transports/agent-mail.mjs:105`、`:133`），`src/channels/email/email-runtime.mjs:29` 的 `pollIntervalForLimits` 只管读取轮询；WhatsApp 分片发送是顺序 `await`，`:378`、`:787` 是出站回声去重，不是限流。 |
| 改动位置 | 建议新增共享模块 `src/channels/shared/send-control.mjs`（本次不存在，名称为建议）；接线点：`src/channels/weixin/weixin-bridge.mjs`（`#send`/`#sendOutOfBand` 多路调用，见 `:679`、`:700`、`:771`、`:804`）、`src/channels/weixin/weixin-runtime.mjs:406`（`sendProactiveText`）、`src/channels/shared/text-harness-bridge.mjs:651`（`sendProactiveText`）。 |
| 依赖 | `controls-spec.md`（配额字段与默认值）；WG-04（发送前复查暂停态）。 |
| 验收方式 | 单测断言：并发多会话下账号总发送不超上限；超限后不补发；重放同一消息不产生第二次发送。`npm run check` 通过。 |
| 明确不做项 | 不做跨渠道统一预算；不做平台速率自适应/探测式退避；不改各渠道已有的分片逻辑。 |

#### WG-02 安静时段

| 项 | 内容 |
| --- | --- |
| 现状证据 | 全仓库无 quiet/dnd/时间窗发送抑制实现。 |
| 改动位置 | 建议同一共享模块 `src/channels/shared/send-control.mjs`（建议名）+ 配置读取；时区按 `controls-spec.md`（建议 Asia/Shanghai）。 |
| 依赖 | WG-01（复用同一发送前检查点）。 |
| 验收方式 | 注入可控时钟的单测：窗口内零发送；窗口结束后**不**补发窗口内积压项。 |
| 明确不做项 | 不做按群/按用户差异化时段；不做节假日日历；不做"@例外"（首版窗口内一律不发）。 |

#### WG-03 dry-run

| 项 | 内容 |
| --- | --- |
| 现状证据 | 全仓库无 dry-run / 发送预览实现。 |
| 改动位置 | 共享发送层（同上）+ 客户端设置入口。可参考的既有同类设置点为 `plugin-src/client/delivery-settings.js:46`（`weixin:` 条目）；具体面板挂载位置**本次未逐行核验**，为文件级证据。 |
| 依赖 | WG-01、WG-04（同一"发送前最终检查"链路）。 |
| 验收方式 | dry-run 开启时所有出口记录候选且 mock 平台调用计数为 0；关闭后恢复真实发送；默认值为开启。 |
| 明确不做项 | 不做逐条人工确认 UI（首版只做全局开关）；不做候选内容审核。 |

#### WG-04 账号级持久暂停

| 项 | 内容 |
| --- | --- |
| 现状证据 | 无持久暂停配置。唯一"暂停"是 WhatsApp 的 typing presence `paused`，属协议运行状态而非持久配置。共享持久化结构为 `{ version, sessions, seenMessageIds, cursor }`（`src/channels/shared/conversation-state-store.mjs:13`），无暂停字段。 |
| 改动位置 | 新增账号状态模块 + 持久化（`src/channels/weixin/state-store.mjs` 或共享 store）；本地管理入口（不依赖渠道收发）。 |
| 依赖 | 无（可与 WG-01 并行）；被 WG-01/02/03 在发送前引用。 |
| 验收方式 | 单测：重启后暂停仍生效；暂停期间待发项不再执行；恢复必须显式操作。 |
| 明确不做项 | 不声称能自动识别只出现在手机端的平台警告；不承诺撤回已在途消息；不做按群暂停（P1b 再议）。 |

#### WG-05 渠道侧原文落盘开关

| 项 | 内容 |
| --- | --- |
| 现状证据 | 微信**无条件**落盘出站正文：`src/channels/weixin/state-store.mjs:14` `recentOutboundMessages`，`:19` 文本上限 8,000 字符，`:20` TTL 30 天；共享存储只存 ID。 |
| 改动位置 | `src/channels/weixin/state-store.mjs`（读取开关，默认关闭正文持久化）；`src/channels/weixin/weixin-bridge.mjs:215`（`recentOutboundTextFor`，改为开关关闭时不可解析）。 |
| 依赖 | WG-04（同一配置/状态读写路径可复用）。 |
| 验收方式 | 开关关闭时 store 快照断言不含正文；开关开启需显式配置；去重所需 ID 保留不受影响。 |
| 明确不做项 | 不做历史落盘数据的清理迁移（另开 issue）；不改入站去重 ID 保留逻辑。 |

---

## 3. P1a：Wechaty 独立 sidecar 最小可行性 spike

**路线（已定，不得更改）**：Wechaty 走**独立 sidecar 进程**（单独 Node 服务），插件通过**本机 IPC/HTTP** 通信；本仓库只加轻量适配器 + **默认 mock**；**不把 Wechaty 拉进插件依赖**。

**准入条件**

1. P0 退出条件全部满足（发送控制在 spike 阶段就能复用）。
2. 测试账号与风险承受范围已由负责人确认——**当前缺失**，是 P1a 的硬阻塞。
3. sidecar 运行环境（Node 版本、Wechaty/Puppet 依赖组合）已核验 → 当前 `未核验`。

**交付物**：WG-06、WG-07、WG-08，即 sidecar 契约 + 默认 mock + 最小真实收发记录 + 能力矩阵与 go/no-go。

**退出条件**

- 三条路径各有可复现、脱敏的原始记录：**能进群**、**能收未 @消息**、**能发送**。
- 明确区分"收不到未 @"与"代码选择不处理未 @"——不得混写。
- 能力矩阵对 `receive_mentions` / `receive_unmentioned` / `send_reply` 给出明确结论；未核验项默认禁用。
- 明确给出 P1b 的 go/no-go。**不通过时记录阻塞原因并回到企微降级路径（第 6 节），不擅自换协议、不进入 P1b。**

### P1a backlog

#### WG-06 sidecar 契约与默认 mock 传输

| 项 | 内容 |
| --- | --- |
| 现状证据 | 仓库内无任何第三方个人微信协议代码；`plugin-src/host/index.mjs:67` 的渠道表为 14 项，无个人微信项。 |
| 改动位置 | 新增 sidecar 契约（本机 IPC/HTTP 的消息与错误模型、版本号）+ mock sidecar + 插件侧轻量客户端；**不改** `src/` 现有文件；**不改** `package.json` 依赖。 |
| 依赖 | 无，可与 P0 并行。 |
| 验收方式 | mock 下默认启动**不连接微信、不扫码**；契约带版本号且能拒绝不兼容版本；集成测试用 mock 跑通进群/收未 @/发送三条路径。 |
| 明确不做项 | 不把 Wechaty 拉进插件依赖；不做真实登录；不做会话记忆与 Harness 接线。 |

#### WG-07 最小真实收发 spike

| 项 | 内容 |
| --- | --- |
| 现状证据 | 同 WG-06；进群/收未 @/发送能力均 `未核验`。 |
| 改动位置 | sidecar 侧代码（仓库外或独立目录，归属待定）；本仓库只新增 spike 记录，不动 `src/`、`plugin-src/`。 |
| 依赖 | WG-06；测试账号与风险承受范围（**当前缺失，硬阻塞**）。 |
| 验收方式 | 三条路径分别给出可复现步骤与脱敏证据；证据中区分"未收到"与"收到但被代码丢弃"；记录 sidecar 与依赖的固定版本。 |
| 明确不做项 | spike 阶段不接 Harness、不做多轮记忆、不做主动接话、不做媒体消息。 |

#### WG-08 P1a 能力矩阵与 P1b 放行判定

| 项 | 内容 |
| --- | --- |
| 现状证据 | 仓库无代码级渠道能力矩阵；唯一能力数组是飞书专用 `src/channels/feishu/multi-bot-controller.mjs:611`（文件级证据）。 |
| 改动位置 | 新增 spike 报告（建议 `outputs/wechatbot-supplement/spike-report.md`）。 |
| 依赖 | WG-07。 |
| 验收方式 | 报告给出三项能力的明确结论与 go/no-go；结论可被独立复核到原始记录；未核验项默认禁用。 |
| 明确不做项 | 不把"能收未 @"推断成"应做主动接话"——那是 P2 的独立决策；不在本条目里设计接话策略。 |

---

## 4. P1b：个人微信渠道完整适配器（群内 @问答）

**前置条件（硬）**：P1a 通过，且 WG-08 给出 go。**P1a 不通过则不启动 P1b。**

**准入条件**

1. WG-08 go/no-go 为 go，且证据可复核。
2. WG-12「风险与停用文档」已完成——这是 P1b 的**准入条件**，不是收尾项。
3. 负责人书面接受账号风险；**不得承诺低风险，不得把第三方个人微信协议设为默认启动路径**。
4. 只做群内 @问答；主动接话属 P2，禁止顺手实现。

**交付物**：WG-09…WG-13（WG-14 为降级路径文档）。

**退出条件**

- 默认启动路径为 **mock**，不连 Wechaty、不扫码；真实 sidecar 必须显式启用。
- 显式启用后，群内 @问答形成闭环；未 @ 群消息默认拒绝。
- 会话按 `group:conversationId` 隔离，不与其他群或私聊串话。
- `npm run check` 通过；停用演练成功（移除注册项 + 停止 sidecar），其余 14 渠道不受影响。

### P1b backlog

#### WG-09 `wechat-personal` 渠道骨架与注册点

| 项 | 内容 |
| --- | --- |
| 现状证据 | 新增渠道需约 10 个新文件 + 约 15 处注册点（清单位于 `impact-analysis.md` 第 2.1、5 节）；`plugin-src/host/channels/shared/access-policy-production.mjs:48` 的 `initialAccessPolicyFor` 对未知渠道抛错（`:97` `Unsupported access-policy channel`）。 |
| 改动位置 | 新增 `src/channels/wechat-personal/*`、`plugin-src/host/channels/wechat-personal/*`、`plugin-src/client/channels/wechat-personal/*`；注册 `plugin-src/host/index.mjs:67`、`plugin-src/client/index.js:102`，并补齐 `delivery-adapter.mjs:7`、`delivery-suggestions.mjs:1`、`diagnostic-details.mjs:92`、`context-enhancement.mjs:54`、`harness-approval.mjs:14`、`session-channel-labels.mjs:2`、`command-catalog.mjs:25`、`channel-logos.js:15`、`access-policy-settings.js:11`、`session-channel-logos.js:9`、`delivery-settings.js:46`。 |
| 依赖 | WG-08 go；WG-12 文档。 |
| 验收方式 | 新渠道出现在面板与投递路由；`access-policy-production.mjs` 不再抛错；其余渠道行为无回归（全量 `npm test`）。 |
| 明确不做项 | 不改共享模块的既有语义；不把新渠道做成默认启用；不新增跨渠道抽象。 |

#### WG-10 群语义接线（复用既有通用件）

| 项 | 内容 |
| --- | --- |
| 现状证据 | 群语义已是通用件：访问策略 `direct`/`group`（`src/channels/shared/access-policy.mjs:3`）；会话键 `kind:conversationId`（`text-harness-bridge.mjs:322`）；未 @ 群消息默认拒绝（`:255`）；`requiresMention`（`:918`）；群/私聊上下文增强（`context-enhancement.mjs:50`）；按会话键延迟投递（`deferred-delivery.mjs:96`）。 |
| 改动位置 | 新渠道 bridge 复用上述件，不修改其语义；对照样板 WhatsApp（`whatsapp-runtime.mjs:321` `@g.us` 判群、`:355` `addressed`）。 |
| 依赖 | WG-09。 |
| 验收方式 | 未 @ 群消息默认拒绝；@ 后单会话串行；跨群不串话；机器人自身消息不引发循环。 |
| 明确不做项 | 不实现未 @ 触发（P2）；不改 `text-harness-bridge.mjs` 的拒绝语义。 |

#### WG-11 默认 mock + 显式启用实验适配器

| 项 | 内容 |
| --- | --- |
| 现状证据 | WhatsApp 样板把扫码登录作为渠道内默认流程（`src/channels/whatsapp/whatsapp-web-session.mjs:7` baileys、`:74` `useMultiFileAuthState`、`:161` `onQr`）——**不采用**这种方式作为 P1 默认启动路径。 |
| 改动位置 | 新渠道 `config-store.mjs`、启动路径与设置页；默认 `mock`，真实 sidecar 需显式配置；未知 transport 直接报错。 |
| 依赖 | WG-09。 |
| 验收方式 | 默认启动不扫码、不连 sidecar（断言无出站连接）；显式 mock 跑通；未配置真实 transport 时启动失败但不影响其余渠道。 |
| 明确不做项 | 不做自动降级或协议切换；不提供"一键真实登录"；不在日志输出二维码内容或登录链接。 |

#### WG-12 风险与停用文档（P1b 准入条件）

| 项 | 内容 |
| --- | --- |
| 现状证据 | 仓库无第三方个人微信协议的风险记录；`impact-analysis.md` 第 4 节已将其列为 `未核验`。 |
| 改动位置 | 新增 `docs/方案/微信个人号接入风险与停用.md`（建议名）。 |
| 依赖 | 无（可提前写，但必须在 P1b 开始前完成）。 |
| 验收方式 | 文档含：数据范围、collect/处理边界、停用步骤（移除注册项 + 停止 sidecar）、回滚、以及明确的"不承诺低风险/免封"。 |
| 明确不做项 | 不做平台合规结论；不写"运行 N 天即安全"；不把付费协议包装成低风险替代。 |

#### WG-13 测试与质量门

| 项 | 内容 |
| --- | --- |
| 现状证据 | 唯一质量门 `package.json:99-103`（`build` / `node --test` / `verify-package`）；测试运行器 `package.json:101`；仓库无 lint/typecheck。 |
| 改动位置 | 新增 `test/channels/wechat-personal/*.test.mjs` 与跨渠道用例；mock 传输测试。 |
| 依赖 | WG-09、WG-10、WG-11。 |
| 验收方式 | `npm run check` 通过；覆盖未 @ 拒绝、会话隔离、暂停/预算/安静时段联动、重启后暂停保持。 |
| 明确不做项 | 不引入 lint/typecheck 工具链；不依赖真实微信账号跑 CI。 |

#### WG-14 降级路径与诉求差距说明

| 项 | 内容 |
| --- | --- |
| 现状证据 | `wecom`（智能机器人）已支持群：会话键 `group:${chatid}`（`src/channels/wecom/wecom-bridge.mjs:129`）、群回调保留触发用的 @ 前缀（`:151`）、`chattype === 'group'` 处理（`:758`–`:761`）、`addressed: true`（`:1021`）。**注意**：任务简报称 `wecom-app` 也支持群，但仓库证据相反——`src/channels/wecom-app/wecom-app-bridge.mjs:281` 硬编码 `conversationType: 'direct'`，`wecom-app-runtime.mjs` 无群处理。该差异标 `待确认`，不得按"已支持群"引用。 |
| 改动位置 | 仅写入对外交付物文档段落；不改代码。 |
| 依赖 | 无。 |
| 验收方式 | 文档明确写出：企微群 @应答**立即可用**，是降级路径；但它**不满足**"成员用个人微信在普通群里使用"的原始诉求。 |
| 明确不做项 | 不把企微群表达成原始目标达成；不把 `wecom-app` 列为群聊可用路径。 |

---

## 5. P2：未 @ 群消息低频自主接话（仅证据门槛，不承诺）

**性质**：`不承诺目标`。本节**只列证据门槛**，不含设计草案，不含 backlog 条目，不设交付物与退出条件。P2 是否启动由独立决策决定，不随 P1b 自动解锁。

**证据门槛（全部满足才允许讨论启动）**

| # | 门槛 | 当前状态 |
| --- | --- | --- |
| 1 | 真实群中**能稳定收到未 @ 消息**，且有可复现记录 | `未核验`（P1a 才能回答） |
| 2 | 发送侧的预算、安静时段、持久暂停、dry-run 已在真实账号上验证有效 | 依赖 P0 退出条件 |
| 3 | 群成员**知情同意**的证据（群公告、参与范围、退出方式） | 缺失 |
| 4 | 一轮观察期的统计：误回复、重复发送、成员反馈、API 成本 | 缺失 |
| 5 | 平台限制事件记录与应对记录（若有事件） | 缺失 |
| 6 | 负责人对"打扰与账号风险"的独立书面接受 | 缺失 |

**明确不做**：不写自主接话的设计草案（触发规则、冷却、概率、上下文裁剪一律不谈）；不列 P2 backlog 条目；不在 P1 范围顺手实现；不承诺任何自主接话时间表。

---

## 6. 依赖关系与编号汇总

```text
P0 (WG-01..05) ─> P1a 准入 ─> WG-06 ─> WG-07 ─> WG-08 go/no-go
                                                 └─ go ─> P1b 准入（需 WG-12 完成）
                                                            └─ WG-09 → WG-10 → WG-11 → WG-13
P2 ── 仅证据门槛，独立决策，不承诺；WG-14 ── 可与任何层并行
```

| 编号 | 层 | 一句话 | 关键依赖 |
| --- | --- | --- | --- |
| WG-01 | P0 | 发送预算与限频 | controls-spec、WG-04 |
| WG-02 | P0 | 安静时段 | WG-01 |
| WG-03 | P0 | dry-run | WG-01、WG-04 |
| WG-04 | P0 | 账号级持久暂停 | 无 |
| WG-05 | P0 | 渠道侧原文落盘开关 | WG-04 |
| WG-06 | P1a | sidecar 契约 + 默认 mock | 无 |
| WG-07 | P1a | 最小真实收发 spike | WG-06、测试账号 |
| WG-08 | P1a | 能力矩阵与 P1b 放行判定 | WG-07 |
| WG-09 | P1b | 渠道骨架与注册点 | WG-08 go |
| WG-10 | P1b | 群语义接线 | WG-09 |
| WG-11 | P1b | 默认 mock + 显式启用 | WG-09 |
| WG-12 | P1b | 风险与停用文档（准入） | 无 |
| WG-13 | P1b | 测试与质量门 | WG-09/10/11 |
| WG-14 | 降级 | 企微群路径与差距说明 | 无 |

---

## 7. 未核验项与不确定点（不得当作已确认）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | Wechaty / 各 Puppet 的当前可用性、维护状态、许可与费用 | `未核验`（外部事实，需单独核验） |
| 2 | 第三方个人微信协议的封号风险与平台规则 | `未核验`；**不承诺低风险** |
| 3 | 普通群未 @ 消息的可读性 | `未核验`；只能由 WG-07 实测回答 |
| 4 | sidecar 的 Node 版本与依赖组合 | `未核验` |
| 5 | `wecom-app` 是否支持群 | 仓库证据显示不支持（`wecom-app-bridge.mjs:281` 硬编码 direct）；与任务简报不一致，`待确认` |
| 6 | 腾讯 iLink 是否未来开放群能力 | `未核验`；代码层无迹象 |
| 7 | `plugin-src/host/channels/shared/production.mjs` 通用控制器函数名 | 文件级证据，本次未逐行核验 |
| 8 | 客户端 dry-run 设置的具体挂载位置 | 文件级证据（参考 `delivery-settings.js:46`），未逐行核验 |
| 9 | 本 run 同目录 `controls-spec.md` | 写入本文件时尚未存在（并行单元产出）；P0 的字段级验收以它为准 |
