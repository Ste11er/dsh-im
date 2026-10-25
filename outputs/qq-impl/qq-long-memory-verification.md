# QQ 群聊长期记忆验收记录

日期：2026-10-23 至 2026-10-24。用户在 WG-QQ-11 实测通过后，授权按讨论的「近期原文＋长期模型摘要＋压缩原文归档＋按需检索」实施并接入当前部署。访问范围沿用已确认的「群成员可 @，命令仅 owner，私聊仅 owner」。

## 实现与影响

- `group-memory.mjs` 提供按机器人持久化、按群隔离的 SQLite/gzip 原文归档、批量摘要、全文检索及取消机制；没有新增依赖，使用 Node 自带 SQLite、zlib。
- Host `group-memory-summary.mjs` 通过真实 `llm.stream` 做独立摘要，动态跟随机器人模型或 Host 默认模型。没有工具、用户 Session、Agent 循环或 QQ 发送路径；需要明确的正常 finish 才提交摘要。
- QQ bridge 在访问控制之后归档，保留提问到达时的检索序号；runtime 管理开关、后台任务、重启和关闭；production 工厂绑定本机文件路径、模型服务及显式删除时的文件清理。
- config/controller/RPC/client/UI 增加默认关闭的独立开关、即时生效、受理式手动摘要和公开计数。手动摘要不在账户转换锁中等待模型，允许关闭或删除取消在途请求。短期开关与既有访问策略保留。
- 文档说明默认预算、无自动归档删除、后台调用成本、故障状态、检索限制、备份和删除方式。短期消息过期不等于清除持久历史。

存储采用新独立数据库，不改已有 `state.json` 或配置版本。开启时才创建，旧配置保持关闭。数据库 schema 为 1；未知版本或损坏报错，不重置。模型摘要事务成功后标记来源；失败、取消和截断均保留原文待处理。正文与索引写入事务一并提交。参数与依据见[使用说明](../../docs/QQ群长期记忆.md)，均为明确的产品初始值。

## 已执行验证

| 层级 | 证据与结果 |
| --- | --- |
| 回归先失败 | `outputs/runtime/qq-memory/` 中的 `red.log`、`summary-red.log`、`settings-red.log` 捕获未实现路径；`starvation-red.log` 捕获失败群阻塞其他群；`stream-order-red.log` 捕获文本块顺序与关闭后增量问题 |
| 单元与集成 | 新增 28 项，覆盖开关不建文件、gzip 原文还原、0600、去重、重启、跨群和到达边界、定时摘要、预算、三次失败、取消迟到结果、事务失败、坏库不覆盖、流错误/截断/无 finish、真实 runtime 与 production 工厂、RPC 与 React 面板；全部通过 |
| 重点覆盖率 | 存储与摘要模块合计行 99.69%、分支 86.79%、函数 96.15%；摘要模块行 100%。报告 `focused-coverage.log` |
| 全量质量门 | Node 24.22.1 执行 `npm run check`，4104 项通过，0 失败/取消/跳过；包构建和产物验证通过。日志 `check-full.log` |
| 受理与取消回归 | 补强已有设置测试，使用未结束的模型 Promise 验证手动请求立即受理，关闭设置仍可取得账户转换锁；2 项设置/面板测试再次通过，见 `manual-cancellation-regression.log` |

上述测试中的模型流、QQ Bot 为明确的替身，归档、SQLite、gzip、控制器、RPC 和 runtime 集成为真实本地组件；不能据此宣称真实模型摘要质量、计费或 QQ 长期运行效果已经通过。

## 当前部署

- 当前 DSH `web` profile 仍链接本工作区，使用已构建的插件；优雅重启原进程后，PID 为 157773，地址 `http://127.0.0.1:3080`。沿用原环境和工作目录。新运行日志与 PID 在 `outputs/runtime/qq-memory/deploy/`，日志权限 0600，不在报告中写启动认证令牌。
- 通过正常认证管理 API 对同一个已绑定机器人启用 `groupMemoryEnabled: true`，短期上下文仍开启。QQ 返回 connected、error 为 null；实际前端资源包含两个长期记忆端点。
- 逐字段核对 owner 权限，并对比部署前后的 `workspaces.json` 完全一致；QQ 账户配置只有长期记忆字段发生变化。配置备份在上述目录的 `before/`，未重新绑定凭据。
- 真实数据库 `~/.dsh/integrations/dsh-qq/bots/qq_f83f39f6d2a9507eace6bae5/group-memory.sqlite` 已创建，schema 1、权限 0600。初始检查点为归档 0，随后正常接收到 3 条真实群消息并落盘；已逐条核对 gzip 头、解压成功及正文非空，没有输出正文、群或成员 ID。未伪造群消息或写入测试历史。
- 调用了真实手动摘要端点：先观察 summarizing 为 true，随后为空任务正常结束、无错误。由于当前没有待处理群消息，此次没有调用模型或向 QQ 发送测试消息。
- 管理检查证据为 `deploy/verification.json`、`deploy/manual-ack.json`；本地文件与构建记录为 `deploy/receipt.json`。

### 真实模型调用审批状态

收到真实消息后，尝试通过正常管理接口手动摘要。自动审批在命令启动前拒绝，理由是将真实 QQ 群消息发送到当前 Host 模型涉及具体数据和模型目的地，现有功能授权没有被认定为该项明确授权。没有改用其他入口执行，也没有等待定时任务间接发送。

为停止后台调用，已通过正常端点关闭长期记忆。最终暂停检查点：QQ connected，短期上下文仍开启，长期开关关闭，归档 3、待摘要 3、摘要 0、summarizing 为 false；已有原文保留。`paused-status.json` 及 `receipt.json` 记录当前状态，早先 `verification.json` 是暂停前的部署检查，不能代表最终已启用。

从当前 web profile 配置核实的默认模型为 `volc/deepseek-v4.1-flash`，目的地为 `https://ark.cn-beijing.volces.com/api/coding/v3`。随后用户明确授权该模型接收已归档及后续获准采集的群文字，但在恢复请求执行前进一步指示「现在的记忆先不长期」「等我自己开」。自动审批据最新指示拒绝了恢复启用请求，未启动该命令；没有执行真实摘要。

### 最终状态：由用户手动开启

遵照最新指示，已再次通过正常端点保存长期记忆关闭。最终核验：QQ connected，`groupContextEnabled: true`、`groupMemoryEnabled: false`、`groupMemory.enabled: false`、`summarizing: false`；已有 3 条原文保留，摘要 0，不再采集长期原文、生成摘要或检索长期历史。`deploy/final-status.json` 和 `deploy/receipt.json` 为当前证据。后续仅由用户在 QQ 设置中手动开启，不自动恢复。

已完成代码、构建、替身模型集成、真实消息压缩落盘和部署/接口层验证。真实模型摘要质量、费用、跨重启问答效果及长期性能尚未验证；当前关闭是用户选择。测试步骤见[使用说明](../../docs/QQ群长期记忆.md#实测方法)。
