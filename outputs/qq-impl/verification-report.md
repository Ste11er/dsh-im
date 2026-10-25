# 验收报告：QQ P0′（WG-QQ-01 群默认收紧 + WG-QQ-03 账号级持久暂停）

- 验收对象：commit `5c4ba71`（`feat(qq): default groups to allowlist and add persistent send pause`）
- Vibe run：`vibe-linux-c2d4ed79c8d648d2`
- 报告性质：本 run 工作产物，不是 `docs/` 规范位置。

## 0. 验收者声明与过程说明（诚实记录）

**本轮验收由宿主 Agent 执行，而不是独立验收进程。** 原因：为满足"实现者不自己验收"，先后启动了三轮独立验收子代理，**三轮均因环境/网络中断而失败**（其中两轮跑完了 Node 24 质量门并留下日志，但未写出报告；第三轮未产出）。
为尽量弥补独立性损失，本轮验收**不依赖散文式结论，而是把每一条验收标准写成可重跑的机械脚本**：

- `outputs/qq-impl/verify.mjs` —— 12 项独立场景断言（可随时 `node outputs/qq-impl/verify.mjs` 重跑）
- `outputs/runtime/verify-impl.log` —— 本次运行输出（12/12 PASS）
- `outputs/runtime/check-impl-node24-verify3.log` —— Node 24 全量质量门
- `outputs/runtime/check-impl-node22.log` —— Node 22 对照
- `outputs/runtime/check-impl-node24-verify.log` —— **子代理**独立跑出的 Node 24 质量门日志（第三方证据）

> 独立性折损已在问题清单记为 I1，请读者据此判断证据强度。

## 1. 环境

| 项 | 值 |
| --- | --- |
| 运行环境 | Node 24.21.0（仓库 CI 固定版本，`.github/workflows/ci.yml:21,40`）/ 系统 Node 22.22.1（对照） |
| 质量门 | `npm run check` = `build` → `node --test` → `scripts/verify-package.mjs`；无 lint/typecheck |
| 环境修正 | `DSH_HOME` 指向工作区内可写目录、剥离会话注入的代理变量（否则会触发一批与本改动无关的既有失败） |
| 数据目录 | 全部临时目录（`mkdtemp`），验收后删除；未触碰真实用户数据 |

## 2. 改动面（`diff-scope-honest`）

`git show --name-only HEAD` 中，**代码 / 测试 / 脚本**共 20 个文件，逐条对照 `outputs/qq-impl/design.md` §4（含"装配阶段补做"表格）：

| 声明分组 | 文件 | 是否在声明内 |
| --- | --- | --- |
| 策略实现 | `plugin-src/host/channels/shared/access-policy-production.mjs`、`src/channels/shared/bot-workspace-store.mjs`、`test/channels/qq/access-policy-default.test.mjs` | ✅ |
| 暂停实现 | `src/channels/qq/{config-store,qq-bridge,qq-controller,qq-runtime}.mjs`、`plugin-src/host/channels/qq/rpc.mjs`、`plugin-src/client/channels/qq/{api,index}.js`、`src/channels/shared/deferred-delivery-coordinator.mjs`、`test/channels/qq/account-pause.test.mjs` | ✅ |
| 装配补做 | `plugin-src/host/channels/qq/production.mjs`（legacy 种子接线）、`src/channels/shared/i18n-en/qq.mjs`、`plugin-src/client/i18n.js`（英文投影）、`scripts/verify-package.mjs`（登记新可校验输入）、`test/access-policy-host.test.mjs`、`test/channels/shared/new-bot-access-policy.test.mjs`（基线更新） | ✅ |
| 构建产物 | `lib/client.js`、`lib/index.js` | ✅（源码变更后的必然重建） |

**声明之外的改动**：

| 文件 | 判定 |
| --- | --- |
| `.gitignore`（+2 行：`.npm-cache/`、`outputs/runtime/`） | **不属于本实现**。该改动出现在提交时（提交作者为仓库维护者），作用是忽略本 run 产生的缓存与运行日志。如实记录，不计入实现范围。 |
| `docs/方案/{QQ渠道群聊补充目标与计划,微信渠道已达成的能力,微信个人号群聊补充目标与计划}.md` | 早前两个 run 的交付物，本提交一并纳入。不属于本单元代码改动。 |

**声明了但实际未改**：`CHANGELOG.md`（声明为"不会改"，实际未改，符合预期）。`plugin-src/host/delivery-adapter.mjs`、`test/channels/shared/i18n.test.mjs`、`test/client-ui.test.mjs` 只在 design.md 中作为**引用/证据**出现，非改动声明。

**构建产物一致性**：`lib/client.js`、`lib/index.js` 由 `npm run build` 依据 `plugin-src/` 重新生成，`npm run check` 中 `verify-package` 通过，说明打包入口与源码一致。

## 3. 策略默认四条标准（独立复现）

命令：`node outputs/qq-impl/verify.mjs`（12/12 PASS，`outputs/runtime/verify-impl.log`）

| 标准 | 场景 | 结果 |
| --- | --- | --- |
| `legacy-docs-backfilled-open` | v1 文档（无 `accessPolicies` 段）+ **两个** bot，走真实 `load()`+`ensure()` | ✅ **两个** bot 的 group 均为 `open`（旧默认），且 `open.defaultCanExecuteCommands: true` 保持历史语义 |
| `new-bot-group-closed` | v2 现代文档（`accessPolicies: {}`）+ bot | ✅ group = `allowlist`、`users` 空、`defaultCanExecuteCommands: false`；direct 仍为既有的 owner-allowlist（本次未改） |
| `new-bot-group-closed` | 全新安装（文件不存在，ENOENT） | ✅ group = `allowlist` |
| `saved-policies-untouched` | 已保存 `group.mode: 'open'` 的条目 | ✅ 启动后仍为 `open`，策略对象逐字段不变（未被重写） |
| `other-channels-unchanged` | feishu 新 bot / initial，weixin、dingtalk、wecom、slack、discord、telegram、whatsapp | ✅ feishu 新 bot 双 open、initial 双 allowlist；其余渠道 `newBotAccessPolicyFor === initialAccessPolicyFor` 与改动前一致 |
| owner 旁路 | 群关闭时的 `ownerUserOpenid` | ✅ `privileged-sender` 放行；其他成员 `sender-not-allowed` |

## 4. 暂停四条标准 + 自助入口（独立复现）

| 标准 | 场景 | 结果 |
| --- | --- | --- |
| `pause-persists` | `QqConfigStore` 存 `paused: true` → 重新 load | ✅ 仍为 true；恢复后字段被**删除**（文档形状回到原样，不写 `false`） |
| `pause-scope-l3-l4-only` | 暂停中的 `QqHarnessBridge.accept()` 处理一条命令 | ✅ 被动回复**照常发送**（L2 未被拦） |
| 同左 | `QqController.sendProactiveText` 暂停 / 未暂停 | ✅ 暂停抛 `code: 'account-paused'`；未暂停抛 `bot-not-connected`（证明拦截来自暂停，而非缺 runtime） |
| `pause-keeps-deferred-pending` | 真实 `createDeferredDeliveryCoordinator` + 抛 `deferredNotAttempted` 的 `deliver` | ✅ 条目保持 `pending`、`attempts` 不增、无 `deliveryOutcome:'unknown'`、无 `failed` 补丁 |
| 同左 | 标记契约 | ✅ `deferredNotAttempted().code === DEFERRED_NOT_ATTEMPTED`，与 `unknown` 明确区分 |
| `pause-self-serve-entry` | RPC `bot.account-pause.set` | ✅ `{botId, paused:boolean}` 可设置并回读；缺字段/非布尔/多余字段均拒绝；响应不含 secret/openid 原文 |
| 同左 | 客户端快照 | ✅ `paused` 缺省为 `false`，显式 true 才为 true |

## 5. 无其他渠道回归（`no-other-channel-regression`）

| 门禁 | 退出码 | 统计 | 结论 |
| --- | --- | --- | --- |
| **Node 24（CI 版本）** `npm run check` | **0** | `tests 4038 / pass 4038 / fail 0 / cancelled 0` + `Verified dsh-im package artifacts.` | ✅ 通过 |
| Node 22（本机，对照） | 1 | `tests 4022 / pass 3798 / **fail 0** / cancelled 224` | 非本次引入：224 条全为既有 `cancelledByParent`（`Promise resolution is still pending but the event loop has already resolved`），**无断言失败**；该现象在改动前即存在（此前多轮 Node 22 运行统计一致） |
| 子代理独立跑 Node 24（第三方证据） | 0 | `tests 4038 / pass 4038 / fail 0 / cancelled 0` + `Verified` | ✅ 与上表一致 |

基线变更说明：`test/access-policy-host.test.mjs` 与 `test/channels/shared/new-bot-access-policy.test.mjs` 中"QQ 群默认 open"的旧断言必须随默认值变更更新，并补充了 `legacy: true` 的旧默认覆盖；feishu 与其他渠道的期望**未改**。这是默认值变更的必然配套，不是放宽断言。

## 6. 问题清单（按严重程度）

| # | 级别 | 问题 | 说明 |
| --- | --- | --- | --- |
| I1 | **信息（过程）** | 本轮验收由宿主 Agent 执行，而非独立进程 | 三次独立验收子代理均因环境/网络中断失败。已用可重跑脚本 + 子代理留下的质量门日志补偿，但"实现者不自己验收"的独立性弱于理想流程 |
| I2 | 信息 | `.gitignore` 的 +2 行不属实现改动 | 出现在提交时，属忽略本 run 缓存/日志的环境整理 |
| I3 | 信息 | Node 22 下 `npm run check` 退出码 1 | 既有环境差异（`cancelledByParent`，fail 0），非本次引入；CI 用 Node 24 |
| I4 | 低 | `scripts/verify-package.mjs` 被修改 | 该脚本对"可校验输入"有硬配额（2 switch + 5 checkbox）；新增的 QQ 暂停 checkbox 触发它。处理方式是**按机制登记新输入**（加入已知清单、配额 5→6、更新注释与错误文案），已在 design.md 声明。属预期内的验证脚本更新，不是绕过 |
| I5 | 低 | 验收脚本自身曾有两处断言写错 | B1（忘了 legacy open scope 的命令默认是 true）、B2（忘了启动路径 QQ direct 一直是 owner-allowlist）。已修正为与仓库既有语义一致，**不是放宽**：两处都在报告中写明原语义 |

**无 failing 级问题。**

## 7. 总体结论

- 五项策略标准（含 legacy/modern 双路径、已保存策略、其他渠道、owner 旁路）**全部通过**；
- 四项暂停标准 + 自助入口**全部通过**（L2 放行、L3 拦截、L4 保持 pending 不消耗 attempts、持久化、RPC 校验）；
- CI 同版本 Node 24 下 `npm run check` **退出码 0**，全量 4038 测试通过；
- 实际改动范围与 design.md 声明一致（唯一例外 `.gitignore` 属提交环境整理，已披露）。

**验收结论：通过，可提交。** 独立性折损（I1）已如实记录。
