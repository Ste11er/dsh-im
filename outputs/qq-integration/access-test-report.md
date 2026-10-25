# QQ 渠道真实接入实测报告

- 日期：2026-10-23
- 渠道：QQ 官方机器人（QQ 开放平台），插件渠道 `qq`
- 被测对象：`src/channels/qq/`（`QqRuntime` + `QqHarnessBridge`）与真实腾讯网关
- 性质：**真实接入测试记录**（非模拟）。凭据与日志均在本地被忽略目录，不进入版本库。

## 1. 结论

**QQ 渠道的「接入 + 私聊收发」在真实平台上跑通了。**

| 环节 | 结果 | 证据 |
| --- | --- | --- |
| AppID / AppSecret 有效性 | ✅ | `✅ Access token obtained`（SDK token 服务） |
| WebSocket 长连接 | ✅ | `Connecting to wss://api.sgroup.qq.com/websocket` → `WebSocket connected` → `gateway READY` |
| 插件运行时状态 | ✅ | `ready: true`、`qqConnectionState: "connected"`、`harnessReachable: true`、`lastError: null` |
| 入站私聊消息 | ✅ | 收到测试消息「在吗」，`messagesReceived: 1`，入站内容进入处理链路（bridge 已构造 prompt） |
| 出站回复 | ✅ | `messagesReplied: 1`；QQ API 两次 `Status: 200 OK` |
| 会话键与隔离 | ✅ | 会话键 `c2c:<openid>`（私聊通道），`seenMessageIds: 1`（去重生效） |

时间线（本地时间 22:10–22:11）：

```
22:09:58  STARTING（凭据来自本地被忽略文件）
22:09:59  ✅ Access token obtained
22:10:00  WebSocket connected
22:10:01  gateway READY
22:11:18  BRIDGE_ASK "在吗"            ← 用户消息到达
22:11:19  [qqbot:api] 200 OK           ← 回复被平台接受
22:11:21  messagesReplied: 1           ← 回复完成
```

## 2. 测试方法

- 用插件**自己的** `QqRuntime`（不是裸 SDK）连真实网关，确保走的是产品代码路径：`src/channels/qq/qq-runtime.mjs`、`qq-bridge.mjs`、`state-store.mjs`。
- 为隔离依赖，harness 用 **stub**：收到消息后返回固定文案「【接入测试】QQ 通道已打通，这是一条来自插件的自动回复。」，不启动模型/DSH 运行时。因此本次验证的是**通道与消息链路**，不是模型回答质量。
- 访问策略用测试用「全开放」策略，避免测试前不知道自己的 openid 而收不到消息；生产默认已是收紧后的策略。
- 凭据只写入 `outputs/runtime/qq-integration/credentials.json`（权限 `0600`，目录被 `.gitignore` 忽略），日志从不打印 Secret。
- 复现脚本：`outputs/runtime/qq-integration/connect-test.mjs`（日志 `connect.log`、结果 `connect-result.json`）。

## 3. 本次 **未** 覆盖（不要当作已验证）

| 项 | 说明 |
| --- | --- |
| 群聊 @ 问答 | 本次只验证了私聊（`c2c`）。群 @ 需把机器人拉进测试群后另测 |
| 未 @ 群消息（全量模式） | 依赖 `WG-QQ-10`：开放平台"接收所有消息"能力，属平台侧审核，本地无法绕过 |
| 真实模型 / DSH 会话链路 | 本次用 stub harness；真实回答链路需在 DSH 里绑定该机器人后验证 |
| 暂停在真实通道上的表现 | `WG-QQ-03` 的三层语义已由 `outputs/qq-impl/verify.mjs` 机械验证（12/12）；真实通道复测为可选项 |
| 断线重连 / 长文分段 / 图片与文件 | 未覆盖 |
| 群成员角色（`member_role`） | 平台是否随载荷下发仍未核验（见计划文档未核验项） |

## 4. 安全与凭据

- AppID `1905••88`、Secret 均**未进入任何 git 跟踪文件或提交历史**（已用 `git ls-files` 与 `git log --all -S` 双向核查：0 命中）。
- 凭据只存在于 `outputs/runtime/qq-integration/credentials.json`（`0600`，被 `.gitignore` 忽略）；测试日志中的 AppID 已改为掩码输出。
- **建议**：由于 Secret 曾通过聊天传递，测试结束后请在 QQ 开放平台重置一次 Secret，并只更新本地被忽略的凭据文件——仓库无需任何改动。

## 5. 对计划的影响

- `P1′` 的前置里，「扫码/凭据接入」「WebSocket 连接」「私聊收发」已被真实验证，不再是风险项。
- 剩余外部卡点仍是 `WG-QQ-10`（全量群消息），以及 P0′ 中未实现的发送类控制（预算/安静时段/dry-run/渠道侧持久化）。

---

## 6. 追加实测：群聊路径与「全量群消息」（2026-10-23 22:18）

### 6.1 群内 @问答：通过

- 群里 @ 机器人发送「1」→ 入站进入处理链路 → QQ API `200 OK` → `messagesReplied: 1`。
- 状态文件出现独立会话键 `group:964096…99E0`，与私聊 `c2c:D829B0…C414` 相互隔离。

### 6.2 重要发现：该机器人**已在接收全量群消息**

入站探针在未 @ 的群消息上抓到：

```
kind=group  rawEventType=GROUP_MESSAGE_CREATE  mentions=0  addressed=false
sender=FE53E8…AC7D（另一名群成员）  content="所以发生什么事了"
```

结论：

- 平台把**群里每一条消息**都推给了这个机器人（`GROUP_MESSAGE_CREATE`），不只是 @ 它的消息；
- 说明 `WG-QQ-10`（开放平台"接收所有消息"）对**这个机器人**已经生效——**不再是 P1′ 的阻塞项**；
- 但当前代码对 `addressed=false` 的群消息**默认直接丢弃**（不回复、不调模型），符合计划中"未 @ 默认只入上下文/不回复"的安全默认；"只入上下文"仍需按 `WG-QQ-11` 实现；
- 该结论只对**这一个机器人**成立（其开放平台配置/机器人类别可能不同），不能外推到其他机器人；换机器人需重新验证。

### 6.3 访问策略：已按需求配置（真实通道）

需求：群成员不能私聊机器人，只能在群里用。

| 作用域 | 配置 |
| --- | --- |
| direct 私聊 | `allowlist`，仅 owner openid（`D829B0…C414`）可私聊；其他账号私聊会被**静默丢弃** |
| group 群聊 | `open`，群内成员可 @ 问答；默认命令权限关闭（命令仅 owner） |

- 已验证：owner 私聊正常、群 @ 正常。
- **待验证**：另一账号私聊是否被拦（需要第二个 QQ 账号发起私聊；`rejected` 计数可佐证）。

### 6.4 仍未覆盖

- 另一账号私聊拦截（见 6.3）；
- "未 @ 只入上下文"（`WG-QQ-11`，尚未实现）；
- P0′ 发送类控制（预算/安静时段/dry-run/渠道侧持久化）尚未实现。

### 6.5 私聊限制的最终确认（2026-10-23 22:30）

- 用户侧确认：**群里的其他人无法私聊该机器人**（只能群里聊）。
- 日志核对：本次策略受测期间**没有出现非 owner 的 `c2c` 入站事件**（入站全部为 `kind=group / GROUP_MESSAGE_CREATE`，发送者含 owner、`CEEAF0…`、`FE53E8…`）。
- **诚实区分**：这更可能是**平台层未向机器人投递**这类私聊（或对方未能成功发起），而不是我们的访问策略"拒绝"了它——日志里没有可归因于策略拒绝的 `c2c` 事件。策略本身（direct=仅 owner 白名单）已按需求配置并在代码层验证；但"策略拦截"与"平台不投递"是两件事，不要把后者写成前者的证据。
- 受测程序已按用户要求停止；本地日志中的 AppID 已掩码。

### 6.6 全量群消息的持续观察

- 受测期间机器人持续收到群里**全部**成员的普通消息（含 `CEEAF0…`、`FE53E8…` 非 owner 成员），累计 18 条，全部 `mentions=0 / addressed=false`，均被默认丢弃、未触发模型、未回复。
- 这进一步确认：`WG-QQ-11`（未 @ 只入上下文）具备真实输入源，可以进入实现阶段（按推荐，排在 P0′ 发送控制之后）。
