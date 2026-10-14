# 影响面分析：为 dsh-im 补齐 wechatbot 补充目标

- 工作单元：`map-impact`（模块 `impact-analysis`）
- Vibe run：`vibe-linux-6bb9bad8c72b4ade`
- 性质：本 run 的工作产物，**不是** `docs/` 下的规范位置，不对外发布。
- 对外交付物是 `docs/方案/微信个人号群聊补充目标与计划.md`。

## 0. 结论摘要

1. **本单元与本次 run 不改任何代码**：只新增一份计划文档。因此本次的影响面是"文档新增"，不是"行为变更"。
2. **若 P1b（个人微信渠道）落地**，会新增本仓库第 15 个渠道，需要新增约 10 个文件并改约 15 处注册点；这些点已逐处列出（第 5 节），是本计划里最贵的一块。
3. **群聊业务语义已经是通用件**，P1b 不需要重造：访问策略、会话键、未 @ 群消息拒绝、`requiresMention`、群上下文增强、按会话键的延迟投递都已存在。
4. **官方微信渠道不可能通过开关拿到群能力**：iLink 渠道在运行时硬编码只接受单聊目标，CDN 路径写死 `/c2c/`。
5. **P0 五项控制在仓库内零实现、零规范**：发送预算/限频、安静时段、dry-run、账号级持久暂停、渠道侧原文落盘开关全部缺失。
6. 不可逆影响：本次无。P1b 落地时，独立 sidecar 进程可整体摘除，失败隔离在单渠道内。

## 1. 证据方法与可信度

- 本 Agent 直接核验的行号：写入前全部用 `grep -n` 复核过一次。
- 只读审计 subagent（`b8bad4a3`，无写入）提供并交叉印证了注册点清单；其中未能复核到行号的条目在本文件中降级为**文件级证据**并明确标注。
- 凡无法从仓库证据确认的，一律标 `未核验`，不做推断（见第 4 节）。

## 2. 受影响面

### 2.1 渠道注册契约（P1b 必改，本次不动）

| 位置 | 作用 | 证据 |
| --- | --- | --- |
| `plugin-src/host/index.mjs` | Host 侧渠道注册表，14 项；并行启动 | `:67` `const channels = [`；`:189` `await Promise.all(...)` |
| `plugin-src/client/index.js` | 客户端渠道列表与设置页 | `:102` `const CHANNELS = Object.freeze([` |
| `plugin-src/host/channels/shared/startup.mjs` | 每渠道安装入口 | `:29` `export async function installProductionChannel` |
| `plugin-src/host/delivery-adapter.mjs` | 主动投递路由 | `:7` `const CHANNELS = new Set([`；`:75` `function normalizeRoute` |
| `plugin-src/host/delivery-suggestions.mjs` | 投递目标建议 | `:1` `const CHANNELS = new Set([` |
| `plugin-src/host/channels/shared/access-policy-production.mjs` | 访问策略通道白名单，**未知渠道直接抛错** | `:48` `initialAccessPolicyFor`；`:97` `Unsupported access-policy channel` |
| `plugin-src/client/access-policy-settings.js` | 确认属主渠道集合 | `:11` `CONFIRMED_OWNER_CHANNELS`；`:14` `weixin:` 条目 |
| `plugin-src/client/channel-logos.js` | 渠道 Logo | `:15` `'data-im-channel-logo': 'weixin'` |
| `plugin-src/client/session-channel-logos.js` | 会话渠道图标 | `:9` `weixin:` |
| `plugin-src/client/delivery-settings.js` | 投递设置 | `:46` `weixin:` |
| `src/channels/shared/session-channel-labels.mjs` | 会话前缀标签 | `:2` `weixin: ['微信', 'WeChat']` |
| `src/channels/shared/diagnostic-details.mjs` | 诊断渠道集合 | `:92` `DIAGNOSTIC_CHANNELS` |
| `src/channels/shared/command-catalog.mjs` | 共享命令目录 | `:25` `SHARED_COMMAND_CATALOG`（`:37/:86/:87/:92` 为 `privateOnly` 项） |
| `src/channels/shared/context-enhancement.mjs` | 上下文增强渠道 | `:54` 渠道列表 |
| `src/channels/shared/harness-approval.mjs` | 参与共享审批的渠道 | `:14` 渠道列表 |

### 2.2 可复用的群语义（P1b 不必重造）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 访问策略支持 `direct`/`group` | `src/channels/shared/access-policy.mjs:3` | `ACCESS_POLICY_CONVERSATION_TYPES = ['direct','group']` |
| 默认拒绝策略 | 同上 `:140` | `DEFAULT_ACCESS_POLICY` 两个作用域均为 allowlist 空表 |
| 入站授权总入口 | `src/channels/shared/inbound-access.mjs:14` | `evaluateInboundAccess`；`:24` 特权放行 |
| 群会话隔离 | `src/channels/shared/text-harness-bridge.mjs:322` | 会话键 `kind:conversationId` |
| 未 @ 群消息默认拒绝 | 同上 `:255` | 注释明确"访问策略不把未 @ 群消息变成拒绝回复" |
| 群消息需 @ | 同上 `:918` | `requiresMention: message.kind === 'group' && ...` |
| 主动投递接口 | 同上 `:652` | `sendProactiveText` |
| 会话/去重持久化 | `src/channels/shared/conversation-state-store.mjs:13` | `{ version, sessions, seenMessageIds, cursor }`；`:68` 起为读写函数 |
| 延迟投递 | `src/channels/shared/deferred-delivery.mjs:96`、`deferred-delivery-coordinator.mjs` | 按会话键登记 |
| 群/私聊上下文增强配置 | `src/channels/shared/context-enhancement.mjs:50` | `CONFIG_KEYS = ['group','direct']` |

推论：P1b 的工作量集中在**传输层**（登录、收消息、发消息、媒体、成员身份），业务语义层基本是接线。

### 2.3 最近的样板：WhatsApp（个人账号 + 关联设备 + 群）

| 关注点 | 位置 | 观察 |
| --- | --- | --- |
| 协议库 | `src/channels/whatsapp/whatsapp-web-session.mjs:7,74,81` | `@whiskeysockets/baileys`；`useMultiFileAuthState`；`loadAuthState(authDir)` |
| 扫码 | 同上 `:161` | `onQr(update.qr)` |
| 群判定 | `src/channels/whatsapp/whatsapp-runtime.mjs:321` | `remoteJid.endsWith('@g.us')` |
| 是否"被点名" | 同上 `:355` | `addressed: !group || fromMe || mentioned || replyToSelf` |
| 访问模式 | `src/channels/whatsapp/config-store.mjs:12` | `self-only` / `private-allowlist` / `open` 三种 |
| 出站回声去重 | `src/channels/whatsapp/whatsapp-runtime.mjs:378`、`:787` | `RecentWhatsappOutboundIds` |
| 入站去重 | `src/channels/shared/text-harness-bridge.mjs:250` | `hasSeen(messageId)` |
| **缺口：发送侧无全局队列/限流** | 全仓库无实现 | 分片发送是顺序 await，没有账号级预算 |

也就是说：即使照抄 WhatsApp 的架构，P0 的五项控制依然要新写，不能继承。

### 2.4 官方微信渠道的单聊硬限制

| 事实 | 证据 |
| --- | --- |
| 目标类型校验只接受单聊用户 | `src/channels/weixin/weixin-runtime.mjs:409` `if (target?.kind !== 'user' \|\| !toUserId)` |
| 会话键写死 p2p | `src/channels/weixin/weixin-bridge.mjs:124` `return \`p2p:${userId}\`` |
| 入站强制 direct | 同上 `:393` `conversationType: 'direct'` |
| 上下文增强只支持私聊 | `docs/上下文增强.md:3`「微信当前只支持私聊」 |
| CDN 走 C2C | `src/channels/weixin/weixin-api.mjs:14`、`:174`、`:326` |
| 协议项无原生控件、能力受限 | `docs/方案/渠道原生能力建设方案.md:692`、`:785` |
| 渠道说明只承诺单聊行为 | `README.md:63` |

结论：群能力不是"加个开关"，而是"换一条接入通道"。

### 2.5 P0 五项控制的缺失结论（逐项）

| 控制 | 结论 | 证据 |
| --- | --- | --- |
| 发送预算/限频/配额 | **缺失** | 仅邮件渠道**读取**平台声明：`src/channels/email/transports/agent-mail.mjs:105,133`；`pollIntervalForLimits` 只管**读取**轮询（`src/channels/email/email-runtime.mjs:29`）；其余"限流"命中都是 429 文案 |
| 安静时段 | **缺失** | 全仓库无 quiet/dnd/时间窗发送抑制实现 |
| dry-run | **缺失** | 全仓库无 dry-run/预览发送实现 |
| 账号级持久暂停 | **缺失** | 只有 WhatsApp 的 typing presence `paused`（协议状态，不是持久配置） |
| 渠道侧原文落盘开关 | **缺失，且微信无条件落盘** | `src/channels/weixin/state-store.mjs:14` `recentOutboundMessages`；`:19` 文本上限 8000；TTL 30 天。共享存储只存 ID（`conversation-state-store.mjs:13`） |

### 2.6 发布与测试面（P1b 的验收门）

| 事实 | 证据 |
| --- | --- |
| 唯一质量门 | `package.json:99-103`：`build` / `test` / `check = build && test && verify-package` |
| 测试运行器 | 同上 `:101` `node --test test/*.test.mjs test/channels/*/*.test.mjs` |
| 无 lint / typecheck | 仓库无 eslint/prettier/tsconfig/biome 配置 |
| CI | `.github/workflows/ci.yml:28` `npm run check`；`:30` 另有 windows-workspaces 作业 |
| 无代码级渠道能力矩阵 | 唯一能力数组是飞书专用：`src/channels/feishu/multi-bot-controller.mjs:611` |

## 3. 本次改的 / 本次不动的

**本次改（新增）**
- `docs/方案/微信个人号群聊补充目标与计划.md`（对外交付物）
- `outputs/wechatbot-supplement/*.md`（本 run 工作产物与证据）

**本次不动**
- `src/`、`plugin-src/`：不改任何渠道、桥接、访问策略、投递代码
- `lib/`：不重新构建产物
- `README.md` / `README.en.md` / `CHANGELOG.md`：不声明任何新能力
- `docs/方案/渠道原生能力建设方案.md` 的九渠道能力基线表：不修改（当前版本为基线快照）
- 不创建 GitHub issue、不推送远端

**边界说明**：本计划写的是"目标与路线"，落地实现不在本 run 范围内。计划文档必须自证这一点，避免读者误认为能力已存在。

## 4. 未核验项（不得当作已确认）

1. **个人微信协议的可用性与封号风险**：仓库内没有任何第三方个人微信协议的接入代码或风险记录，无法从证据判断 Wechaty/Puppet 当前可用性。→ `未核验`
2. **Puppet 生态的许可、费用与维护状态**：外部事实，需单独核验后写入 WG 条目。→ `未核验`
3. **普通群未 @ 消息的可读性**：只能由 P1a 的真实实测回答。→ `未核验`
4. **iLink 服务端是否可能未来开放群能力**：腾讯未承诺，代码层无迹象。→ `未核验`
5. `plugin-src/host/channels/shared/production.mjs` 的通用控制器函数名：本次未逐行核验，仅作文件级证据。→ `文件级证据`

## 5. P1b 落地时的注册点清单（可执行 checklist）

新增渠道 `wechat-personal`（暂名）时需要：

1. 新增 `src/channels/wechat-personal/`：`config-store.mjs`、`state-store.mjs`、`harness-client.mjs`、`wechat-personal-bridge.mjs`、`wechat-personal-controller.mjs`、`wechat-personal-runtime.mjs`、传输层（sidecar 客户端）。
2. 新增 `plugin-src/host/channels/wechat-personal/`：`index.mjs`、`production.mjs`、`rpc.mjs`。
3. 新增 `plugin-src/client/channels/wechat-personal/`：`api.js`、`index.js`、`styles.js`。
4. 注册：`plugin-src/host/index.mjs:67`；`plugin-src/client/index.js:102`（列表、Logo、样式、设置页、rpcCall、panelDependencies 多处）。
5. 白名单补齐：`access-policy-production.mjs:48` 会拒绝未知渠道；`delivery-adapter.mjs:7`、`delivery-suggestions.mjs:1`、`diagnostic-details.mjs:92`、`context-enhancement.mjs:54`、`harness-approval.mjs:14`、`session-channel-labels.mjs:2`、`command-catalog.mjs:25`。
6. 客户端映射：`channel-logos.js:15`、`access-policy-settings.js:11,14`、`session-channel-logos.js:9`、`delivery-settings.js:46`。
7. 测试：`test/channels/wechat-personal/*.test.mjs` + `test/*.test.mjs` 跨渠道用例，门禁 `npm run check`。

## 6. 不可逆性与回滚

- **本次**：无不可逆操作，全部是可删的新增文件。
- **P1b**：协议接入放在独立 sidecar 进程中，插件侧只依赖本机接口。回滚方式＝移除注册项 + 停止 sidecar，其余 14 个渠道不受影响。这满足 `docs/adr/0001-semantic-core-native-channel-adapters.md` 的增量接管要求。
