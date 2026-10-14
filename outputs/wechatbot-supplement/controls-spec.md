# 微信渠道补充：五项出站控制规范（设计稿）

- 工作单元：`write-controls-spec`（产出模块 `controls-spec`）
- 性质：**规范 / 设计文档**，描述"应该长什么样"，**不是已实现能力**。
- 本文不含任何真实账号实测结论；凡未从仓库证据确认的一律标 `未核验`。
- 仓库现状（见同目录 `impact-analysis.md` 第 2.5 节）：五项控制在仓库内**零实现**。本文是对这五项的补齐设计。
- 仓库唯一质量门：`package.json:99-103`（`build` / `test` / `check = build && test && verify-package`），无 lint / typecheck。任何实现落地都以该门为准。

## 0. 文档边界与两条已确认的改写

1. **安静时段默认关闭，且只约束"主动投递"与"后台结果补发"，不约束被动回复。**
   理由：被动回复被静默会破坏 `/stop`、延迟补发和审批闭环语义——用户看不到控制命令反馈，审批提示也会消失。
2. **原"原文不落盘"改写为"渠道侧不新增持久化"。**
   准确含义是渠道适配器不再额外写一份原文/日志；**不是**"聊天记录不留存"。DSH 会话本身仍必须保存上下文才能多轮对话，这一点不在本控制的作用域内（见 2.5）。

## 1. 统一拦截分层（下文术语）

| 层 | 名称 | 现有入口（已核验） | 是否受五项控制约束 |
| --- | --- | --- | --- |
| L1 | 入站层 | `src/channels/shared/inbound-access.mjs:14` `evaluateInboundAccess`；默认全拒策略 `src/channels/shared/access-policy.mjs:140` | 否（授权问题，不由本组控制接管） |
| L2 | 被动回复层 | 回合内直接回给用户的消息，含控制命令反馈（`src/channels/shared/control-command.mjs`） | **仅 dry-run 可观测**；暂停、预算、安静时段均不拦 |
| L3 | 主动投递层 | `src/channels/shared/text-harness-bridge.mjs:652` `sendProactiveText`；路由白名单 `plugin-src/host/delivery-adapter.mjs:7` | 是 |
| L4 | 后台结果补发层 | `src/channels/shared/deferred-delivery.mjs:96` 注册表；`deferred-delivery-coordinator.mjs:24` 协调器 | 是 |

作用域词汇（全文一致）：

- **账号级**：以 bot 为单位（渠道 × 账号）。
- **会话级 / 群级**：以会话键 `kind:conversationId` 为单位（`src/channels/shared/text-harness-bridge.mjs:322`）。群聊与私聊是不同会话键，因此"群级"是"会话级"的子集，不另造概念。

判定顺序（同一出站请求）：**账号级持久暂停 → dry-run → 发送预算/限频 → 安静时段 → 真实发送**。暂停是硬闸，dry-run 是影子模式，后两者是配额与时间窗。

## 2. 五项控制

### 2.1 发送预算 / 限频

- **触发点**：出站统一闸门，作用于 L3 与 L4。落在渠道账号的发送入口之前（微信侧即调用 `sendProactiveText` 之后、真正 `bot.sendText` 之前的位置）。**不拦 L2 被动回复**。
- **作用域**：账号级为主（滑动窗口令牌桶：每窗口容量、窗口长度、是否允许突发）。可选会话级子预算，用于限制单个群/单聊占用账号总额度的比例。
- **默认值**：**关闭（不限额）**。理由：仓库现状无任何限频，默认开启等于静默改变现有投递行为。渠道声明的平台限额只在设置页**展示**，不自动生效。
  - 仓库内唯一"读取平台声明"的实现是邮件渠道 `src/channels/email/transports/agent-mail.mjs:105,133`（`perMinute` / `perHour` / `dailySendQuota`）；`src/channels/email/email-runtime.mjs:29` 的轮询间隔同理只是**读取**，二者都不构成预算执行。是否可把平台声明直接当作出站预算上限，`未核验`。
- **计数单位**：按"实际发送段"计数，不按"调用次数"。微信主动长文本沿用 1,800 字符分段预算，每段都占用平台发送次数（`PROACTIVE_DELIVERY.md:326`），按调用计数会低估消耗。
- **超额行为**：不排队、不静默丢弃，返回可区分的"预算耗尽"结果并告知调用方/用户；已生成的内容不重新生成（见 3.5）。
- **重启行为**：预算开关与阈值必须随账号配置持久化；窗口内已用计数建议一并持久化，否则重启会短暂放宽额度而失去限频意义。该持久化的具体字段与文件位置 `未核验`。
- **可观测信号**：
  - 状态字段（设计）：`budget: { enabled, window, limit, used, resetsAt }`。
  - 诊断：新增"被预算拒绝"的诊断原因，挂在现有诊断渠道集合 `src/channels/shared/diagnostic-details.mjs:92` 之上；诊断里只放计数与窗口，不放正文。
  - 日志：`[dsh-im] outbound budget exhausted`（含渠道、账号、窗口、剩余时间）。
  - 用户可见：账号级提示"已达本账号发送上限，请稍后重试"；群内可按既有失败提示样式回执。

### 2.2 安静时段

- **触发点**：L3 与 L4 的出口闸门。**明确不作用于 L2 被动回复**——用户在安静时段发言仍立刻收到回复。
- **作用域**：账号级默认（一个时间窗），可被会话级覆盖（例如只对某个群静默）。时区来源 `未核验`（Host 本地时区，还是每账号单独配置）。
- **默认值**：**关闭**（用户已确认）。开启后默认窗口形状为"每日 HH:MM–HH:MM"。
- **行为**：命中安静时段时**延迟投递**，不是丢弃。被延迟的内容进入二次排队，在窗口结束时投递，投递内容与目标不变。
  - 关键约束：安静时段的等待**不得计入延迟投递的失败尝试**（`src/channels/shared/deferred-delivery.mjs:157`：`attempts >= 3` 即置 `failed`）。若把静默等待算作一次尝试，三次静默就会永久丢失结果。
- **重启行为**：窗口配置持久化，重启后继续生效；已排队待投递的静默项也要求持久化，否则重启即丢。若实现选择不持久化队列，则必须在文档与状态里显式标注"重启丢失静默队列"，当前视为 `未核验` 的降级选项。
- **可观测信号**：
  - 状态字段（设计）：`quietHours: { enabled, window, timezone, active, nextResumeAt, queued }`。
  - 诊断/日志：`[dsh-im] quiet hours deferred delivery until <nextResumeAt>`；诊断标注"因安静时段延迟"。
  - 用户可见：窗口结束后的补发内容前不加额外噪声；设置页显示当前是否处于安静时段与下次恢复时间。

### 2.3 dry-run

- **触发点**：出站闸门最外层之一（顺序见第 1 节），拦截 L3、L4 以及连接测试路径（`src/channels/shared/text-harness-bridge.mjs:643` `sendConnectionTest`）。命中后**不调用真实发送**，只生成一条预览记录。默认不作用于 L2，避免控制命令与审批提示被吞。
- **作用域**：账号级开关；允许会话级覆盖。
- **默认值**：**关闭**（真发）。
- **行为**：预览记录包含渠道、目标、文本长度与分段数、以及"若无 dry-run，本次会被暂停/预算/安静时段中的哪一项拦截"。预览内容不得写入渠道侧的原文持久化（见 2.5）；预览记录建议仅存内存并短时保留，具体保留期 `未核验`。
- **重启行为**：开关是配置项，必须持久化，重启后保持；内存中的预览记录重启即清空（可接受）。
- **可观测信号**：
  - 状态字段（设计）：`dryRun: { enabled, suppressedCount, lastPreviewAt }`。
  - 日志：`[dsh-im] dry-run suppressed outbound`。
  - 用户可见：设置页显著标识"dry-run 中，不会真实发送"；由调用方发起的投递返回"已被 dry-run 拦截"，与真实失败区分。

### 2.4 账号级持久暂停

- **触发点**：出站闸门的最外层，优先级最高。作用于 L3、L4 与连接测试；**不作用于 L1 入站，也不作用于 L2 被动回复**——暂停期间消息仍进入 DSH 会话并照常开启回合，否则 `/stop` 本身也会失效。
- **作用域**：账号级（bot 粒度）；可扩展会话级"只静音这个群"。
- **默认值**：**未暂停**（active）。暂停必须由显式操作设置（Web 设置页，或新增控制命令——现有命令目录 `src/channels/shared/command-catalog.mjs:25` 中没有暂停类命令，新增属设计建议）。
- **与既有的区别**：WhatsApp 的 typing presence `paused`（`src/channels/whatsapp/whatsapp-runtime.mjs:695`）是**协议在线状态**，不是持久配置，重启与重连即失去意义。本项的暂停是**持久配置**，语义是"该账号不再主动发出任何消息"。
- **行为**：暂停只拦出站，不取消、不删除任何已存在的工作；入站、回合执行、审批判定、`/stop` 全部照常。
- **重启行为**：**必须持久化**（落在账号配置文件里，形态可参照 `src/channels/whatsapp/config-store.mjs:7` 的 `{ version, bots }` 文档）；重启后仍为暂停。恢复同样必须显式操作。
- **可观测信号**：
  - 状态字段（设计）：`paused: { active, reason, since, by }`。
  - 诊断：账号健康面板展示暂停原因与起始时间；`src/channels/shared/diagnostic-details.mjs:92` 的渠道集合内可见 "paused"。
  - 用户可见：设置页横幅"该机器人已暂停发送"；被拦的主动投递回执"该机器人已暂停发送，未投递"。

### 2.5 渠道侧不新增持久化（原"原文落盘开关"）

- **准确含义**：渠道适配器**不再额外写一份原文/日志**；**不是**"聊天记录不留存"。
- **边界（必须写清）**：
  - **DSH 会话本身仍需保存上下文**才能支持多轮对话与 `/stop`、`/steer` 等控制命令，这属于会话存储，不在本控制作用域内。
  - 共享会话存储只保存 ID，不保存正文：`src/channels/shared/conversation-state-store.mjs:13` 的形状是 `{ version, sessions, seenMessageIds, cursor }`（`sessions` 是会话键到 sessionId 的映射）。
  - 现状**例外**是微信渠道：`src/channels/weixin/state-store.mjs:14` 的 `recentOutboundMessages` 会**无条件**保存出站原文，配套常量在 `:17`（上限 200 条）、`:18`（TTL 30 天）、`:19`（单条文本上限 8,000 字符）。该键的消费方在本单元未核验。
- **触发点**：渠道 `state-store` 的写入点（微信即写入 `recentOutboundMessages` 的那处），以及任何渠道级正文日志的写入点。
- **作用域**：渠道 × 账号，逐渠道独立配置（各渠道 `config-store` / `state-store` 各自持有）。
- **默认值**：**不改变现状**，即默认保留各渠道当前行为。提供三档模式：
  - `full`：现状（如微信保留出站原文）。
  - `minimal`（推荐）：只保留对账所需的 ID / 哈希 / 长度 / 时间戳，不保留原文。
  - `off`：不新增任何渠道侧持久化。
- **改档风险**：微信关闭原文后，依赖原文的出站回声对账是否仍有替代机制，`未核验`；在核验前，`minimal` / `off` 只能作为显式选择，不能成为默认。
- **重启行为**：模式是配置项，必须持久化；切换模式后是否清理既有落盘数据（尤其是 30 天 TTL 的历史条目）`未核验`。
- **可观测信号**：
  - 状态字段（设计）：`rawRetention: { mode: 'full' | 'minimal' | 'off', since }`。
  - 诊断：展示当前模式与"渠道侧是否保存正文"的布尔结论。诊断字段本身受长度与脱敏约束（`src/channels/shared/diagnostic-details.mjs:88`：`hint` 截断到 500 字符），**不得把原文写进诊断**。
  - 用户可见：设置页用一句话说明——"关闭后渠道侧不再额外保存消息原文；会话上下文仍由 DSH 保存以支持多轮对话。"

## 3. 与既有语义的交互

### 3.1 与 `/stop`

- `/stop` 由 `src/channels/shared/control-command.mjs:5` 的 `CONTROL_COMMAND` 匹配（`/stop|/steer|/version`），语义是**只停当前回合，不删除会话**。
- 五项控制都**不得**阻止 `/stop` 的入站解析与其反馈回复：入站不受暂停影响，被动回复（含"已请求停止当前任务"）不受安静时段与预算约束。
- `/stop` 不改变任何控制的配置：它不取消暂停、不重置预算窗口、不修改 dry-run 与原文保留模式。
- `/stop` 触发后台停止（`control-command.mjs:85-90` 调 `deferredDelivery.stop(key)`）时，返回 `stopped` / `unavailable` 的既有分支语义保持不变。

### 3.2 与延迟投递 / 后台结果补发

- 机制：按会话键登记（`src/channels/shared/deferred-delivery.mjs:96`，键形如 `key sessionId turn`，`:98` 每键上限 4 条）；明确失败最多 3 次（`deferred-delivery.mjs:157` `attempts >= 3 → failed`，`deferred-delivery-coordinator.mjs:178` 指数退避）；**结果不确定时不自动重试**（`deferred-delivery-coordinator.mjs:172` 置 `deliveryOutcome: 'unknown'`）。
- 与安静时段：静默等待是"推迟"，**不是一次失败尝试**，`attempts` 不递增、状态保持 `pending`，窗口结束再投。
- 与发送预算：预算耗尽时同样**保持 `pending` 并退避**，不能立即计入失败——否则 3 次预算拒绝就会永久丢掉一条结果。
- 与账号暂停：暂停期间**冻结**补发定时器，不投递、不计尝试；恢复后继续。暂停不应导致"超时丢弃"。
- 与 `deliveryOutcome: 'unknown'` 的区别：本地控制（暂停 / 预算 / 静默）造成的"没发出去"，语义是"**尚未尝试**"，与"平台结果未知"是两件事；前者可安全重试，后者按现有规则不自动重试。

### 3.3 与审批闭环

- 审批是交互闭环：共享渠道列表在 `src/channels/shared/harness-approval.mjs:14`，默认超时 60 分钟并自动拒绝（`:24`，配套文案 `:22`/`:23`），Web 与机器人双端可处理同一审批。
- 暂停 / 预算耗尽 / 安静时段**均不得**取消待审批项，也**不得**触发自动拒绝或缩短超时；审批的超时只按既有规则走。
- 若机器人端的审批提示属于 L2 被动回复，则三项出站控制都不拦它；若某条审批结果通知走 L3 主动投递，它会被暂停/静默拦下——此时必须保证 **Web 端仍可看到并处理**，不能因为出站被拦而使审批结论只在机器人端可见。
- dry-run 命中时，审批提示若走主动投递会只出预览；因此 dry-run 默认不作用于审批相关的被动路径。

### 3.4 与主动投递

- 入口 `src/channels/shared/text-harness-bridge.mjs:652` `sendProactiveText`；路由白名单 `plugin-src/host/delivery-adapter.mjs:7`。
- 微信约束：主动投递需要该用户最近一次消息的 `context_token`，上下文只保存在 Host 账号状态中、重启后恢复，且重新绑定并更换登录凭据后清理；升级后需先收到一次用户消息才能建立缓存（`PROACTIVE_DELIVERY.md:324-326`）。
- 与三项出站控制：
  - 被暂停 / 静默 / 预算拒绝时**不消耗** `context_token`，因为根本没有走到平台发送。
  - dry-run 下不产生真实投递；被动投递本就不保存历史、不生成 `deliveryHandle` / `idempotencyKey`、不自动重试（`PROACTIVE_DELIVERY.md:319`），控制命中时这一语义不变。
  - 计数按分段计（`PROACTIVE_DELIVERY.md:326`），且"分段不会解除平台额度限制"。
  - 平台侧的额度与上下文错误（如 `ret=-2 prepare failed`）与本地预算/暂停是不同来源，诊断需可区分；本地控制不得据此推断凭据失效（`PROACTIVE_DELIVERY.md:325`）。

### 3.5 汇总：暂停或预算耗尽时，三类在途对象怎么处理

| 在途对象 | 账号暂停期间 | 预算耗尽时 | 安静时段内 | 恢复后 |
| --- | --- | --- | --- | --- |
| 已生成的回答（已在 DSH 会话历史中） | 保留在会话历史，不撤回、不删除 | 保留在会话历史 | 保留在会话历史 | 不重新生成；按需投递 |
| 待审批项 | 不取消、不自动拒绝；超时仍按 60 分钟默认规则（`harness-approval.mjs:24`） | 同左 | 同左 | Web 端仍可随时处理 |
| 延迟补发任务（`pending` 条目） | 冻结定时器，不计 `attempts` | 退避重排，保持 `pending`，不计失败 | 推迟到窗口结束，`attempts` 不变 | 继续投递；`attempts` 仍受 3 次上限约束（`deferred-delivery.mjs:157`） |
| 控制命令反馈 / `/stop` 回复（L2） | 照常发送 | 照常发送 | 照常发送 | — |

## 4. 未核验项（不得当作已确认）

1. 五项控制的配置文件落点与字段命名（是否复用现有 `config-store` 形态）→ `未核验`。
2. `recentOutboundMessages` 的读取/消费方，以及关闭原文后的回声对账替代方案（本单元只核验到键与三个常量：`src/channels/weixin/state-store.mjs:14,17,18,19`）→ `未核验`。
3. 平台声明的 `rateLimits`（`src/channels/email/transports/agent-mail.mjs:105,133`）能否直接作为出站预算依据 → `未核验`。
4. 安静时段队列的持久化可行性、时区来源（Host 本地或每账号配置）、跨天窗口与"仅工作日"等形状 → `未核验`。
5. dry-run 预览记录的保留期、存放位置与是否可被调用方读取 → `未核验`。
6. 是否需要新增暂停 / dry-run / 预算类控制命令（当前 `src/channels/shared/command-catalog.mjs:25` 目录内没有）→ 设计建议，未实现。
7. `minimal` / `off` 模式下切换后既有渠道侧正文数据的清理策略 → `未核验`。
8. 按段计数的预算在跨渠道（单段发送的渠道与分段发送的渠道）之间是否可比 → `未核验`。
9. 未经真实账号实测：本文不含任何实测结论，五项控制在仓库内的实现状态为零。
10. WhatsApp `paused` presence（`src/channels/whatsapp/whatsapp-runtime.mjs:695`）是否对发送行为有副作用，仅作"非持久暂停"的对照，未核验。

## 5. 明确不做

- 本单元不改 `src/`、`plugin-src/`、`README.md`、`README.en.md`、`CHANGELOG.md`，不声明任何能力已存在。
- 不承诺"聊天记录不留存"；会话上下文仍由 DSH 保存。
- 不用安静时段约束被动回复，也不用暂停/预算吞掉 `/stop`、审批与延迟补发的反馈。
- 不默认启用预算，不把 `minimal` / `off` 设为原文保留的默认值。
