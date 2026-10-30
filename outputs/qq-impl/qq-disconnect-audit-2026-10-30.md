# QQ 间歇断连排查（2026-10-30）

> 后续补充：用户确认故障时 DSH 网页可用、QQ 信息无法进入。已完成连接请求超时和恢复记录修复并部署，见 [修复验证](qq-recovery-timeout-fix-verification.md)。以下保留首次诊断时的现场和结论。

## 结论

本次观察时 QQ 在线，没有复现真实连接中断。发现并离线复现了一项重连链路缺陷：SDK 的 HTTP 超时只覆盖收到响应头之前的阶段，正文读取可能不结束；获取网关地址卡在正文时，连接状态会持续为 connecting/recovering，外层 supervisor 因此继续等待而不接管。它能解释一类“断开后无法恢复”，但尚不能确认就是用户最近一次故障的原因。

此次仅诊断，没有修改生产代码、配置、权限，没有重启服务或发送 QQ 测试消息。

## 真实运行证据

- 当前 DSH 进程启动于北京时间 2026-10-30 00:37:52；之前部署记录里的进程已经退出，旧启动 URL 无法用于本次管理访问。
- 当前 QQ runtime 最近一次连接成功于 09:38:09；其运行内重连计数为 0。计数不跨 runtime 重建，不能据此推断整个进程运行期间从未断连。
- 三次管理状态采样相隔共 112 秒，均 connected，读取到三个不同的心跳 ACK 时间。服务端心跳周期 41,250ms，采样中的 ACK 往返约 62–65ms。
- 最近一次记录的群消息接收于 10:09:56，回复于 10:10:03。接收 20 条、回复 18 条，主动参与累计错误 2 次；当前错误字段已由后续成功清除，无法从当前面板还原那两次错误。
- 系统日志显示 10 月 29 日晚间存在休眠，10 月 30 日 01:50 有 Wi-Fi 接入点切换。二者均可能中断长连接，但缺少本次故障时间对应关系，不能当作根因。
- 本次查询未发现今天 00:30 以后新的内核休眠/OOM 杀进程记录。历史启动日志有一次 3080 端口占用，时间在前一天；不能归因为本次 QQ 断连。

## 本机可复现缺陷

调用真实 SDK 1.0.4 ApiClient 获取本地 HTTP 服务的 /gateway：服务发送 200 响应头和不完整 JSON，保持正文不结束。配置 HTTP 超时 30ms、网关连接超时 60ms，等待 250ms 后仍为：

- `sdkIsConnecting=true`
- `socketCreated=false`
- `health.recovering=true`
- 没有重连计时器

诊断程序退出码 1 是预期的故障断言，HTTP 服务和连接已清理。

复现命令：

```sh
node outputs/runtime/qq-disconnect-audit/gateway-body-probe.mjs
```

相关调用链：

1. `node_modules/@tencent-connect/qqbot-nodejs/src/protocol/api/api-client.ts`：fetch 返回响应头后，finally 清除超时计时器，之后才 `await res.text()`。
2. 同 SDK `protocol/api/token.ts` 的 token 请求存在相同的正文超时缺口；此次网关探针未实测 token 接口。
3. `src/channels/qq/gateway-connection.mjs`：HELLO/READY 超时从 WebSocket 对象创建后才开始，不覆盖之前的 token/网关地址读取。
4. `src/channels/qq/qq-controller.mjs`：runtime 标记 recovering 时保留 SDK 重连控制权。SDK 卡住会使该标记一直维持。

## 已运行验证与限制

- `node --test test/channels/qq/gateway-connection.test.mjs`：5/5 通过，覆盖缺失 ACK 重连、静默但 ACK 正常、缺失 HELLO、旧 socket 延迟关闭、QQBot 连续群聊/私聊事件。
- 本机网关正文挂起探针：可重复触发，退出码 1。
- `git diff --check` 通过。
- 未人为断开真实 QQ 连接，未做真实平台故障注入。
- QQ 断连原因目前在恢复后被清空，runtime 被重建后计数也重置，缺少跨恢复/重建的原因历史；真实故障归因仍需要发生时间或后续故障现场。

## 修复方向

让认证及网关查询的超时覆盖响应头、完整正文和解析之前的网络读取，并在超时时真实取消网络请求；保留 SDK 的限流退避。仅对外层 Promise 做超时竞速不能取消底层请求，不足以闭合修复。同时保留有界的连接失败原因、关闭码和恢复时间，避免重连后丢失现场。

采样与探针结果位于 `outputs/runtime/qq-disconnect-audit/`。状态读取程序使用本机已有管理凭据，未输出或保存凭据。
