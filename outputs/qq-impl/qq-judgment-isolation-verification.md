# QQ 连续接话异常：判断角色隔离修复

2026-10-25，Asia/Shanghai。用户报告连续四次发送失败，随后反馈持续无法接话。

## 已确认的故障

认证状态查询显示 QQ 仍 connected=true，主动参与计数有 4 个 errors。Host Logger buffer 导出发现至少 5 次同类错误；原 stdout 无错误行，不能据此认定没有故障。

| 时间 | 实际发生阶段 | 证据 |
|---|---|---|
| 13:03:41.180 | 判断输出校验 | `Invalid participation judgment decision` |
| 13:03:51.161 | 判断输出校验 | 同上 |
| 13:03:54.656 | 判断输出校验 | 同上 |
| 13:03:58.253 | 判断输出校验 | 同上 |
| 13:05:53.991 | 判断输出校验 | 同上 |

对应原生判断 Session 均正常 completed，前四次输出 `[[QQ_REPLY]]` 后继续写图片相关回复，第五次直接用聊天口吻回答，未输出判断标记。它们被严格协议校验拒绝，没有进入共享群 Session 生成真正回复，也未调用 QQ 发送接口。本轮故障不属于已发生的 QQ API 请求失败。

原始日志与堆栈位于私有 `outputs/runtime/qq-four-failures-debug/errors.json`；本地保存的失败输入与输出位于 `outputs/runtime/qq-judgment-isolation/captured-failures.json`，未向外重放。

## 层级审计与修复

应用 diagnosing-bugs 和 agent-architecture-audit 工作流，本次关注系统提示、输出整形及 UI 错误传播。

1. **高：判断器角色混入聊天人格。** 原代码在分类器系统提示后直接追加完整人格基线，最终 assemble 只清除 tools，没有覆盖其他 system sections/contexts。人格要求扮演大肥鱼、自然聊天，与只返回枚举标记的职责冲突。现在最终 assembly 只保留判断器 section，contexts/tools 均清空；人格改为 `dsh_im_qq_bot_profile` 中 JSON 引用资料，仅供识别称呼和兴趣。系统明确区分分类器与真正聊天机器人。
2. **中：判断失败与发送失败混在通用错误中。** 为无效判断新增稳定错误码 `qq-judgment-invalid`，统计与设置面板保留该原因，明确说明未调用 QQ 发送。混合正文、纯正文、空判断仍为失败，不猜测决策、不提取第一个标记后悄悄发送。

没有更换模型、放宽枚举校验、增加隐藏修复调用、自动回放私有内容或重发旧群回复。先前按语境放宽接话的规则、图片输入、共享群会话、人格、1 秒冷却、访问策略与长期记忆设置保留。

## 检查

- 新回归先红：`node --test --test-isolation=none test/channels/qq/judgment-isolation.test.mjs`，3 项失败，分别暴露系统角色串入、无明确错误码、状态丢失判断阶段原因。修复后 3 项通过。
- 判断及参与聚焦回归共 17/17 通过。全量 `npm run check`：4188 通过、0 失败/跳过/取消，构建及包产物验证通过；日志 `/tmp/qq-judgment-isolation-check.log`。
- 当前官方 Flash Off 的 10 个合成对话/图片样例：新规则 10/10 输出合法协议，无格式错误；9/10 符合预设决策，另一个未直接点名机器人的图片问句选择保持安静，原始失败预期保留。旧版在这组人工人格与输入上也没有出现格式异常，因此不宣称该合成集精确复现了真实群故障或证明失败率下降。
- 合成测试覆盖同句不同语境、明确等待、直接要求聊天、要求标记后附正文、图片问句、改角色要求。只有人工编写的人格、句子与人工生成的红圆/蓝方块数字图发给官方模型。证据 `outputs/runtime/qq-judgment-isolation/synthetic-results.json`。
- 真实群消息/图片回放被自动审批以缺少具体私有数据重放授权拒绝，未执行；随后删除该模块，改为上述合成验证。没有通过其他入口间接重放。

## 部署与保留

最终受控重启 PID 827123。认证状态接口确认 QQ connected=true；随后实群测试已完成，接收 2 条、成功回复 2 次，主动判断 candidates=2、replied=2、errors=0，当前判断错误和消息错误均为空。

配置、workspaces、profile package 与部署前逐字一致；2 个 Session 绑定一致；临时挂载和探针模块已移除，profile patch 恢复原文。证明文件：`outputs/runtime/qq-judgment-isolation/preservation.json`。

用户完成新的未 @ 实群测试并确认能够正常回复。13:17:13 和 13:17:56 两次原生判断均 completed，严格输出 `[[QQ_REPLY]]`；判断输入分别包含 1、2 个真实图片块。两次实际回复进入部署前相同的群 Session，第 47、48 回合均 completed，实际回复输入也分别包含 1、2 个图片块。结合成功发送计数与用户收件确认，本轮接收→判断→原群会话→发送链路已验证恢复，未再出现本轮同类格式错误。私有验收文件：`outputs/runtime/qq-judgment-isolation/live-test-verification.json`。这两次实测不等于保证未来模型永不输出非法格式；严格校验与独立错误提示继续保留。

如需运行版本回滚，本次修改前 lib 在 `outputs/runtime/qq-judgment-isolation/before-build/`；应先核对进程身份并受控重启，保留其后新增的会话与记忆。回滚产物还需同步处理源代码，避免下次构建覆盖。本次未回滚。
