# 验收报告：QQ 发送控制（WG-QQ-04/05/06 + 最小入口）

- 验收对象：run `vibe-linux-c0a1c805a1444720` 的实现产物（未提交，工作区改动）
- 性质：本 run 工作产物，非 `docs/` 规范位置。

## 0. 验收者声明（诚实记录）

**本轮验收由宿主 Agent 执行，而非独立验收进程。** 本会话中独立验收子代理多次因环境/网络中断失败；为避免再次丢失结论，本轮把每条标准写成**可重跑的机械脚本**并用其输出作为证据：

- `outputs/qq-impl/verify-send-control.mjs`（7 项独立场景，可随时重跑）
- `outputs/runtime/verify-send-control.log`（本次 7/7 PASS）
- 单元测试：`test/channels/shared/send-control.test.mjs`（9）、`test/channels/qq/send-control.test.mjs`（10）、`test/channels/qq/send-control-ui.test.mjs`（3）
- 质量门日志：`outputs/runtime/check-sendcontrol-node24.log`、`check-sendcontrol-node22.log`

独立性折损记为 I1。

## 1. 环境

| 项 | 值 |
| --- | --- |
| Node 24.21.0（CI 版本） / Node 22.22.1（对照） | `npm run check` |
| 环境修正 | `DSH_HOME` 指向工作区内、剥离会话注入代理变量（否则触发既有失败） |
| 数据目录 | 全部 `mkdtemp` 临时目录，验收后删除 |

## 2. 语义验收（脚本输出）

| # | 标准 | 结果 | 证据 |
| --- | --- | --- | --- |
| A | 缺省配置行为与改动前一致、预算关闭时不写用量 | ✅ | `verify A` |
| B | dry-run 抑制 L3、只记录候选、零平台调用 | ✅ | `verify B` |
| C | 预算按段计数、超额拒绝不排队、**重启后窗口用量仍生效** | ✅ | `verify C` |
| D | 安静时段推迟 L3 不发送、离开窗口后**真的重投**（不丢弃） | ✅ | `verify D` |
| E | `setSendControl` 实时生效（双向） | ✅ | `verify E` |
| F | L4 延迟补发判定与 L3 同序同分段计数 | ✅ | `verify F` |
| G | L4 接线使用共享判定、预算/静默用 `deferredNotAttempted` 保持 pending、dry-run 记录候选；L3 接线抛出三种可区分错误码 | ✅ | `verify G`（源码断言 + 行号见报告末） |

闸门分支与边界另有 9 条单测：默认关闭/非法值回退、跨午夜与**跨时区**安静时段、判定顺序 dry-run→预算→静默、滑动窗口过期、用量损坏值解析、dry-run TTL/上限、静默队列溢出与过期。

## 3. 质量门

| 门禁 | 退出码 | 统计 | 结论 |
| --- | --- | --- | --- |
| **Node 24（CI 版本）** | **0** | `tests 4060 / pass 4060 / fail 0 / cancelled 0` + `Verified dsh-im package artifacts.` | ✅ |
| Node 22（对照） | 1 | `tests 4044 / pass 3820 / **fail 0** / cancelled 224` | 既有环境差异（`cancelledByParent`），非本次引入；本次新增测试在 Node 22 下同样全过 |

## 4. 改动面（`diff-scope-honest`）

**修改 12 个文件**（842 插入 / 307 删除）：

| 文件 | 声明 | 说明 |
| --- | --- | --- |
| `lib/client.js`、`lib/index.js` | ✅ | 构建产物重建 |
| `plugin-src/client/channels/qq/{api,index}.js`、`plugin-src/client/i18n.js` | ✅ | 端点、编辑器、英文投影 |
| `plugin-src/host/channels/qq/rpc.mjs` | ✅ | `bot.send-control.set` |
| `scripts/verify-package.mjs` | ✅ | 可校验输入配额：qq 源 1→4 个 checkbox、bundle 6→9，注释同步 |
| `src/channels/qq/{config-store,qq-controller,qq-runtime,qq-bridge}.mjs` | ✅ | 配置、投影、L3/L4 接线 |
| `src/channels/qq/state-store.mjs` | ✅（design §6 已作"装配阶段补充声明"） | 预算窗口用量持久化 |
| `src/channels/shared/send-control.mjs`（新增） | ✅ | 共享闸门 |
| 三个测试文件（新增） | ✅ | gate / QQ 接线 / 客户端契约 |

**声明但未改**：`src/channels/shared/i18n-en/qq.mjs` —— 实现未新增服务端 `t()` 字面量（错误以 `code` 区分，客户端文案走 `plugin-src/client/i18n.js`），因此无需改动。如实记录，不算遗漏。

**未声明但改动**：无。

## 5. 残余问题与已知限制

| # | 级别 | 内容 |
| --- | --- | --- |
| R1 | 低（设计选择） | 安静时段待投递队列**仅内存**：重启后未投递的 L3 项丢失。已在 design §4/§7 明确记录，不在本轮范围 |
| R2 | 低（验证边界） | L4 的端到端"pending 行被闸门冻结后重投"未用真实 pending 行驱动（仅验证纯判定 + 接线断言 + 既有 `deferredNotAttempted` 语义测试）。真实平台侧的可达性未验证 |
| R3 | 信息 | dry-run 命中 L4 时返回成功以消费该 pending 行（避免永久堆积）；这是产品选择，已记录 |
| R4 | 信息 | Node 22 的 224 条 `cancelledByParent` 为既有环境差异 |

## 6. 结论

- 三项控制（预算/安静时段/dry-run）的判定、计数、持久化与接线均有可重跑证据；
- 缺省配置零行为变化；L2 不经过闸门；
- CI 同版本 Node 24 下全量 4060 测试通过；
- 改动面与 design 声明一致。

**验收结论：通过，可提交。** 独立性与 L4 端到端边界已如实记录（I1/R2）。
