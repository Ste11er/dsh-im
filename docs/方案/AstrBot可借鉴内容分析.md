# AstrBot 对当前 dsh-im 项目的可借鉴内容

> 调研日期：2026-10-31。参考仓库：[AstrBotDevs/AstrBot](https://github.com/AstrBotDevs/AstrBot)，已核验快照 `v4.29.3`，提交 [`c441c660d21ff124c1eef0b85c3802ed483b5d71`](https://github.com/AstrBotDevs/AstrBot/tree/c441c660d21ff124c1eef0b85c3802ed483b5d71)（2026-10-31）。本文上游链接均固定到该提交，不是重新拉取后的“最新版本”声明。
>
> 当前项目：`@xmanrui/dsh-im` `4.38.1`，基于本机当前工作区阅读；本地 HEAD 为 `b6d9196fb9bc84fa8e47cb4d80c2261f1d02cc3f`（2026-10-30），工作区无未提交改动。
>
> 方法：静态阅读源代码、测试与文档，并对照当前项目对应实现。**未执行上游代码、未安装依赖、未运行上游测试、未做任何渠道实测**；不宣称其 README 或文档中的准确率、延迟、稳定性已经复现。文档描述与源码实现是两类证据，本文按源码为准、文档只作语义补充。
>
> 许可证：AstrBot 为 **AGPL-3.0-or-later**，当前项目为 MIT。本文只讨论思路、契约与验收方法；**不复制上游代码**，任何依赖或代码片段的许可证都需单独核验。

## 1. 结论与建议顺序

AstrBot 是一个完整的 Agent 聊天机器人平台：它自己拥有 Agent 循环、工具执行、上下文压缩、知识库、沙箱和插件市场。dsh-im 则是一个 DSH 宿主前面的交互网关：Agent 运行、工具执行、会话历史与安全审批都在宿主，插件负责渠道接入、语义转换、呈现与交付。**因此最值得学的不是 AstrBot 的 Agent 能力，而是它在“消息进入 Agent 之前”和“结果回到用户之后”这两段做出的可观测、可管理、可恢复设计。**[架构文档](../adr/0001-semantic-core-native-channel-adapters.md)与[产品演进分析](dsh-im-产品价值与演进分析.md)已经确认了这一职责边界；AstrBot 从 v4.7 把 Dify/Coze 从“聊天 Provider”迁到“Agent 执行器”的教训，也支持不要在同一层混合“说话”和“做事”。[执行器说明](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/agent-runner.md#L19-L34)

当前项目在渠道原生呈现、交付回执、访问策略、会话绑定、群记忆、owner 工具限制和真实宿主验收上大多比 AstrBot 更细。本文不建议为了“像 AstrBot”而统一或降级这些能力；下列方向都要求**增量包裹、保持既有语义**。

| 优先级 | 可借鉴方向 | 对应资产 | 当前项目现状 | 建议的增量 |
|---|---|---|---|---|
| P1 | 逐条处理轨迹与脱敏诊断包 | 底层可观测性 | 有按群接收计数、最近决策、接话累计统计、失败分类，但没有跨阶段关联的同一条消息轨迹，也没有可导出的诊断包 | 为一条入站消息建立 trace 标识，记录接收→权限→上下文→判断→回合→工具→发送的有界阶段结果，可在面板查看 |
| P1 | 空 @/无正文唤醒时等待补充输入 | 场景资产 | QQ 空 @ 未发现专门等待/合并逻辑；被拆成多条的输入只在未 @ 自主接话中被语义合并 | 仅对“无文字/图片/文件/引用的 @”启动有上限的短等待，把下一条补充并成一次输入；超时与取消语义明确 |
| P1 | 语音输出：TTS 与平台编码分层（QQ SILK） | 触达与表达 | QQ 语音仅有规划；SILK/ffmpeg 未在本机验证；飞书语音已有 DashScope + Opus | 按“文本→TTS→格式转换→平台发送→回执”分层，先核验 QQ 账号实际接受的编码，再决定 Node 侧转换方案 |
| P2 | 群长期记忆的混合检索 | 场景资产 | 中文双字词/英文词全文索引 + 摘要 + 按需查询，未使用向量或重排序 | 先用固定样本评估召回缺口，再决定是否增加 dense + BM25 融合与可选 rerank，不改变 1200 字节总览预算 |
| P2 | 入站节流与处理阶段语义 | 可靠性/成本 | 出站有发送预算、安静时段、dry-run；入站只有忙时队列/丢弃和接话冷却，没有按会话的固定窗口上限 | 增加按会话的入站固定窗口，明确“丢弃并说明”或“排队”，并把各渠道停机原因写清楚 |
| P2 | 媒体引用与转码契约 | 触达与表达 | 图片、文件、产物、引用附件各有实现；QQ 图片有下载预算；没有统一媒体解析器 | 先定义小契约（允许的引用形式、魔数识别、目标格式、临时文件归属），用真实缺陷样本决定是否归并，不合并不同信任边界 |
| P2 | 工程治理：贡献契约、发布自动化、启动冒烟 | 工程质量 | 282 个测试文件、`npm run check`、Windows 工作区回归、真实宿主 verify 脚本、i18n 覆盖测试都已有 | 增加 AGENTS 式贡献契约、单命令发布准备脚本、插件启动冒烟检查；不替换现有更强的真实宿主验收 |
| P2 | 备份、恢复与状态版本迁移 | 可运维性 | 每机器人 JSON 状态与群记忆 SQLite，无导出/导入；更新服务只保留安装清单备份 | 设计带版本与校验和的导出包，导入校验失败关闭；凭据继续引用宿主凭据库，不复制密钥 |
| P3 | 交互回调 token 与过期 | 闭环资产 | 已有已答状态卡、菜单过期提示、宿主级提问/审批；回调状态机主要在宿主 | 只有 dsh-im 自有回调遇到平台载荷上限或需要跨重启时，再参考紧凑 token + 过期提示，不复制宿主状态机 |
| 边界 | 定时任务（cron/future_task） | 触达资产 | 本机 DSH 安装包含 `dsh-schedule`（可选实验 bundle，一次性/间隔/每日/每周/cron、会话内投递）；本项目已识别 `schedule` 来源事件 | 不在插件内再造调度器；只研究任务所有权、投递回执与非会话投递目标这一交付边界 |

优先级是本次分析建议，不代表用户已同意这些功能的具体实现或参数。以下每项分别给出上游证据、当前现状、建议与验收条件。首轮若实施，建议先做“逐条轨迹、空 @ 等待、语音编码核验”三项低耦合切片。

## 2. P1 逐条处理轨迹与可导出诊断包

### 2.1 上游实际实现

AstrBot 为每条入站消息建立一条 trace：`TraceSpan` 持有 `trace_id`，把事件接收、插件调用、Agent 调用、响应发送记录为有界的 span/event，单条 trace 限制 1 MiB、128 个 span、256 个 event；未启用时不采集，历史仍可查看。[trace.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/trace.py#L27-L29)、[事件发送记录](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/platform/astr_message_event.py#L553-L580)、[采集开关](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/trace.py#L217-L226)

管道在 `trace_execution` 中执行，所以同一条消息的各阶段共享 trace 上下文。[scheduler.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/scheduler.py#L84-L105) 持久化使用独立 SQLite，默认 `logs/traces.db`、保留 7 天、容量预算 80 MB，后台线程批量写入，列表每页最多 100 条；写入失败不阻塞消息处理。[trace_store.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/trace_store.py#L193-L215)、[默认配置](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/config/default.py#L312-L315)

面板有独立的“追踪”页：列表显示状态、平台、时间、时长、消息摘要、类型、UMO、发送人和 span 数，可按“有错误/有模型调用/有插件调用”过滤，点开才是时间线详情；运行中实时刷新。[WebUI 文档：追踪](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/webui.md#L187-L224)

与之配套的是“导出诊断包”：ZIP 汇总日志、缓存日志、可用 trace、配置与路由、插件状态、运行环境和清单；默认脱敏，自动遮盖已识别凭据，公网 IP 替换为包内一致的编号，trace 最多 50 条/16 MiB，只有控制台管理员可下载。[WebUI 文档：诊断包](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/webui.md#L177-L186)

### 2.2 当前项目现状

当前项目已经有较好的“内容不越界”基础：`diagnostic-details.mjs` 用允许列表限定什么诊断字段可以跨 Host/Client 边界；`group-reception.mjs` 按群记录网关/本地 @、普通消息计数和最近决策，并明确“没有普通事件只代表尚未观察到”；`group-participation.mjs` 记录候选/保持安静/继续听/已接话/跳过/错误的累计值；`message-failure.mjs` 区分失败与结果未知。见 [diagnostic-details.mjs](../../src/channels/shared/diagnostic-details.mjs)、[group-reception.mjs](../../src/channels/qq/group-reception.mjs)、[group-participation.mjs](../../src/channels/qq/group-participation.mjs#L37-L57)、[message-failure.mjs](../../src/channels/shared/message-failure.mjs)。

但这些证据分散在不同模块，且多为按群累计值或最近一条状态：当前实现没有用同一个标识串起“这条消息为什么被判断为安静、进入了哪个 Session、调用了什么工具、最终发送结果是成功还是未知、各阶段耗时多少”。这正是此前 [dsh-qqbot 分析](dsh-qqbot可借鉴内容分析.md)已经列为 P1、但本轮仍未实施的方向。

### 2.3 适合当前项目的做法

为每条入站消息生成不可逆的短标识（消息 ID 哈希即可），建立一条**内容默认不落盘**的轨迹：接收（平台/群/发送人哈希）、访问判定、上下文记录、接话判断（结果与耗时）、提交回合（Session/Turn）、工具调用摘要、发送尝试与回执、终态。阶段结果来自现有模块的真实返回值，不新建并行的判定逻辑。

轨迹可以先用有界内存环形缓冲加可选 SQLite 持久化，参照上游的容量/条数/保留期上限和“写失败不阻塞消息”；面板只展示最近 N 条与过滤条件。逐步扩展为可选的“导出脱敏诊断包”，导出字段仍走现有允许列表，凭据和公网地址必须清除或编号化；不要默认导出群聊正文。

### 2.4 验收

- 在同一个群分别制造：不需回应、继续听、冷却跳过、忙时丢弃、正常发送、确定发送失败、发送结果未知。从面板一条记录能定位停在哪一阶段，失败与未知不能计为成功。
- 同一消息的“判断→进入 Session→发送”使用同一标识关联；不同群、不同消息不串。
- 轨迹写入不显著增加回复延迟；写满或持久化失败有可见告警但不影响消息处理；保留期与容量上限生效。
- 导出包在脱敏模式下不含凭据、token、公网 IP；未开启轨迹时也能导出并注明“无轨迹”；导出不阻塞正常收发。

## 3. P1 空 @/无正文唤醒：等待补充输入

### 3.1 上游实际实现

AstrBot 把“只 @ 了机器人或只发了唤醒词、没有正文”的消息单独处理：当消息链只有一个 At 或仅唤醒前缀时，可选地先让模型友好询问（可关闭），然后用 `session_waiter(60)` 把该会话挂起最多 60 秒；下一条非空消息到达时，把 At 插到消息链最前面重新入队，作为一条新事件处理，原事件停止；超时则静默结束。[empty mention 处理](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/builtin_stars/astrbot/main.py#L42-L125)

`session_waiter` 是一个通用装饰器：按过滤器确定会话，`SessionController.keep()` 控制超时与续期，可记录历史消息链，超时抛 `TimeoutError`。[session_waiter.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/session_waiter.py#L18-L60)、[装饰器](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/session_waiter.py#L173-L201)

### 3.2 当前项目现状

QQ 链路会把 @ 标记归一化并从正文中移除，然后继续走“已 @”的正常路径；当前代码未发现对“@ 后正文为空”的专门等待，也未发现把下一条消息补进来再提交的机制。空内容最终是否被提交为空 prompt、还是会走别的兜底，需用真实入站样本核验，本文不把它当作已确认的线上缺陷。群聊自主参与虽然会把同一人的未完成片段按顺序保留并“继续听”，但那是**未 @ 的主动接话判断**，不覆盖被 @ 后的补充输入。见 [qq-mention.mjs](../../src/channels/qq/qq-mention.mjs)、[qq-bridge.mjs 入站处理](../../src/channels/qq/qq-bridge.mjs#L830-L950)、[QQ群聊自主参与](../QQ群聊自主参与.md)。

### 3.3 适合当前项目的做法

只对“已 @ 但既无文字、也无图片/文件/引用”的消息启动一次有上限的等待，例如 30–60 秒，产品上可选择“先提示想要问什么”或“完全静默等待”。下一条满足条件的消息到达时，把上下文合并成一次提交：例如在 prompt 前加一行明确的“用户先 @ 了机器人，随后补充了以下内容”，而不是把两条独立提交给模型。等待必须按会话路由隔离，遇到命令、新 @、审批/提问、`/stop`、换绑、访问策略变化、暂停或断连立即放弃。

不要把它做成通用“多轮收集器”：审批、提问、批量输入和猜成语已有各自状态机，新的等待只处理“空唤醒”这一种情况，并且同一路由同时最多一个。

### 3.4 验收

- 空 @ 后 10 秒内补发文字：只产生一次模型回合，模型看到合并后的输入；不出现“先回一句空问题再回一次答案”。
- 空 @ 后不发补充：超时后按选定语义结束，不向宿主提交空 prompt，不残留挂起状态；重启/重连后不出现卡死会话。
- 等待期间发送 `/stop`、命令、审批答复或其他人的消息：按既有语义处理，不被等待器吞掉。
- 群聊多发送者、私聊、不同渠道分别验证；未做真机验证的渠道明确列为未验证，而不是宣称全部支持。

## 4. P1 语音输出：TTS 与平台编码分层（QQ SILK）

### 4.1 上游实际实现

AstrBot 把“音频引用解析、格式转换、发送”拆开：`MediaResolver` 接受本地路径、`file://`、HTTP(S)、`base64://`、data URI 等引用，可按目标格式转码；音频目标格式包含 QQ/微信/企业微信使用的 `tencent_silk`，转换前先确保 WAV，再编码 SILK，并返回时长、清理临时文件。[MediaResolver](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/media_utils.py#L657-L760)、[ensure_wav](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/media_utils.py#L1666-L1720)

SILK 具体实现使用 `pysilk`：解码时去掉 QQ/Tencent 语音常见的 `0x02`/`0x03` 前缀，统一为 24 kHz 单声道 16-bit PCM WAV；编码时先降混、重采样、转 16-bit，再用 `tencent=True` 生成带 `0x02` 前缀的 QQ 兼容 SILK 流，支持 8/12/16/24/32/48 kHz 输入。[tencent_record_helper.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/tencent_record_helper.py#L13-L120)

TTS 与 STT 本身是独立提供方抽象：TTS 提供 `get_audio()`/`get_audio_stream()` 返回音频路径，仓库内有 OpenAI、Gemini、Edge、Azure、火山、MiniMax 等多个实现；发送侧 `send_message_to_user` 支持 `record` 等类型，并对跨会话发送做管理员校验、对本地文件路径做工作区/临时目录限制。[TTS/STT 抽象](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/provider/provider.py#L223-L270)、[发送工具](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/tools/message_tools.py#L54-L140)、[跨会话权限](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/tools/message_tools.py#L212-L225)

### 4.2 当前项目现状

QQ 语音当前只有[规划文档](QQ大肥鱼语音输出计划.md)，明确“未实现、未启用、未调用收费语音服务”，并记录：SDK `sendVoice` 支持 buffer/localPath/url 但不负责编码；飞书 `voice.mjs` 已有 DashScope ASR/TTS 与 ffmpeg Opus 转换；本机存在 `/usr/bin/ffmpeg` 但未验证版本、编码器与 SILK 支持；QQ 群语音实际可播放格式待实测。飞书语音与 QQ 语音的格式差异不能互相代替。[QQ大肥鱼语音输出计划.md §2](QQ大肥鱼语音输出计划.md)。

### 4.3 适合当前项目的做法

把计划中的链路固定为五段并分别验收：`最终文本 → TTS 提供者 → 音频格式转换 → 渠道原生发送 → 消息回执`。上游的实现说明“文本合成”和“平台编码”确实是两层，且 QQ/微信/企业微信存在 SILK 这一单独目标格式；但这是 **Python 生态**的实现，Node 侧不能直接照搬。

建议步骤：先用公开短句与当前 QQ 账号验证平台实际接受的格式与时长（SILK / wav / mp3、文件头前缀、手机端气泡播放、上传与消息回执是否分离）；若不接受常见格式，再评估 Node 侧 SILK 编码方案（如 silk-wasm 类库或 ffmpeg 转码），并单独核验依赖许可证、维护状态与本机可用性；若接受其他格式，就不为了“对齐上游”额外引入 SILK。`spokenText` 与角色动作/语气元数据继续分离，文字回复不因语音合成而延迟，语音失败不把已发出的文字改成失败。

### 4.4 验收

- 文字与音频来自同一次真实回答，只使用当前群/当前 Session/Turn 的交付身份；不另开推理会话。
- 分别记录模型完成、TTS 耗时、格式转换耗时、上传、消息回执；失败阶段可区分“合成失败/转换失败/上传失败/发送被拒/结果未知”。
- 语音发送结果不确定时不自动重发文字或语音；确定未发送时按计划回退文字并标记语音失败。
- 真机确认手机端可播放、时长与格式符合平台限制；未通过时如实说明平台/账号阻碍，不把普通文件发送成功当作语音完成。

## 5. P2 群长期记忆的混合检索

### 5.1 上游实际实现

AstrBot 知识库检索是固定四段：稠密检索（每库 top 50）+ 稀疏 BM25（每库 top 50）→ 分数融合 → 可选 rerank → 最终取 top 5。融合时稠密分全局 min-max 归一化、BM25 分按库内归一化，默认稠密权重 0.9，RRF（k=60）只用于同分时稳定排序，融合候选 20 条；稀疏侧优先每库 FTS5，FTS5 不可用时回退内存 BM25，独立库分数不可比较、只保留库内排名；rerank 失败时跳过重排并使用融合结果。[retrieval/manager.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/knowledge_base/retrieval/manager.py#L64-L193)、[rank_fusion.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/knowledge_base/retrieval/rank_fusion.py#L26-L120)、[sparse_retriever.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/knowledge_base/retrieval/sparse_retriever.py#L35-L182)

分块实现有固定大小、Markdown、递归三种；文档默认分块 512 字符、重叠 50。嵌入模型在建库时固定，换模型需要重建知识库。[分块实现](https://github.com/AstrBotDevs/AstrBot/tree/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/knowledge_base/chunking)、[知识库文档](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/knowledge-base.md)

### 5.2 当前项目现状

群长期记忆是“近期原文 + 模型摘要 + gzip 原文归档 + 按需检索”：检索使用中文双字词和英文词的全文索引，文档已明确“不能保证召回每种同义表达”；默认只注入最多 1200 UTF-8 字节的概览，需要精确事实时由 Agent 通过 `dsh_qq_memory` 查询，查询引用框最多 3072 字节。见 [group-memory.mjs](../../src/channels/qq/group-memory.mjs)、[QQ群长期记忆](../QQ群长期记忆.md)。

### 5.3 适合当前项目的做法

这不是“必须补向量库”的结论。先做离线评估：用固定问题集覆盖同义改写、专有名词、时间/数字、跨摘要事实，比较现有 FTS 与“dense + BM25 + 融合”的召回差异，同时记录注入字节、延迟和模型调用成本；只有确认召回缺口值得投入时才引入嵌入提供方。

若引入，保留现有边界：注入总预算不放大、默认仍只给相关摘要、完整原文仍按需查询、群隔离与历史截止序号不变；嵌入索引按内容摘要和模型版本建立版本号，模型或分块变化必须重建；嵌入不可用时回退现有 FTS，不能因此让普通问答失败。

### 5.4 验收

- 固定样本报告 recall@k、MRR、平均注入字节、查询延迟与失败率；分母包含没有命中的问题，不只统计成功请求。
- 同义改写与原文细节分别评估；不同群、不同时间截止不串；关闭长期记忆时既不检索也不后台建索引。
- 嵌入服务失败回退全文检索并明确记录；索引损坏/版本不支持时报错，不静默覆盖旧库。

## 6. P2 入站节流与处理阶段语义

### 6.1 上游实际实现

AstrBot 的入站管道是固定顺序：唤醒判断 → 白名单 → 会话状态 → **频率限制** → 内容安全 → 预处理 → 插件/LLM 处理 → 结果装饰 → 发送；阶段可以返回异步生成器形成“洋葱模型”，在后续阶段前后各执行一次，任一阶段 `stop_event()` 后停止传播。[stage_order.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/stage_order.py#L3-L13)、[调度器](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/scheduler.py#L38-L83)

频率限制按会话 UMO 做固定窗口：默认 60 秒 30 条，可配置为 `stall`（等到窗口开放再继续）或 `discard`（直接丢弃本次），每个会话有独立锁，避免并发修改窗口队列。[rate_limit_check/stage.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/rate_limit_check/stage.py#L15-L95)、[默认值](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/config/default.py#L95-L99)

唤醒判断集中处理“机器人自己的消息、过期的按钮回调、唤醒前缀、At/AtAll、引用机器人、私聊、插件处理器权限”等条件；内容安全同时检查当前文本和引用文本，拦截时只在被 @/唤醒时回一句固定说明。[waking_check/stage.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/waking_check/stage.py#L69-L279)、[content_safety_check/stage.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/content_safety_check/stage.py#L15-L60)

### 6.2 当前项目现状

出站有统一的发送闸门：账号暂停、dry-run、预算（默认关闭，窗口与条数可配）、安静时段，且按真实分段数计数；入站则有忙时队列/丢弃（私聊按宿主模式、群聊直接丢弃）、接话冷却和按群诊断，但没有按会话的固定窗口节流。见 [send-control.mjs](../../src/channels/shared/send-control.mjs)、[qq-bridge.mjs 忙时处理](../../src/channels/qq/qq-bridge.mjs#L900-L915)、[group-participation.mjs](../../src/channels/qq/group-participation.mjs)。

### 6.3 适合当前项目的做法

入站节流的目的是防消息洪水带来的模型成本与队列膨胀，不是给正常用户加延迟。建议按“机器人 + 会话路由”做固定窗口，计数放在昂贵工作（下载附件、调用判断模型、提交回合）之前：超限时选择“丢弃并回一句简短说明”或按现有忙时队列语义排队，不做不可见的长 `stall`；控制命令、审批/提问答复、`/stop` 按既有权限豁免或优先处理。

不建议为此重写各渠道桥接层。当前项目真正值得补的是**把每个渠道既有的处理顺序与停机原因写清楚并统一命名**（例如 access-denied、context-off、busy-dropped、image-timeout、duplicate、window-expired），让诊断和测试都引用同一组原因；这比引入一套通用管道框架更符合既有“增量包裹、等价接管”的决策。

内容安全是另一件事：上游策略包含关键词与第三方审核服务，它属于产品与合规选择，不能因为“上游有”就默认开启。若要引入，应先明确适用渠道/群、触发后的用户可见语义、是否检查引用文本、以及不把审核失败当作“用户违规”。

### 6.4 验收

- 洪水测试：超限后模型调用次数与队列长度有界；被节流的消息有可计数的原因，不与“忙时丢弃”“判断安静”混淆。
- 控制命令、审批答复、`/stop` 不被普通节流吞掉；不同会话互不影响；窗口参数非法时不静默改写。
- 正常负载下回复延迟无可见变化；节流计数在面板可查看且不包含消息正文。
- 若暂不实现内容安全，明确记录为未启用，不把平台侧过滤当作本项目已实现。

## 7. P2 媒体引用与转码契约

### 7.1 上游实际实现

上游把媒体引用统一成 `MediaResolver`：接受本地路径、`file://`、HTTP(S)、`base64://`、data URI 和旧式裸 base64；按媒体类型做魔数识别与转码（音频默认 WAV，可指定 `tencent_silk` 等目标格式；图片可规范化 JPEG），临时文件由调用方获取所有权并清理；对“文件尚未落地”的平台竞态保留原路径交给上游重试，而不是立即失败。[MediaResolver](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/media_utils.py#L657-L760)、[竞态注释](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/media_utils.py#L1688-L1708)

消息组件也按媒体类型分开：`Image`、`Record`、`Video`、`File`、`Reply`、`Forward` 等各自带 `fromURL`/`fromFileSystem`/`fromBase64` 转换入口，平台适配器只负责把统一组件落到平台 API。[components.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/message/components.py#L270-L300)、[File 组件](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/message/components.py#L905)

### 7.2 当前项目现状

当前项目按用途分散实现：图片输入有格式/大小/张数策略并会压缩模型副本；普通文件入站原样写入工作区；出站产物有独立快照、摘要与交付回执；QQ 图片下载有 5 秒共享预算与超时丢弃；飞书语音有独立合成与转码。见 [image-input.mjs](../../src/channels/shared/image-input.mjs)、[inbound-file.mjs](../../src/channels/shared/inbound-file.mjs)、[artifact.mjs](../../src/channels/shared/semantic/artifact.mjs)、[QQ群聊自主参与：图片下载超时](../QQ群聊自主参与.md)。

这些实现解决的是不同问题（不可信入站 vs 受信出站 vs 呈现转码），不能简单合并成“一个媒体工具”。当前没有的是**统一的引用形式与转码语义说明**：哪些输入形式允许、用什么判断类型、每个渠道目标格式是什么、临时文件谁负责清理、竞态时重试还是报错。

### 7.3 适合当前项目的做法

先写一份小契约并在现有实现上对齐，不立即重构：

- 引用形式允许列表：本地路径、URL、base64/data URI 分别由哪些路径接受，各自的大小/超时/重定向上限；
- 类型识别：优先魔数，其次 MIME/扩展名；未知类型保持“未知/文件”，不猜成图片；
- 目标格式：每个渠道发送语音/图片/文件时需要什么格式，由适配器声明，不把“SDK 有这个方法”当作平台已支持；
- 临时文件：创建者负责清理，失败/取消也要清理；发送期间不得被清理；
- 竞态与重试：文件尚未可读时是短暂重试还是明确失败，不得把“路径存在”当作“内容可发送”。

只有在真实缺陷样本证明重复实现带来维护问题时，再考虑抽取共享解析器；抽取时保留入站与出站的信任边界，不把不可信下载内容直接进入受信产物 registry。

### 7.4 验收

- 同一附件在当前消息、引用、近期背景、判断输入、回复和面板中的类型与来源一致；`content_type=file` 的真实图片、无扩展名 URL、失效链接、纯图片引用各有覆盖。
- 超出大小/超时/重定向上限时保持明确失败或既有回退；临时文件在成功、失败、取消后都不残留。
- 渠道目标格式变化时只需改适配器声明，不修改公共判定；未知格式明确报错，不发送后才声称成功。

## 8. P2 工程治理：贡献契约、发布自动化与启动冒烟

### 8.1 上游实际实现

- **贡献契约**：`AGENTS.md` 规定 conventional commits、KISS/第一性原理、避免无必要 helper、Google 风格 docstring、WebUI 导航变更需同 PR 更新中英文文档与旧入口映射、发布使用短生命周期 `release/*` 分支并先验证后打 tag。[AGENTS.md](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/AGENTS.md#L49-L125)
- **变更记录与发布**：`changelogs/` 有 211 个版本文件加 `unreleased.md`；`prepare_release.py` 一条命令更新 `pyproject.toml` 与包内版本、按 conventional commits 生成 changelog、运行必需检查，可选构建面板、提交并推送，失败时关闭退出。[prepare_release.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/scripts/prepare_release.py#L151-L432)、[changelogs](https://github.com/AstrBotDevs/AstrBot/tree/c441c660d21ff124c1eef0b85c3802ed483b5d71/changelogs)
- **CI 门禁**：12 个 workflow，包括覆盖率测试 + Codecov、3 操作系统 × 5 Python 版本的启动冒烟、安装脚本在 Windows PowerShell 5.1/pwsh 与 macOS/Ubuntu 上的测试、固定版本 ruff 格式检查、CodeQL、面板 CI（`i18n:check`、typecheck、build）。[workflows](https://github.com/AstrBotDevs/AstrBot/tree/c441c660d21ff124c1eef0b85c3802ed483b5d71/.github/workflows)
- **前后端契约**：面板 API 客户端由 `openspec/openapi-v1.yaml` 生成，`generate:api` 重新生成；`i18n:check` 校验多语言 key。[dashboard/package.json](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/dashboard/package.json)

### 8.2 当前项目现状

当前项目的工程基础并不弱：`npm run check` 串起构建、282 个测试文件和发布包校验；CI 有 Linux 全量检查与 Windows 工作区专项；`scripts/verify-*.mjs` 会用真实 DSH CLI 验证注入上下文、LAN 管理、界面语言和模型设置；`test/channels/shared/i18n.test.mjs` 已校验中英字典覆盖、占位符一致、重复 key 和源码字面量覆盖；CHANGELOG 遵循 Keep a Changelog 与 SemVer。见 [package.json](../../package.json)、[CI](../../.github/workflows/ci.yml)、[i18n 测试](../../test/channels/shared/i18n.test.mjs)。

相对缺少的是：没有 `AGENTS.md` 这类贡献契约；版本号与 CHANGELOG 仍需手工同步；没有“安装后在干净 DSH Home 里能启动并加载插件”的冒烟检查；发布流程没有脚本化。这些是低成本、低风险的补齐项，不应替换现有更强的真实宿主验证。

### 8.3 适合当前项目的做法

1. 新增根目录 `AGENTS.md`（或等价文件）：提交信息格式、文档同步要求、验证命令、禁止事项（不复制 AGPL 代码、不删既有能力）、发布分支与 tag 纪律。
2. 新增 `scripts/prepare-release.mjs`：校验工作树干净、更新 `package.json` 版本、检查 CHANGELOG 是否有对应条目、执行 `npm run check`、打印手动发布步骤；默认不自动 commit/push，失败即停。
3. 增加启动冒烟：在临时 DSH Home 中安装/链接当前构建，启动 CLI，断言插件被加载、管理页可访问、至少一个 RPC 可用；不连接真实平台，不读凭据。
4. 评估把现有 `verify-*` 中的非平台部分纳入 CI（需要 DSH 包时显式跳过并说明），避免“本地能跑、CI 不跑”。
5. 若 RPC 面继续增长，再引入契约文件与生成式客户端；当前阶段不必为了对齐上游而重写手写客户端。

### 8.4 验收

- 发布脚本在干净工作区可重复执行；版本/CHANGELOG 不一致时失败并说明；不产生额外提交。
- 启动冒烟在 CI 中稳定通过且耗时可控；失败信息能定位是加载、构建还是 RPC 问题。
- `AGENTS.md` 的规则能在 PR review 中执行，且与现有 `npm run check`、文档目录结构一致，不引入重复规范。

## 9. P2 备份、恢复与状态版本迁移

### 9.1 上游实际实现

AstrBot 的备份导出为 ZIP：带清单版本号，逐文件记录校验和；内容包括主数据库各表、知识库元数据/文档/索引/媒体、配置、附件和目录；有配套导入器和共享常量，避免导入/导出两端字段漂移。[exporter.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/backup/exporter.py#L39-L147)、[备份常量](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/backup/constants.py#L1-L80)

数据库迁移用“旧库存在 + 偏好标记未完成”双重条件判断是否需要迁移，按顺序执行会话、人格、WebChat、偏好、平台统计等迁移，全部成功后才写入完成标记。[migration/helper.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/db/migration/helper.py#L17-L70)

### 9.2 当前项目现状

当前项目把配置与状态保存为每机器人 JSON（含配置版本与损坏恢复逻辑），群记忆为独立 SQLite，贴纸有本地缓存目录，交付目标与会话绑定在配置里；更新服务只保留当前 profile 的安装清单备份，没有面向用户的导出/导入。见 [config-store.mjs](../../src/channels/qq/config-store.mjs)、[state-store.mjs](../../src/channels/qq/state-store.mjs)、[update-service.mjs](../../plugin-src/host/update-service.mjs)、[更新说明](../checking-and-installing-updates.md)。

### 9.3 适合当前项目的做法

设计“导出包 v1”：清单（版本、导出时间、插件/Host 版本、各文件校验和）、机器人配置（凭据只保留引用，不复制密钥）、会话绑定、交付目标、别名、贴纸索引、群记忆数据库（可选）。导入时先校验清单与版本，再逐项校验字段；版本不兼容、校验和不符、字段非法时整体拒绝并保留原数据，不静默覆盖；明确“合并”还是“覆盖”的语义，并提供回滚。

SQLite 备份要提示先停止对应机器人或 Host，避免只复制主文件漏掉 `-wal`/`-shm`；这与现有群记忆文档的说明一致。凭据始终由宿主凭据库持有，导出包中只出现引用标识。

### 9.4 验收

- 在全新 DSH Home 导入导出包后，机器人列表、绑定、交付目标、别名和群记忆可恢复；不包含明文 token。
- 损坏 ZIP、缺文件、校验和不符、版本不兼容分别明确拒绝；拒绝后原数据不变。
- 导入过程中断可重试或回滚；已存在的目标冲突有明确策略；文档写明备份前停止时机。

## 10. P3 交互回调 token 与过期语义

### 10.1 上游实际实现

AstrBot 把按钮回调数据压缩成平台可承载的哈希 token：payload 含动作标识、数据和绝对过期时间，token 由 payload 哈希得到；注册表同时存内存和 SQLite，回调解析时校验过期，过期则发送固定“按钮已过期，请重新发起操作”的提示。[button_interaction.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/platform/button_interaction.py#L15-L130)、[过期处理](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/pipeline/waking_check/stage.py#L85-L95)

### 10.2 当前项目现状

当前项目的交互闭环已经比较完整：提问卡被回答后会整卡替换为已答状态卡，菜单过期会提示重新打开，审批/提问由宿主侧负责重放去重与跨端解决。见 [feishu-cards.mjs 已答状态卡](../../src/channels/feishu/feishu-cards.mjs#L1338)、[bridge.mjs 过期菜单](../../src/channels/feishu/bridge.mjs#L2353-L2360)、[群聊上下文：已答状态卡](../../CONTEXT.md)。

因此这一项不需要为了“学 AstrBot”而在插件内重建回调状态机；只有两种情况值得参考：dsh-im 自有的回调（如菜单 token、猜成语、面板操作）遇到平台回调载荷上限，或需要跨插件重启保持回调有效。届时可采用“紧凑 token + 过期时间 + 过期提示”，并把状态绑定到会话与 actor，禁止跨聊天复用。

### 10.3 验收

- 过期回调只提示一次，不执行动作；伪造/未知 token 不泄露内部数据。
- 重启后回调要么确定性失效，要么可恢复；同一 token 不被其他聊天或机器人使用。
- 回调状态机仍以宿主审批/提问为主，不出现两套互相竞争的答案提交路径。

## 11. 边界与明确不照搬

| 上游做法/线索 | 为什么不在 dsh-im 复制 | 当前项目对应 |
|---|---|---|
| Agent 循环、工具执行、上下文压缩、重复工具调用防护 | 这些在 DSH 宿主内，插件不应复制一套。AstrBot 自己的执行器抽象也说明“Agent 循环”和“聊天提供方”是两层。 | `/compact`、宿主工具守卫、DSH 会话历史；插件只做呈现与路由。[执行器说明](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/agent-runner.md#L19-L34)、[上下文压缩](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/context-compress.md#L41-L47) |
| 模型提供方自动回退 | 当前项目已明确决定不为模型失效增加自动降级，保留用户显式 `/model` 恢复；照搬会改变错误语义与用户预期。 | [Issue #192 修复记录](Issue-192-模型失效自救修复与飞书实测.md) |
| Skills/MCP 管理、沙盒与电脑权限矩阵 | 技能发现、MCP 连接、工具权限与沙盒属于宿主域；AstrBot 的本机隔离依赖 Seatbelt/bwrap，第三方沙箱需要额外部署，不能把插件包装成“沙盒”。 | DSH Skills、宿主审批/沙箱、QQ owner 工具守卫。[QQ电脑命令权限](../QQ电脑命令权限.md)、[AstrBot 沙盒文档](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/docs/zh/use/astrbot-agent-sandbox.md#L9-L22) |
| 定时任务与 `future_task` | 本机 DSH 安装包含 `@deepseek-ai/dsh-schedule`（可选实验 bundle，需在 profile 中启用）：支持一次性、间隔、每日、每周、五段 cron，任务持久化并作为原 Session 的后续消息投递；当前项目已识别 `schedule` 来源事件并参与会话同步。再建一套插件调度器会形成两个真相源。 | [session-sync-coordinator.mjs](../../plugin-src/host/session-sync-coordinator.mjs#L26-L135)、[主动投递：定时任务同步](../../PROACTIVE_DELIVERY.md) |
| 概率触发主动接话（`active_reply`） | 上游默认按概率 + 白名单决定是否接话；当前项目已经用独立无工具判断器做语义完整性判断，不应倒退为概率抽样。 | [QQ群聊自主参与](../QQ群聊自主参与.md) |
| 插件市场、配置 schema 自动生成 UI、多配置文件、ChatUI、OpenAPI 服务 | 这些是“平台型产品”的形态；dsh-im 是宿主插件，已有按机器人手写的复杂设置界面，schema 化会降低表达力。只有交付 HTTP 若未来走出本机，才值得参考其 API Key + scope 模型。 | [README：界面与设置](../../README.md)、[主动投递：HTTP 无鉴权说明](../../PROACTIVE_DELIVERY.md) |
| 默认开启的匿名指标上报 | AstrBot 默认向远端上报版本、OS、Python、主机名、安装 ID 等（可配置关闭）；当前项目明确不建设遥测，不应复制。 | 本仓库无遥测；诊断信息只在本机面板。[metrics.py](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/utils/metrics.py#L190-L215)、[默认配置](https://github.com/AstrBotDevs/AstrBot/blob/c441c660d21ff124c1eef0b85c3802ed483b5d71/astrbot/core/config/default.py#L328) |
| 内容安全审核（关键词/第三方服务） | 属于产品与合规选择，涉及群规、地域和第三方数据流向；不能因为上游有就默认启用，也不能把审核失败当作“用户违规”。 | 当前未内置，由平台能力与访问策略承担；如需要应单独设计。 |
| 群聊强制按用户隔离会话（`unique_session`） | 当前项目用群共享 Session + 线程/私聊绑定表达场景；增加隐式隔离会改变既有会话语义与记忆范围。 | [Discord Thread、私聊同步等既有能力](../../PROACTIVE_DELIVERY.md)、[访问模式](../访问模式.md) |
| 直接复制 AGPL 代码或依赖 | AstrBot 为 AGPL-3.0-or-later，当前项目为 MIT；复制代码会带来许可证冲突。`pysilk`/`silk-python` 等依赖也需单独核验许可证与维护状态。 | 只借鉴思路与契约；代码自行实现或选择许可兼容的依赖。 |

## 12. 复用前的证据与实施要求

- **版本快照**：本文只对 `v4.29.3`/`c441c660` 负责。上游行为随版本变化，后续引用需重新核验，不能把本文结论当作长期 API 契约。
- **宿主边界先核验**：任何与 DSH 能力重叠的设计（定时任务、上下文压缩、工具授权、Skill、沙箱）先确认当前安装的 DSH 版本是否已提供、语义是否一致；优先使用宿主能力，不复制。
- **平台能力必须实测**：SILK/语音格式、回调载荷、被动回复窗口、主动消息配额等，只能以当前账号真机结果为准；本文引用的是上游源码事实，不是 QQ 平台承诺。
- **不缩小既有预算与语义**：混合检索不得扩大默认注入、入站节流不得吞掉控制命令、轨迹不得记录消息正文、备份不得导出凭据。
- **每项独立闭环**：先选一项形成“实现 + 自动化回归 + 真实账号验收 + 可回滚”的闭合改动，再进入下一项。建议顺序：逐条轨迹 → 空 @ 等待 → 语音编码核验；之后按评估结果决定混合检索、入站节流、媒体契约、工程治理与备份。
- **许可证**：只借鉴设计与契约；若确需引入上游代码或依赖，先做许可证兼容评估并更新 `THIRD_PARTY_NOTICES.md`。

本报告完成范围是源码对照与建议文档。尚未验证 AstrBot 的实际运行效果，未验证其知识库检索质量、语音发送真机效果、定时任务投递范围与诊断包导出行为在 dsh-im 环境中的可复现性，也没有实施任何功能、修改配置或部署。
