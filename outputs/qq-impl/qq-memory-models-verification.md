# 长期记忆独立模型选择

日期：2026-10-24。用户要求自行选择长期记忆的图片、文本总结模型。实现两个独立选择项，保留用户要求的长期开关关闭，不代选具体模型。

- QQ 卡片长期记忆区域复用现有 ModelEditor 和模型目录，分别提供图片总结模型、文本总结模型及思考强度。默认跟随机器人/Host 默认模型；关闭长期记忆时也可先选择。
- 新端点 `bot.group-memory.model.set` 接收 botId、kind、model，严格校验字段和类型。图片选择保存前通过 Host 模型元数据检查视觉能力，失败不改原设置。没有向模型发送聊天数据来做验证。
- 配置保存为每机器人 `groupMemoryModels`；默认项为 null，全部默认时不增加磁盘字段。两个项目互不覆盖，重启恢复，重新绑定及扫码保留。
- Host 工厂在后续任务启动时读取最新配置，分别路由图片 Agent 和文本摘要；不影响普通聊天会话，也不需要 `/new`。正在运行的任务保留开始时的模型，不重新生成历史结果。
- 共享 ModelEditor 新增可选标题、说明和默认项标签，其他渠道保留原默认值。已有九渠道聊天模型回归测试调整为精确检查聊天选择器；新增的两个记忆选择器由独立测试覆盖。

验证：RED 记录位于 `outputs/runtime/qq-memory-models/red.log`；新增三项测试覆盖真实配置/RPC持久化、两项UI选择和生产工厂分别调用图片/文本模型及随后恢复Host默认。九渠道模型UI回归20项通过，记录 `ui-regression.log`。全量检查、构建及真实部署证据分别位于 `check-full.log`、`deploy/verification.json` 和 `deploy/receipt.json`。

模型调用测试使用契约替身，未调用真实模型或改变真实机器人选择。部署后仍由用户自行选择并手动开启长期记忆。功能使用说明见[QQ群长期记忆](../../docs/QQ群长期记忆.md#总结模型选择)。

最终全量检查：4122 项通过，0 失败/取消/跳过；构建、包产物及 `git diff --check` 通过。已更新原 web profile，PID 223725 → 235376。真实 QQ connected、error 为 null；前端实际资源包含 `bot.group-memory.model.set`，模型状态为 `{ text: null, image: null }`，长期记忆仍关闭。QQ 账户配置和工作区权限与部署前完全一致，未替用户选择模型。证据为 `outputs/runtime/qq-memory-models/deploy/verification.json` 和 `receipt.json`。
