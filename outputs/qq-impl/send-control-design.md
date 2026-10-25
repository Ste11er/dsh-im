# 设计稿：QQ 发送控制（WG-QQ-04/05/06）

- 单元：`design-send-control`（技能 `change-impact`）；run `vibe-linux-c0a1c805a1444720`
- 决策来源：用户确认 Q1–Q5（范围/预算/安静时段/配置落点/dry-run）
- 性质：本 run 工作产物，非 `docs/` 规范位置。

## 1. 落点（已核验行号）

| 层 | 位置 | 现状 | 本次 |
| --- | --- | --- | --- |
| 暂停（最高优先级） | `src/channels/qq/qq-controller.mjs:302-306`（L3）、`src/channels/qq/qq-bridge.mjs:760-766`（L4） | 已实现，抛 `account-paused` / `deferredNotAttempted` | **保持不变**，排在闸门之前 |
| **L3 主动投递** | `qq-controller.mjs:299-315` `sendProactiveText` → `qq-runtime.mjs` `sendProactiveText` | 无预算/静默/dry-run | 暂停检查后接入闸门 |
| **L4 后台补发** | `qq-bridge.mjs:758-770` `#deliverDeferredOutcome` | 暂停检查后直接 `sendMarkdownReply` | 暂停检查后接入闸门 |
| 分段计数依据 | `src/channels/qq/markdown-reply.mjs:45-51`：`chunkMarkdownParts(text)` → `chunks.length` 即实际发送段数；被动回复受 `c2c 4 / group 5` 上限约束 | — | 预算按 `chunks.length` 计 |

L2 被动回复（`qq-bridge.mjs:707` 的 `send`、命令回执、审批提示、`/menu`）**不经过**闸门。

## 2. 判定顺序（固定）

```
账号暂停 → dry-run → 预算 → 安静时段 → 真实发送
```
暂停仍在 L3/L4 各自的最前面（已实现）；共享闸门负责 dry-run/预算/安静时段三段。

## 3. 共享模块 API（`src/channels/shared/send-control.mjs`）

- `DEFAULT_SEND_CONTROL` / `normalizeSendControl(value)`：缺省字段 = 默认关闭；非法值回退默认，不抛错。
- `evaluateSendGate({ config, usage, now, segments })` → `{ action: 'allow' | 'dry-run' | 'deny-budget' | 'defer-quiet', reason }`
  - `usage = { events: [{ at, segments }] }`（滑动窗口）
  - 判定：dry-run 开启 → `dry-run`；预算开启且窗口内 `sum(segments)+segments > limit` → `deny-budget`；安静时段开启且当前时刻在窗口内 → `defer-quiet`；否则 `allow`。
- `recordSendUsage(usage, { now, segments, windowMs })`：追加并裁剪窗口外事件（有界，最多保留 `limit+1` 条）。
- `isWithinQuietHours(now, quietHours, { timeZone })`：支持跨午夜窗口；时区取自 `quietHours.timezone`，缺省 Host 本地。
- `createDryRunRecorder({ ttlMs = 600_000, max = 200 })`：`record()`/`list()`/`size()`；仅内存。
- `createQuietQueue({ maxPerKey = 20, ttlMs = 6 * 3600_000 })`：`enqueue(key, item)`/`takeDue(key, now)`/`size(key)`；超出上限或过期丢弃并返回告警计数；仅内存（重启丢失，已记录为限制）。
- `parseSendControlUsage(value)`：从状态存储恢复。

## 4. 配置形状与持久化

QQ `config-store` 的 bot 记录新增可选字段：

```js
sendControl: {
  budget: { enabled: false, windowMs: 600000, limit: 50 },
  quietHours: { enabled: false, start: '23:00', end: '08:00', timezone: null },
  dryRun: { enabled: false },
}
```

- 缺省 = 全关闭 → 行为与改动前逐字一致。
- **预算窗口计数**持久化到 QQ `state-store` 的新字段 `sendControlUsage`（`{ events: [{ at, segments }] }`），启动时恢复；避免重启放宽额度。
- 安静时段待投递队列与 dry-run 候选**仅内存**（待投递重启丢失；dry-run 本就无需持久）。
- 保存入口：`QqConfigStore.save()` 已按整条 bot 记录落盘，`sendControl` 作为普通字段随记录保存。

## 5. 与既有语义的交互

- **安静时段 × 延迟补发**：L4 命中 → 抛 `deferredNotAttempted`（既有机制）→ 协调器保持 `pending`、**不消耗 `attempts`**、不重排；安静结束后由恢复定时器调用 `deferred.resume()`（与 `setPaused(false)` 同一机制，`qq-bridge.mjs` 已有 `resume()` 用法）。
- **安静时段 × L3**：入内存队列（上限 20/会话、6 小时过期），由运行时定时器（30s，`unref`）在窗口结束后重投；重投前重新过闸门（预算/dry-run/暂停仍生效）。
- **预算耗尽**：L3 直接失败（可区分 `code: 'send-budget-exhausted'`），不排队补发；L4 抛 `deferredNotAttempted`（保持 pending，不消耗 attempts）。
- **dry-run**：L3 记录候选后抛 `code: 'send-dry-run'`（不产生平台调用）；L4 记录候选后返回成功（消费该条 pending，避免永久堆积）。均不拦 L2。
- **暂停**：仍为最高优先级，语义不变。

## 6. 会改 / 不会改

**会改**
- 新增 `src/channels/shared/send-control.mjs`、`test/channels/shared/send-control.test.mjs`
- `src/channels/qq/{config-store,qq-controller,qq-runtime,qq-bridge,state-store}.mjs`、`test/channels/qq/send-control.test.mjs`
- `src/channels/shared/i18n-en/qq.mjs`（服务端文案）
- `plugin-src/host/channels/qq/rpc.mjs`、`plugin-src/client/channels/qq/{api,index}.js`、`plugin-src/client/i18n.js`、`scripts/verify-package.mjs`、`test/channels/qq/send-control-ui.test.mjs`
- 构建产物 `lib/client.js`、`lib/index.js`（源码变更后重建）

**不会改**：其他渠道任何文件；README/CHANGELOG；`docs/` 既有文档。

> 说明：计划里 `wire-qq-gate` 的写入范围未显式列 `state-store.mjs`，但预算计数持久化必须落在这里；作为执行所有者按"装配阶段补充声明"处理，并会记入验收报告。

## 7. 未核验项

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 安静时段队列在重启后的语义（设计选择：重启丢失） | 已定策略，非缺陷 |
| 2 | iLink/QQ 平台对主动消息的额度与静默重投的可达性 | `未核验`（平台侧） |
| 3 | 客户端控件在 QQ 卡片中的最终样式 | 实现时按 `thinkingTraces` 样板落位 |
