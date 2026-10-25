# WG-QQ-11 实现与验收记录

日期：2026-10-23。基于已有工作区的 QQ 发送控制实现继续开发，保留原有未提交改动。本次未提交 Git、未推送、未启用真实账号开关。

后续状态：用户随后要求本机部署，已完成安装、真实 QQ 连接和开关启用；见[部署记录](wg-qq-11-deployment.md)。以下仍是实现阶段的离线验收证据，不将部署启动等同于真实模型功能验收。

用户验收补充（2026-10-23）：部署并提供群聊测试步骤后，用户明确反馈「测试没有问题」。本轮用户实测通过，WG-QQ-11 完成；性能与费用不据此视为已测量。

## 目标与影响面

来源：[QQ 群聊补充计划 WG-QQ-11](../../docs/方案/QQ渠道群聊补充目标与计划.md)。平台输入依据为已有[真实接入记录 §6](../qq-integration/access-test-report.md)，只对该受测机器人成立。

本次改动闭合 QQ mention 分类 → bridge 入站/Prompt → runtime → config/controller → host RPC → client 快照/面板/英文文案，并重建 `lib/client.js`、`lib/index.js`。新增 `src/channels/qq/group-context.mjs` 承载缓存与限制。包校验精确增加一个 QQ checkbox；共享桥接层、共享访问策略、平台 SDK 和依赖均未修改。使用文档与中英文 README 已同步。

配置新增可选 `groupContextEnabled` 布尔值，缺省关闭，只有 `true` 写入；不迁移旧机器人、不写入群消息正文。RPC 新增 `bot.group-context.set`，前后端同名，严格校验布尔参数与字段。关闭即清空，旧排队快照失效；回退到 @模式只需关闭开关。重启恢复开关但不恢复正文。回退到旧版本前可先关闭开关，无数据迁移或正文恢复步骤。

## 功能证据

| 保证 | 自动化证据 |
| --- | --- |
| 默认 @模式，未开启不记背景，@问答正常 | `group-context.test.mjs` 默认用例；既有 `mention.test.mjs`、QQ 测试和全量回归 |
| 开启后未 @ 零模型调用、零 QQ 发送，不执行 `/new`，不下载附件 | `group-context.test.mjs` 收集用例：入站后直接断言调用、发送、会话创建均为 0；后续 @ 的实际 Harness 替身参数含背景 |
| 访问策略拒绝静默；未 @ 命令作为普通数据 | 同文件访问策略用例：拒绝正文不进 Prompt，`/stop` 只入数据，拒绝计数可见 |
| `group:groupOpenid`、私聊隔离，关闭清空 | 同文件隔离用例；缓存失效用例 |
| 排队的 @问题只读到此前消息 | 同文件并发用例：真实阻塞第一回合，第二回合排队，后到消息不进第二个 Prompt |
| 每群最多 20 条、每条 512 字符、8 KiB Prompt、100 个群、15 分钟 TTL | `group-context-buffer.test.mjs` 条数/字符/群数/TTL；bridge 用例以 100 条长中文与伪造标签验证字节预算与转义 |
| 过期与关开关影响已排队快照；图片块保持 | 缓存快照用例，精确检查 TTL 边界、禁用后失效及结构化内容保留 |
| 配置重载、RPC 实时生效、客户端入口、手动重绑保留选择 | `group-context-settings.test.mjs`，使用真实临时配置文件、controller/RPC 和实际 runtime，QQ SDK 客户端为替身 |
| 面板默认关闭、勾选提交布尔值、禁用状态、限制说明 | 同文件 React TestRenderer 交互用例 |

## RED → GREEN

- 新增 bridge 测试先执行：默认用例通过，4 个功能用例因 Prompt 缺失背景等原因失败。日志：`outputs/runtime/wg-qq-11/red.log`。并发用例在原实现会排队等待，因此 RED 定向运行排除了该用例；GREEN 已完整执行。
- 设置链路测试先执行：开关不持久化、RPC 缺失、runtime 不收集、面板组件缺失，5 项失败。日志：`settings-red.log`。
- TTL 回归先执行：已经捕获的快照在 TTL 到达后仍含过期内容，测试失败。修复为使用时过滤后通过。日志：`buffer-red.log`。
- GREEN：3 个新测试文件，16 项测试全部通过。执行命令（Node 为 bundled Node 24.22.1）：

```sh
node --test --test-isolation=none --experimental-test-coverage --test-coverage-include='src/channels/qq/group-context.mjs' test/channels/qq/group-context*.test.mjs
```

最终覆盖结果：新缓存模块行覆盖率 **100%**、分支 **97.50%**、函数 **100%**，见 `focused-final.log`。没有新增覆盖率工具。本轮用报告与日志保留 RED/GREEN 证据，代码仍处于未提交工作区，原有未提交改动保持。

## 质量门与验证边界

- **Node 24.22.1：`npm run check` 通过，4076/4076 测试通过，0 失败、0 取消、0 跳过；构建与包校验通过。** 日志：`outputs/runtime/wg-qq-11/check-full.log`。`DSH_HOME` 指向工作区可写测试目录，清除会话代理变量。
- 沙箱内首次运行已有测试遇到子进程 `spawnSync ... EPERM`，日志 `check.log` / `failure-detail.log`；获准在沙箱外运行原有命令后通过。没有修改旧测试断言或删除失败样本。
- 离线证据覆盖桥接业务流程和 Prompt 实参，QQ 平台/模型为替身；本轮未重新连接真实 QQ 群、未实际调用模型，不能据此声称回答质量、真实费用、平台延迟或长期运行表现已通过。
- 未 @ 缓存不持久化；已进入 Harness 的 Prompt 可能按 Host 既有会话机制保留。TTL 在缓存访问/使用时检查，无额外定时后台服务。去重只覆盖当前保留的未 @ 消息。
- 审核本次增量与开始时快照后，实际改动与上述影响面一致。没有 P2′ 触发规则或自主发送路径；原有发送控制改动保留。
