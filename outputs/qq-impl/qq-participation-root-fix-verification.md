# QQ 未 @ 接话故障修复与实测

日期：2026-10-25。用户反馈机器人声称功能未实现，而且未 @ 时没有回复。

## 根因与变更

- 旧回复读取历史方案，把 P2′ 待办当成当前能力。现为 QQ 当前回复注入已实现能力、开关与进程内触发计数，明确开启不等于收到消息/投递成功；历史方案标注已过时。
- 自主接话把字符串传给原生 Agent.followup，违反 Host 内容块数组契约。真实会话出现 `content.some is not a function` 或 DeepSeek `TRANSPORT`。改传 `[{type:'text',text:content}]`，失败保留 Host 原始错误原因与代码。两个严格替身测试先失败后通过。
- 用户未 @ 发送“大肥鱼发个表情包”后，真实判断 Agent 收到回复专用的表情提示，尝试 `dsh_qq_sticker`，Host 返回 `UNKNOWN_TOOL`，最终输出静默。这是判断阶段调用，不是回复 Agent 缺少工具。判断阶段不再绑定交付 consumer，因而不注入回复专用的表情/记忆工具提示；角色基线仍通过判断系统提示提供。
- Host 在新 Agent 上挂载的作用域内团队工具不受 inherited tools.restrict 遮罩影响。增加当前 Agent 的最终工具 schema 过滤：判断为空，回复仅表情检索、已选表情回传、本群记忆查询。原执行 guard 保留。明确称呼机器人或想看表情包属于聊天互动，本机文件/系统命令仍不执行。

## 验证层级

- 回归先红后绿：`/tmp/qq-agent-content-red.log`、`/tmp/qq-agent-content-green.log`；判断提示与工具面回归 `/tmp/qq-judge-guidance-red.log`、`/tmp/qq-judge-guidance-green.log`。
- Node 24 完整 `npm run check`：4166 通过，0 失败、取消、跳过，构建与包校验通过。日志 `/tmp/qq-participation-judge-final-check.log`。`git diff --check` 通过。
- 使用已安装 Host 的原生 Cordis、SystemPrompt、ToolRuntime 和作用域机制核对最终组装结果：判断工具为 0、无回复提示；回复工具恰好为 3，带回复提示。特意在 Agent 本地注册团队工具后仍通过。模型输出、Agent 驱动及投递在此检查中是替身，不能证明真实群发。
- 真实未 @ 群聊：第一轮上线后，接收记录正常，模型判断与回复均完成，确认发送一条文字“笑死，抢红包抢了个寂寞，连 2.9 都摸不着”。该进程当时计数 candidates=8、declined=7、replied=1、errors=0。这证明文字自主接话已完成真实链路，不证明首次表情请求成功。
- 判断提示修复再次部署：PID 651627 → 667740，沿用当前 `node /usr/local/bin/dsh web`、工作目录及环境。管理接口确认 connected=true、error=null；判断/回复均为官方 DeepSeek Flash Off，冷却 1 秒、功能开启。新进程计数重置为 0。
- 首次表情请求未发送图片。最新版本随后收到包含该表情请求的真实未 @ 群消息：判断会话 c7c39e8e 的最终工具 schema 为 0，输出 QQ_REPLY；回复会话 ba42b617 的最终工具 schema 恰好为上述 3 个。真实表情检索和图片回传工具均成功，登记一张 68,626 字节 WebP，回复回合 completed。
- 该次部署的后续管理状态为 messagesReceived=3、messagesReplied=3，candidates=3、replied=3、declined=0、errors=0，lastMessageError=null，服务日志无图片投递失败记录。结合投递代码（图片失败/未知必定留下 lastMessageError，而自主文字成功不会清除该错误），支持发送流程已完成且无图片失败的结论。管理接口不暴露单条图片 receipt；尚无用户 QQ 客户端显示确认，不能把工具登记或这些后端证据等同于已在客户端目视验收。

部署备份、启动日志及配置比对结果在私有目录 `outputs/runtime/qq-participation-judge-fix/`。保留既有群访问、owner 命令/私聊范围、模型、人格、长期记忆配置与档案；不重新投递历史入站消息。
