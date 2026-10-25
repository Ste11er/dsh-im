# WG-QQ-11 本机部署记录

日期：2026-10-23。用户要求部署并自行测试；随后明确授权「群成员可 @，命令仅 owner，私聊仅 owner」。

- 安装位置：本机 DSH `web` profile，`@xmanrui/dsh-im` 链接到当前工作区。安装前 profile 配置备份位于 `outputs/runtime/wg-qq-11/deploy/profile-before/`。
- 运行地址：`http://127.0.0.1:3080`。优雅停止原 DSH 后，沿用原环境和工作目录重启同一个 web profile，Node 24.22.1；PID 记录在 `deploy/server.pid`，运行日志在 `deploy/server.log`。未启动独立 QQ 测试程序。
- QQ：通过正常的本机认证管理 API 绑定之前已验证的同一机器人，Secret 写入 DSH 凭据存储，未输出凭据。状态为 `connected`，`error: null`。
- 配置：`groupContextEnabled: true` 已持久化。私聊仅此前 owner；群成员可 @ 普通问答，群命令默认关闭，仅 owner 显式允许。真实 Harness 与 Host 默认模型设置接入，不再使用固定回复的 stub。
- 验证：profile 组合包含插件；实际 QQ 管理端点返回连接正常；权限逐字段核对一致；前端启动清单包含插件，清单声明的实际资源内容包含 `bot.group-context.set`；磁盘上的开关为 true。结果与构建哈希保存在 `deploy/verification.json`、`deploy/receipt.json`。
- 边界：本轮没有由 Agent 调用真实模型或向 QQ 发测试消息；用户接下来验证实际回答质量及上下文效果。

测试：先在原 QQ 群内普通发送一条独特事实，例如「本次测试代号是海风317」，预期机器人不回复；随后 @ 机器人问「刚才的测试代号是什么？」，检查答案是否使用该事实。在 DSH「设置 → IM机器人 → QQ」可查看开关及收集计数；关闭开关会清空内存背景，已提交的 Harness 会话历史仍按原机制保留。

首次尝试恢复访问策略被自动审批拒绝，因为部署授权未明确涵盖持久权限变更；在用户明确选择上述范围后重新申请并成功执行。没有绕过拒绝。

## 用户实测确认

2026-10-23，部署并提供上述群聊测试步骤后，用户反馈「测试没有问题」。据此记录本轮用户实测通过，WG-QQ-11 完成。此项证据来自用户反馈；未另外采集模型 token、费用、延迟或长期运行数据。
