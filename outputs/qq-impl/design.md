# 设计稿：QQ 群默认收紧（WG-QQ-01）与账号级持久暂停（WG-QQ-03）

- 工作单元：`design-impact`（模块 `design`）／技能 `change-impact`
- Vibe run：`vibe-linux-c2d4ed79c8d648d2`
- 性质：本 run 工作产物，不是 `docs/` 规范位置。对外交付物是代码改动本身。
- 决策依据：`docs/方案/QQ渠道群聊补充目标与计划.md`；用户确认 Q1(b)/Q2(a)/Q3(a)/Q4(b)/Q5(a)/**Q6(B)**。

## 0. 结论摘要

1. **默认值注入机制**：读取端**没有任何默认注入**——`accessPolicyFor(botId)` 只返回已存值或 `null`（`src/channels/shared/bot-workspace-store.mjs:548-553`）。默认只在 `ensure()` 里、且**仅当该 bot 的策略键不存在**时补种一次（`:714-715`，写入 `:729-762`）。
2. **两条种子路径**（QQ 都有，必须分别处理）：
   - 启动路径 `plugin-src/host/channels/qq/production.mjs:67-70` → `initialAccessPolicyFor('qq', bot)`；
   - 运行期新建 `:119-122` → `newBotAccessPolicyFor('qq', botConfig)`。
3. **legacy 判定依据是仓库既有语义**：`normalizeDocument` 已用 `value.accessPolicies === undefined` 区分 v1/v2（`:319-322`），`normalizeAccessPolicies(undefined)` 返回空表（`:227-229`）。因此"老文档"= 加载时文档没有 `accessPolicies` 段。
4. **关键时序约束**：legacy 标记必须**按加载时的文档冻结，写入后不得翻转**。否则同一批 N 个存量 bot 中，第一个补种写入 v2 段后，标记翻转会让其余 N−1 个拿到新默认（群被关闭）——那就变成 Q6(C) 了。
5. **其他渠道零影响**的保证：新增能力以**可选参数**形式提供，缺省行为与现状逐字相同。
6. **暂停落点**：走 `QQ config-store（持久）+ controller（读写/投影）+ runtime/bridge（L3/L4 闸门）+ RPC + 客户端控件` 的纵向切片，参照 Telegram `thinkingTraces` 样板；**不塞进 state-store**（那不在 RPC/UI 面上，且随 bot 删除被删、损坏恢复会重置）。

## 1. 访问策略种子机制（已复核，附行号）

| 事实 | 证据 |
| --- | --- |
| 读取无默认注入，只返回已存值或 `null` | `bot-workspace-store.mjs:548-553` |
| 种子唯一入口在 `ensure()`，且仅当键缺失 | `:712-718` |
| 补种会写盘并把文档版本抬到 ≥2 | `:741-750`（`nextVersion = Math.max(this.#version, DELIVERY_DOCUMENT_VERSION)`） |
| 正常加载才设置 `#accessPolicies` | `:440-450` |
| **ENOENT（全新安装）** 走另一支：版本置 1、策略为空表 | `:451-462` |
| 非 ENOENT 的损坏文档**直接抛出**（不会静默重置） | `:452` |
| v1/v2 判定语义（仓库既有） | `:319-322` |
| v1 文档 → 空策略表 → 每个 bot 都可补种 | `:227-229` |
| 损坏值走 `null` 且键存在 → fail-closed、**不会被补种** | `:231-244` |
| 两条 QQ 种子路径 | `plugin-src/host/channels/qq/production.mjs:67-70`、`:119-122` |
| QQ 现默认：initial 的 group 固定 `openScope()` | `plugin-src/host/channels/shared/access-policy-production.mjs:61-67`（group 在 `:65`） |
| QQ 现默认：newBot 的 direct/group 都 `openScope()`，且与 feishu 共用一条分支 | 同上 `:105-111`（group 在 `:108`） |

### 1.1 三类存量的实际后果（这是 Q6(B) 的依据）

| 存量类型 | 机制后果 | 目标行为 |
| --- | --- | --- |
| 已有策略条目（在含策略功能的版本上启动过） | 键存在 → 永不重算 | **保持原样**（含 `group.mode='open'`） |
| 老文档（无 `accessPolicies` 段）+ 无条目 | 首次升级启动即被补种 | **按旧默认回填（群开放）**，升级不改变其群行为 |
| 现代文档 + 无条目（如手工加进 `config.json` 的新 bot） | 首次启动补种 | **按新默认（群关闭）** |
| 全新安装（workspaces.json 不存在） | ENOENT 支：空策略表 | **按新默认（群关闭）** |

> owner 旁路：`privilegedSenderIdsFor('qq')` = `ownerUserOpenid`（`access-policy-production.mjs:113-115、123`），在 `inbound-access.mjs:24-27` 先于策略判定放行。所以"群关闭"= **群内只有 owner 可触发**，不是整体宕机。

## 2. 实现方案 A：WG-QQ-01 群默认收紧

### 2.1 store 侧（`src/channels/shared/bot-workspace-store.mjs`）

1. `normalizeDocument` 额外返回一个**只读**标记：`legacyAccessPolicyDocument: value.accessPolicies === undefined`（与 `:319-322` 用的是同一个判据）。
2. 新增私有字段 `#legacyAccessPolicyDocument = false`；在 `load()` 成功分支按 `normalized.legacyAccessPolicyDocument` 赋值；**ENOENT 分支保持 `false`**（全新安装 = 现代文档 → 新默认）。
3. `ensure(botId, { …, initialAccessPolicy, legacyInitialAccessPolicy })` 新增**可选**参数：
   ```js
   const seedPolicy = this.#legacyAccessPolicyDocument && legacyInitialAccessPolicy !== undefined
     ? legacyInitialAccessPolicy
     : initialAccessPolicy;
   const initializesAccessPolicy = seedPolicy !== undefined && !Object.hasOwn(this.#accessPolicies, id);
   ```
   其余逻辑不变（`validateAccessPolicy(seedPolicy)`、写盘、版本抬升）。
4. **`#legacyAccessPolicyDocument` 在任何写入后都不得翻转**（见摘要第 4 条）。它是"本次加载的文档形态"，不是"当前文档形态"。

**其他渠道零影响论证**：不传 `legacyInitialAccessPolicy` 的调用方，`seedPolicy === initialAccessPolicy`，与现状逐字等价；标记字段只被读取、不参与序列化。

### 2.2 策略侧（`plugin-src/host/channels/shared/access-policy-production.mjs`）

1. `initialAccessPolicyFor(channel, config = {}, { legacy = false } = {})`：qq 分支保持 `direct` 逻辑不变；`group` 改为 `legacy ? openScope() : allowlistScope()`。
   - 默认 `legacy = false`，其余渠道与该函数其他分支**完全不受影响**。
2. `newBotAccessPolicyFor(channel, config = {})`：把 `feishu || qq` 拆开——**feishu 保持** `{direct: openScope(), group: openScope()}`；qq 改为 `{direct: openScope(), group: allowlistScope()}`。
   - 注意：`direct` 仍为 open，与 Q2 的范围（只收紧**群**）一致。
3. `allowlistScope()` 默认 `defaultCanExecuteCommands: false`（`access-policy.mjs:128-136`），满足"群内命令默认只有 owner 可执行"。

### 2.3 QQ 接线（`plugin-src/host/channels/qq/production.mjs`）

启动路径（`:67-70`）改为同时提供两种种子：

```js
initialAccessPolicy: initialAccessPolicyFor('qq', bot),
legacyInitialAccessPolicy: initialAccessPolicyFor('qq', bot, { legacy: true }),
```

运行期新建（`:119-122`）保持使用 `newBotAccessPolicyFor('qq', botConfig)`（新 bot 一律新默认）。

### 2.4 验收断言（对应计划标准）

| 标准 | 断言 |
| --- | --- |
| `new-bot-group-closed` | 现代文档 / 全新安装下，新连接与运行期新建的 QQ bot：`group.mode === 'allowlist'`、`users` 为空、`defaultCanExecuteCommands === false` |
| `saved-policies-untouched` | 预置 `group.mode === 'open'` 的存量条目，启动后读回仍为 `open`，且文档内容未被重写 |
| `legacy-docs-backfilled-open` | 无 `accessPolicies` 段的 v1 文档 + 两个 bot：启动后**两个** bot 的 group 均为 `open`（不是只有第一个） |
| `other-channels-unchanged` | `newBotAccessPolicyFor('feishu')` 仍为 direct/group 双 open；其他渠道 `initialAccessPolicyFor` 输出与改动前一致 |

## 3. 实现方案 B：WG-QQ-03 账号级持久暂停

### 3.1 语义边界（不得放宽）

| 层 | 位置 | 暂停时 |
| --- | --- | --- |
| L1 入站 | `qq-bridge.mjs:509-545` 授权与 `#process` | **照常**（否则 `/stop` 与审批也失效） |
| L2 被动回复 | `qq-bridge.mjs:707` 的 `send`、命令回执、审批提示、`/menu` | **照常发送** |
| L3 主动投递 | `plugin-src/host/delivery-adapter.mjs`（含 `qq`）→ `qq-runtime.mjs:406` `sendProactiveText` | **拦下**（本地不尝试） |
| L4 后台补发 | `qq-bridge.mjs:740-741` `#deliverDeferredOutcome` | **拦下且保持 `pending`、不消耗 `attempts`** |

`attempts` 约束依据：`src/channels/shared/deferred-delivery.mjs:157`（`attempts >= 3` 即 `failed`）；`deliveryOutcome: 'unknown'`（`deferred-delivery-coordinator.mjs:172`）是"平台结果未知、不自动重试"，与"本地未尝试"是两件事，**不得混用**。

### 3.2 落点（参照 Telegram `thinkingTraces` 样板）

| 环节 | 文件 | 参照 |
| --- | --- | --- |
| 持久化 | `src/channels/qq/config-store.mjs`（bot 记录新增可选布尔字段） | `src/channels/telegram/config-store.mjs:50-66` |
| 控制器读写 | `src/channels/qq/qq-controller.mjs`（setter + status 投影） | `telegram-controller.mjs:47-52`、`:34-36` |
| 运行时闸门 | `src/channels/qq/qq-runtime.mjs`（L3）、`src/channels/qq/qq-bridge.mjs`（L4） | — |
| RPC | `plugin-src/host/channels/qq/rpc.mjs` + 必要时 `plugin-src/host/channels/shared/*-rpc.mjs` | `shared/thinking-traces-rpc.mjs:1-11`、`shared/rpc.mjs:213-215` |
| 客户端 | `plugin-src/client/channels/qq/api.js`、`plugin-src/client/channels/qq/index.js` | `client/channels/telegram/thinking-traces.js:8-24` |

**硬要求**：默认值必须是"未暂停"（不改变现状）；暂停状态**持久化**、重启后仍生效；恢复必须显式操作；RPC 响应不得新增任何 secret/令牌/原始标识。

## 4. 会改 / 不会改

**会改（4 个单元、写入范围两两不重叠）**
- `plugin-src/host/channels/shared/access-policy-production.mjs`、`src/channels/shared/bot-workspace-store.mjs`、`test/channels/qq/access-policy-default.test.mjs`
- `src/channels/qq/`、`plugin-src/host/channels/qq/`、`plugin-src/client/channels/qq/`、`test/channels/qq/account-pause.test.mjs`
- 产物：`outputs/qq-impl/design.md`、`outputs/qq-impl/verification-report.md`

**装配阶段补做的改动（design 定稿时未预见，逐条列出以便 `diff-scope-honest` 对照）**

| 文件 | 原因 |
| --- | --- |
| `plugin-src/host/channels/qq/production.mjs` | §2.3 要求的接线：启动路径补传 `legacyInitialAccessPolicy`。原计划把它算在策略单元，但该文件落在暂停单元范围，为避免两个单元并行写同一文件，改由装配阶段补做 |
| `src/channels/shared/deferred-delivery-coordinator.mjs` | 追加单元的实现者按预授权例外修改：新增 `deferredNotAttempted()` / `DEFERRED_NOT_ATTEMPTED`，并让协调器在该 code 下返回 `'waiting'`（保持 `pending`、不计 `attempts`、不重排）。这是 L4 冻结语义的唯一实现点 |
| `test/access-policy-host.test.mjs` | 默认值变更的既有基线断言必须更新（QQ 群由 open 改为 allowlist），并补充 `legacy: true` 的旧默认覆盖 |
| `test/channels/shared/new-bot-access-policy.test.mjs` | 同上：`freshBot`/`manualBot` 两块按渠道拆分期望（feishu 不变、QQ 群关闭）；用例名改为准确表述 |
| `src/channels/shared/i18n-en/qq.mjs`、`plugin-src/client/i18n.js` | 新增中文串的英文投影：`t('QQ 机器人已暂停，已跳过主动投递。')` 与客户端两条暂停文案。仓库有强制校验（`test/channels/shared/i18n.test.mjs`、`test/client-ui.test.mjs`），缺投影即失败 |
| `scripts/verify-package.mjs` | **登记新的可校验输入**：该脚本强制配额（客户端 bundle 恰好 2 个 `role:'switch'` + 5 个 `type:'checkbox'`，已知文件之外不得出现开关/复选框）。QQ 暂停块新增 1 个 checkbox，故把 `plugin-src/client/channels/qq/index.js` 加入已知清单、配额 5→6，并更新注释与错误文案——这是仓库要求"新增输入必须显式登记"的机制，不是绕过 |
| `lib/client.js`、`lib/index.js` | **构建产物**：`npm run build` 由 `plugin-src/` 重新生成。源码变更后这两个受版本控制的产物必须同步更新，diff 属预期 |

> 基线更新属于"默认值变更的必然配套"，不是放宽断言：`no-other-channel-regression` 仍要求 feishu 与其他渠道行为不变。

**不会改**
- 其他 13 个渠道的任何文件（含 `feishu` 的种子行为）
- `lib/`（构建产物由 `npm run build` 重写但内容应逐字节不变，验收需确认）
- `README*`、`CHANGELOG.md`、`docs/方案/` 下的既有文档（含已冻结的两份微信文档与 QQ 计划）
- `package.json` 依赖（不引入第三方依赖）

## 5. 回滚

- WG-QQ-01：把 `initialAccessPolicyFor` 的 qq group 分支与 `newBotAccessPolicyFor` 的 qq 分支恢复为 `openScope()`，并移除 `legacyInitialAccessPolicy` 传参即可；已补种到用户磁盘的策略**不会**自动回滚（属用户数据），需要用户通过访问设置面板自行改回。
- WG-QQ-03：删字段 + 移除闸门；持久化值留在配置文件里不影响行为（读到未使用字段）。
- 两者都不涉及数据迁移，回滚不需要重写用户文件。

## 6. 未核验项（不得当作已确认）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 现网有多少 QQ bot 已存在持久策略条目（决定 legacy 回填实际触达范围） | `未核验`（依赖部署历史，代码无法断言） |
| 2 | `workspaces.json` 之外的部署方式是否会绕过 `BotWorkspaceStore` | `未核验` |
| 3 | 暂停期间 L4 冻结的具体实现点（协调器的重排时机）需在实现时以其现有契约为准确认 | `未核验`（实现单元负责落地并测试） |
| 4 | 客户端控件在既有 QQ 卡片上的确切挂载位置 | `未核验`（实现单元按 `thinkingTraces` 样板落位） |
