# QQ 两次发送失败定位与处理

日期：2026-10-25，时间均为 Asia/Shanghai。

## 已取证的失败

Host 原有内存日志记录了两次自主接话发送异常。启动 stdout 没有这些错误，不能用空文件推断没有失败；已通过短暂热加载的只读诊断插件提取原有 Logger buffer。诊断入口随后移除，临时模块已删除，profile patch 与操作前完全一致。原始错误保存在私有 outputs/runtime/qq-send-failure-debug/errors.json，报告不包含群标识和凭据。

1. 00:48:09：ApiError，httpStatus=0，连接 api.sgroup.qq.com:443 时 Connect Timeout Error，连接超时 10,000ms。没有建立连接，不是模型失败，也不是已确认交付。
2. 12:16:12：ApiError，httpStatus=400，bizCode=40034005，QQ 明确返回“回复消息msg_id已过期”。该轮模型在约 3 秒完成，不能将失败归因于长时间思考。没有保存入站原始 timestamp，无法事后证实具体由网关延迟、休眠恢复还是其他上游因素触发。

## 处理

- Markdown/纯文本发送只对上述明确的连接建立超时重试一次，最多两次连接尝试；不额外等待、不重新生成正文，复用同一接收目标、正文和 msg_seq。SDK 将 fetch.cause 展平到 ApiError.message，因此在这个已核对的 SDK 边界按 ApiError、httpStatus=0 和明确 Connect Timeout Error 标识识别。请求超时、连接中断、读响应失败等结果不确定的故障不重试。两次连接均失败时保留两个原始异常，并标记 qq-connect-timeout、deliveryOutcome=failed。
- [QQ 官方文档](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/server-inter/message/send-receive/send.md)规定群聊被动回复窗口为 5 分钟。使用 SDK GroupMessageEvent 必填的原始 timestamp 过滤过期未 @ 群消息：按已有授权保留长期归档，但不加入新鲜背景、不调用自主判断或回复，并持久标记去重。生成结束、发送前再次核对时间，窗口已过则跳过发送。缺失或非法时间戳暴露错误，不补成本地当前时间。
- 若 QQ 仍明确返回 40034005，面板显示 qq-reply-expired 对应说明；不能把已过期 msg_id 当成有效目标，也没有新增移除 msg_id 后强行主动群发的回退。
- 面板区分“连接超时，重连一次后未发送”和“回复窗口过期，请发新消息”，其他失败保留原来的通用诊断。成功后清除当前错误，累计错误计数仍按原有进程内语义保留。部署重启会重新计数，计数归零本身不是恢复验证。

## 验证与边界

- 修复前两个回归均红：原症状的 Connect Timeout Error 直接失败，过期事件仍进入模型。日志 /tmp/qq-send-recovery-red.log。
- 故障回放通过：首次连接超时后同请求恢复成功；连续两次超时明确失败；请求超时/断连/读响应未知结果不重放；取消阻止第二次尝试；过期输入保留原有归档但不污染新鲜背景；精确 5 分钟边界及非法时间戳；公开错误原因不泄露原始群标识。日志 /tmp/qq-send-recovery-green.log。
- 依据实际 SDK 类型与事件生产者补齐旧测试替身漏掉的必填 timestamp。严格时间戳契约专项 293 项通过。没有通过放松生产校验来兼容不完整替身。
- Node 24 完整 npm run check 最终 4174 通过，0 失败、取消、跳过，构建与包校验通过。日志 /tmp/qq-send-recovery-final-check.log。git diff --check 通过。
- 未人为制造真实 QQ 网络故障，也没有重放过去的群回复。上述恢复成功是使用真实 SDK ApiError 形态的可重复故障回放，不宣称已消除外部网络波动。

最终部署 PID 755612，沿用原启动参数。备份与保留检查在私有 outputs/runtime/qq-send-recovery-final/。账号配置、群会话绑定、模型、人格、长期记忆档案、群访问及 owner 命令范围保持原值。
