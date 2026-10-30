# dsh-qqbot 对当前 dsh-im 项目的可借鉴内容

> 调研日期：2026-10-29。本次补充：熟识度、好感度、文件去重与 token 优化。参考仓库：[zaofan-make/dsh-qqbot](https://github.com/zaofan-make/dsh-qqbot)，继续采用已核验快照 `1.11.16`，提交 `665852399e798aebc1ea00c54278b3c52ca41181`；不是重新拉取后的“最新版本”声明。本文中的上游链接均固定到该提交。
>
> 当前项目：`@xmanrui/dsh-im` `4.38.1`，基于本机当前工作区阅读；本地 HEAD 为 `91e8e0a46d05a1ba72b53653f33804a2b076f62c`，包含尚未提交的本地实现，不能把 HEAD 单独视为本文所有现状的版本快照。
>
> 方法：静态阅读源代码、测试、扩展契约及当前项目对应实现。未执行上游代码、安装依赖、运行上游测试或进行 QQ 实测；不宣称其 README 中的准确率、速度、稳定性已经复现。本文只形成分析与后续建议，没有实施功能、变更配置或部署。

## 1. 结论与建议顺序

这个仓库最值得借鉴的是围绕 QQ 的运维与产品细节：把机器人为什么不回、文件有没有送达、表情如何入库和淘汰、扩展如何卸载等问题变得可检查。当前项目已经具备群上下文、主动接话、图片处理、长期记忆检索、本地表情缓存、联网搜索和 owner 工具限制，不适合以“迁移整套 QQ 插件”为目标。

| 优先级 | 可借鉴方向 | 当前项目现状 | 建议的增量 |
|---|---|---|---|
| P1 | 逐条决策与发送记录 | 有接话统计、错误状态及发送回执 | 用同一消息标识关联判断、等待、进入原群 Session、工具、QQ 发送结果和耗时 |
| P1 | 表情库生命周期与近期使用记录 | 已有内容摘要校验、本地缓存、缺失记录、空闲补库 | 增加可视化整理、屏蔽/恢复、按群近期使用信息，让模型更容易避免重复 |
| P1 | 结构化交付物事件对接 | 已有可信 artifact 注册和交付链路 | 先核验宿主 `present` 事件兼容，再适配到现有 registry，避免声明了文件却漏发 |
| P1 | 文件去重与重复投递控制 | 表情缓存已有 SHA-256 文件名；artifact 有摘要及独立交付身份 | 区分存储、近似图片、消息事件与投递去重；同轮重复声明关联同一交付状态 |
| P1 | 减少模型输入及无效调用 | 已有群上下文字节预算、记忆按需查、独立无工具判断器 | 优先减少重复上下文、无关工具 schema、冗长工具结果；长引用可按需取全文 |
| P2 | 熟识度、好感度与群友小传 | 已有人格及群记忆，尚未发现独立的关系数值台账 | 分开记录熟悉程度、相处态度和有来源的关系事实，只向当前回复提供简短相关状态 |
| P2 | 语音的格式转换与播放 | QQ 语音输出仅有计划；飞书已有独立语音实现 | 把“合成、格式转换、QQ 发送、面板播放”分层，借鉴其中格式适配部分 |
| P2 | 附件统一分类 | 图片已有 MIME/文件名识别；不同上下文路径存在各自分类 | 用真实异常样本检验是否需要统一，减少图片被误当文件 |
| P2 | 记忆可管理性、身份可见性 | 记忆已按需检索；电脑操作 owner 已强制校验 | 提供记忆查看/删除、owner 状态及配置入口，保留现有后端边界 |
| P3 | 扩展契约、质量评估 | 已有宿主工具、频道适配及测试 | 借鉴契约和验收方法；有明确扩展需求再建设扩展点 |

优先级是本次分析建议，不代表用户已同意这些功能的具体实现或参数。以下每项分别给出证据与验收条件。

### 集成进度（逐项验收）

第一项选择熟识度：代码、设置界面和回归已完成，已部署并启用，等待用户实群测试；详细行为和数据范围见 [QQ熟识度](../QQ熟识度.md)。好感度、文件去重、其他 token 优化等仍为待集成项，不在用户确认本项之前继续。以下“当前现状”保留调研快照语义，熟识度新增能力以该实施文档为准。

## 2. 最优先：让一次接话有可追踪的过程

### 上游有哪些实际实现

`appendScoreLog` 将评分相关记录写入 JSONL，并按文件大小和行数滚动；设置界面提供诊断日志开关和最近评分视图。可借鉴的是**逐条记录和可查看的判定依据**，这与是否采用 KNN 评分或关系状态是独立选择；熟识度和好感度单列讨论。[评分日志源码](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/value-score.ts#L180-L216)、[诊断设置](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/client/qqbot-settings.js#L378-L381)、[最近评分视图](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/client/qqbot-settings.js#L3200-L3237)。

当前 [group-participation.mjs](../../src/channels/qq/group-participation.mjs) 已区分 `candidates/declined/replied/waiting/skipped/errors`，不能说“没有日志”。但这些累计值不足以单独回答用户此前遇到的“这一条是没收到、没判断、认为没说完、没有进入同一 Session，还是 QQ 发送失败”。

### 适合当前项目的做法

为接话候选生成关联记录，覆盖消息 ID、群会话键、判断模型、判断结果、实际 Session、判断/生成/发送阶段时间以及最终回执。普通运行只记录必要标识、结果和时长；需要全文的诊断由显式设置控制。把 `wait`、忙时丢弃、模型拒答、失败、发送结果未知分开显示，避免统称“发送失败”。这些是建议字段，尚未实现。

不记录或向群里转发原始思考过程。上游另有把 reasoning 增量交给扩展的总线，这与排错所需的决策状态是两回事。[reasoning-bus.ts](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/reasoning-bus.ts#L1-L26)。

**验收：**在同一组测试中分别制造“不需回应、等待补充、忙时丢弃、正常发送、确定发送失败、发送结果未知”，从面板一条记录能定位阶段；失败和未知不能计为成功。以端到端样本衡量回复延迟，报告失败及超时分母，不能只统计成功请求。

## 3. 表情包：从“有缓存”升级为“可整理、可选得更准”

### 上游可借鉴的三个设计

1. **生命周期。** 表情记录有 `candidate/library/negative/trash` 分层，以及标签、说明、来源、使用次数、待描述状态、回收时间和还原前层级；界面存在“待整理、收藏、回收站”等操作。这有利于把不合适的图排除出搜索，同时保留恢复入口。[数据结构](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-store.ts#L94-L141)、[管理界面](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/client/qqbot-settings.js#L1512-L1541)。
2. **精确与近似重复分开。** SHA1 识别相同字节，dHash 识别画面结构近似的图片；还提供小批量后台回填。近似判断是启发式，不能等同于“证明是同一张图”。[dHash 实现与依赖处理](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-store.ts#L34-L80)、[近似查询与回填](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-store.ts#L742-L764)。
3. **发送成功后更新使用记录。** 出站闸门提供 `checkMedia` 与 `noteSent`，后者用于成功后的发送窗口、预算、去重和流水更新，避免失败消耗“已用过”的额度。[checkMedia/noteSent](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-gate.ts#L236-L307)。

当前 [sticker-catalog.mjs](../../src/channels/qq/sticker-catalog.mjs) 已校验缓存内容摘要及来源；[sticker-misses.mjs](../../src/channels/qq/sticker-misses.mjs) 已支持缺失持久记录、回复后空闲补库。**内容完整性校验与“最近在这个群发过什么”解决的是不同问题。** 当前没有在这些模块中发现同等的收藏/回收站管理与按群近期使用筛选。

建议先增加标签/说明编辑、屏蔽/恢复、缓存状态查看和近期使用元数据。近期重复先作为模型选择的提示或候选排序依据；用户明确要求重发同一张时应能重发。若以后需要硬性去重，再单独确定范围和例外。上游 `used` 以本地路径为键，不能直接当成已经按群隔离的去重设计照搬。

图片近似聚类可放在空闲维护环节，先展示“疑似重复”供整理；不同文字但版式相同的梗图不应被自动合并或删除。上游源码注明其 `sharp` 路径曾出现兼容问题，因此不能把“宿主可能已安装”当成当前项目稳定可用的依赖契约。

**验收：**群回复全程禁止联网取图，缓存未命中时文字正常发出，缺失任务之后空闲执行；屏蔽图不再出现在候选、恢复后可用；确定发送失败不计入已发送，结果未知单独保留；同图多格式和同模板不同文案都在测试样本内。批量索引耗时不得挤占当前回复路径。

不建议因为上游支持群图收集就自动收录所有群图片。本次需求是分析；扩大采集范围需要另行确认具体范围。

## 4. 文件交付：借鉴宿主事件适配，保留现有可信链路

上游监听 `deliverables/presented`，将 `present` 声明的文件交给统一媒体 sender，单文件失败时继续处理其他文件并给出文字通知。其契约说明事件先于 `turn/end`，文件按引用交付，读取发生在发送时；相应测试覆盖 `turn/callId/files` 的解析和正文媒体标记去重。[交付器](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/deliverables.ts#L1-L87)、[契约与去重测试](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/deliverables.test.ts#L1-L89)。

当前已有 [artifact.mjs](../../src/channels/shared/semantic/artifact.mjs) 和 [artifact-delivery.mjs](../../src/channels/shared/semantic/artifact-delivery.mjs)，处理文件注册、物化、发送和结果未知等状态。它们是值得保留的基础，不是缺口。当前源码检索未发现 `deliverables/presented` 对应处理；这只是对接缺口线索，**尚未核验本机宿主是否提供相同版本、相同语义的事件**。

建议先用当前安装的 DSH 核验真实事件顺序、会话及轮次标识、失败语义，再把可信事件适配到现有 registry。不要绕过当前快照/来源验证，直接照上游按路径发送；也不要从模型普通正文提取文件路径代替可信声明。

**验收：**当前轮 `present` 声明的允许文件到达当前 QQ 会话且只发送一次；跨会话、跨轮、重复事件不串发；声明后文件变化、单文件失败、外层轮次失败、结果未知有明确记录。上游“事件优先到达”的注释不能替代本机验证。

## 5. 语音：可参考格式适配，不能把它当作 TTS 实现

上游有两类不同能力：

- `send_media(kind=voice, source=...)` 发送已有音频文件或 URL，不负责把文本合成语音。[工具定义](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L498-L505)。
- 面板 `/chat/voice-play` 下载 QQ SILK，调用 `silk-wasm` 解码与 `lamejs-fixed` 编码，缓存 MP3 供浏览器播放。这是**收到的语音播放**，不是 DeepSeek 回复的官方朗读，也不是文本转语音。[播放路由](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/settings-host.js#L4944-L4970)、[转换实现](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/voice-convert.mjs#L1-L42)。

因此，不能据此断言能复用 DeepSeek 官方朗读、无需语音服务、不会新建网页会话，或生成的任意音频都能作为 QQ 原生语音发送。所读实现并没有证明这些事情。

当前 QQ 仍遵循 [QQ大肥鱼语音输出计划.md](QQ大肥鱼语音输出计划.md)，用户此前要求先规划；本次也不实现。后续设计可以拆为“本轮最终文本 → TTS 提供者 → QQ 所需编码 → 原生语音发送 → 回执”，面板播放是另一个消费端。当前 [飞书 voice.mjs](../../src/channels/feishu/voice.mjs) 已有 TTS、凭据注入和转码模块，比整套引入 QQ fork 更适合先抽取可共享边界，但飞书编码不能直接视为 QQ 支持格式。

**验收：**文字和音频来自同一次真实回答，朗读不会另开一个推理会话；合成、转换、上传、QQ 接收、客户端可播放分别验证；音频失败不把已有文字回复改成失败。具体模型、声音、费用及默认触发方式留给后续语音需求确定。

## 6. 附件归一化：学习“同一份分类供所有路径使用”

上游集中实现 `inferMediaKind`，综合 MIME、扩展名、尺寸与 QQ URL 特征，供入站与历史呈现使用。代码注释记载了 QQ 将部分图片/视频标成 `file` 的故障；这是上游记录的环境样本，不代表本机已复现。[媒体分类实现](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/media-kind.ts#L1-L77)。

当前 [qq-bridge.mjs](../../src/channels/qq/qq-bridge.mjs) 的 `isQqImageAttachment` 已识别 MIME 与图片文件名，不能说完全不识图；引用附件的 `qqAttachmentKind` 则主要依据 MIME。可以先用当前 SDK 返回的真实附件样本检查各处一致性，确认存在差异后再归并分类。

不建议把上游硬编码的 URL appid 和“有宽高就是图片”当成平台长期保证。外部启发式应保留判定来源，未知类型仍需显示为未知/文件，不能捏造已识图。

**验收：**同一附件在当前消息、背景缓存、引用、接话判断、实际回复和面板中类型一致；覆盖 `content_type=file` 的真实图片、无扩展名 URL、纯图片引用和失效链接。模型不具备视觉能力时，提供带来源标记的图片描述或明确失败，不能只塞 URL 后声称它看到了图片。

## 7. 记忆与 owner：借鉴管理体验，保留当前机制

### 7.1 记忆的查看、编辑、删除

上游 `context-memo` 将会话备忘独立存放，提供增删改查和注入上限；源码目前有条数、单条长度及总注入字符限制，不能按其文件开头“越聊越厚”的描述推断是无上限。[备忘配置](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/context-memo.ts#L23-L42)、[注入选择](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/context-memo.ts#L143-L159)。

可学习的是**用户能看到和纠正记忆**。当前 [group-memory.mjs](../../src/channels/qq/group-memory.mjs) 已有压缩原文、FTS 检索和摘要：`overview()` 的整个注入框限制在 1200 字节内，再通过 `dsh_qq_memory` 按需查询。没必要再叠一套每轮注入的 system 备忘。群消息、摘要与图片描述应继续标为来源数据，不能因为存久了而变成人格指令。

**验收：**在已有开关控制下查看/删除当前群的记忆，不跨群；删除后检索与总览一致；关闭长期记忆时不自动开启或补采集；历史规模增大不会突破注入预算。本文不改变当前开关状态，也不读取私有群记忆验证内容。

### 7.2 owner 的状态和设置

上游扩展能力有 `user.isOwner`，其 `restart()` 默认在执行处拒绝非 owner；但调用方可传 `requireOwner: false` 关闭这项检查，因此只能借鉴身份传递和执行处判断，不能把它直接当作当前项目所需的强制权限边界。[restart 执行逻辑](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/ext-capabilities.ts#L656-L667)。其群管理工具组的源码仍注明危险写操作依赖描述约束、owners 接入留待后续；所读 `group_mute_member.execute` 函数内也未见执行者 owner 校验。这是对应工具路径的静态发现，不代表已完成对整个上游的权限审计。[工具组注释](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L1140-L1147)、[禁言工具执行路径](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L2424-L2445)。

当前 [computer-command-policy.mjs](../../plugin-src/host/channels/qq/computer-command-policy.mjs) 已在工具执行层限制非 owner；[QQ电脑命令权限.md](../QQ电脑命令权限.md) 记录了群/私聊身份映射、重绑定行为及尚无独立 UI 字段。建议补界面展示当前绑定及校验状态，让 owner 不必手改配置；新 UI 仍调用现有配置校验与工具策略，不把授权转交给模型或人格提示。

**验收：**群身份与私聊身份分别验证；非 owner 用普通话、提示注入、工具间接调用都不能执行本机操作；重绑定保留/清理规则与后端一致；读取界面不泄露密钥。不能把“群成员允许聊天”变成“群成员允许运行电脑命令”。

## 8. 扩展与评估：先借鉴契约，不急着增加平台

上游把工具、命令、卡片、启动钩子、入站中间件统一到能力包，并规定适用时机；启动钩子有结果状态、超时与逆序清理契约。值得借鉴的是显式输入、当前会话、可用能力、状态及资源生命周期。[扩展契约](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/docs/extension-contract.md#L9-L45)、[钩子契约](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/ext-hooks.ts#L11-L36)。

但这不是隔离沙箱：上游扩展可获得宿主 Context、配置甚至 appSecret，钩子超时也不会取消仍在运行的 Promise。当前若以后提供第三方扩展，需要明确它是 owner 安装的可信本机代码；不要把“能加载 mjs”包装成群友可安全提交代码。优先复用 DSH 已有插件/工具接口，出现真实需求后再做最小扩展。

上游质量测试把准确率和判定覆盖率一起检查，提醒“结构测试绿了不等于模型效果好”。这适合用于我们的主动接话、语义完整性和表情选择评估。不过它在模型全弃权时直接返回，所以全绿不能证明模型可用；注释给出的准确率也没有在本次复现。[质量测试源码](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/classify-accuracy.test.ts#L1-L14)、[实际检查与全弃权分支](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/classify-accuracy.test.ts#L49-L66)。

当前已有 [语义接话测试](../../test/channels/qq/semantic-participation.test.mjs) 和 [同句不同语境样本](../../test/fixtures/qq/contextual-participation.json)，应在其上补真实模型评估，不另起一套重复样本。覆盖同一句在不同上下文的 `reply/wait/decline`、上一条机器人回答、引用、图片和群友互聊，分别报告误插话、漏接话、等待、失败和模型不可用。

**验收：**契约与消费者一致，热重载后不重复注册；超时任务标记为超时而非已终止；评估固定样本和配置，模型不可用显示为未验证，不能算通过；质量与延迟同时观察。

## 9. 文件去重：分别处理“重复存、重复看、重复发”

### 9.1 上游实现的范围与边界

| 类别 | 上游实际依据 | 可借鉴内容及限制 |
|---|---|---|
| 精确内容去重 | 表情 `capture()` 下载并检查图片魔数，计算完整 SHA1，使用前 12 位作为记录 ID；命中后刷新 `lastSeenAt` | 同内容不反复建库、打标。它针对图片，不是任意 PDF/音频/压缩包的通用文件存储；短 ID 命中也不等于已再次比较完整摘要 |
| 近似图片检索 | `findByDHash()` 比较感知哈希，默认距离候选值为 5；旧图可后台补算 | 用于疑似重复整理、寻找描述或候选，不能证明文字/OCR、动画帧或细节相同，不能替代完整性校验 |
| URL 与本地文件映射 | 保存 URL→路径及图片来源索引；存在 `findByFileId()` 查询 | 不用每次把长临时 URL 重新放入上下文；不把临时 URL 或注释声称稳定的 fileid 当内容身份的唯一依据 |
| 同轮跨出口去重 | `present` 路径登记后，删除正文相同路径的 `[MEDIA:file|…]` 标记 | 学习统一出口和交付关联；不是内容哈希去重，也没有因此证明重复事件、换路径同内容、发送失败均已正确处理 |

依据：[图片入库与 ID](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-store.ts#L321-L370)、[fileid 与 dHash 查询](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/sticker-store.ts#L729-L779)、[URL 缓存](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/image-path-cache.ts#L1-L80)、[跨出口路径过滤](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/outbound.ts#L700-L738)。

一个需要修正后再借鉴的细节：上游 `onDeliverables()` **先把所有路径登记到 `deliveredFiles`，再异步调用实际投递**。这个集合更准确地表示“已经由 present 路径接管”，不能直接解读为 QQ 已发送成功；照抄会混淆去重和成功判定。[执行顺序](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/outbound.ts#L458-L483)。

### 9.2 当前项目可以如何吸收

当前 [sticker-catalog.mjs](../../src/channels/qq/sticker-catalog.mjs) 已以 `SHA-256 + 扩展名` 保存缓存，并校验完整摘要，不能把精确去重列成全新能力。[artifact.mjs](../../src/channels/shared/semantic/artifact.mjs) 每次登记建立文件快照、完整摘要、独立 `artifactId/deliveryKey`；**摘要校验不自动意味着不同调用的同内容会合并**。现有 [group-context.mjs](../../src/channels/qq/group-context.mjs) 还按消息 ID 避免同一条背景消息重复入缓冲，这属于消息去重。

建议沿现有链路增加以下能力，均为待实施设计：

- **存储层：**相同完整内容可共用物理文件，但保留各自来源、逻辑记录和授权范围。若以后扩展到普通文件，使用完整摘要及尺寸确认，不按文件名/路径判断相同；清理须等待所有快照引用释放，不能删掉另一条正在发送的文件。
- **模型层：**已识别图片可复用描述，缓存键包含内容摘要、视觉模型和描述任务版本；这部分是建议，未在当前图片记忆链路发现同等的跨消息内容缓存。相同图片在新问题下仍可重新看细节，不把一份旧描述当作所有问题的答案。首次处理、命中、失效、失败分别记账。
- **交付层：**在同一 bot、接收目标、Session、Turn 和同一交付意图内，把重复工具调用/事件关联到同一交付状态；`pending/sent/failed/unknown` 分开。`pending` 合并等待，`sent` 复用回执，确定失败依既定策略处理，`unknown` 不自动再发。用户明确要求再发、另一群请求同文件、下一轮的新交付仍是合法请求，不能被全局内容去重吞掉。

**验收：**同内容不同文件名只减少重复存储，不删除独立来源；同路径内容修改应形成新快照；重复事件只发一次；不同群/新轮次/明确重发仍可发送；动画与静态图、同版式不同文案不误合并；取消、未知发送结果和并发清理不导致丢文件或盲目重发。磁盘、网络请求、视觉模型调用、QQ 发送次数分别统计，不能把节省磁盘直接算成省 token。

## 10. 仓库中可学习的省 token 方法

### 10.1 先省掉重复和无关内容

| 方法 | 上游实现证据 | 对当前项目的借鉴方式 |
|---|---|---|
| 工具按需可见 | `gain_qq_tools` 支持 list/search/enable/disable；列表返回名称和短描述；`applyExtToolVisibility()` 根据当前实例和领取集合设置 deny | 学习按会话/任务暴露必要 schema。注册表里有工具，不代表一定发送给模型；也不能只隐藏工具名却仍注入整篇用法 |
| 长引用先给预览，全文按需查 | `trimQuoteBlock()` 对长文字保留 60 字预览并缓存全文，附件行豁免；`quote_view` 可回查，每会话缓存 10 条 | 可扩展现有上下文增强的引用读取契约。预览要带稳定引用 ID、截断标记、发送者和附件映射；短引用直接保留，避免省几个字却增加一次调用 |
| 同条消息不重复进历史与当前输入 | `buildAgentBody` 之前按 `messageId` 排除历史里的当前消息 | 对照当前群 Session、背景缓冲、引用和自身回复，按消息身份去重复承载；不能仅因两人文字一样就合并发言 |
| 不重复注入不变的元信息 | 同会话同分钟 `groupTimeHead()` 只输出一次；`session_list` 默认展示部分 ID，显式 full 才给完整值 | 优先检查当前真正重复的字段。完整路由 ID 仍留在可信内部；需推理时间差时保留时间，不通过删除必要信息制造低 token |
| 减少图片长 URL 和嵌套引用模板噪声 | 历史图片优先改成本地路径；引用清洗区分嵌套模板和普通多行正文 | 当前已有 imageIndexes 和真实图片输入，优先复用短引用及附件映射。仅给路径/URL不会让无视觉能力模型自动看图；不能为省字节只留下“[图片]” |
| 返回少量候选与分页 | 元工具 list/search 限条数及描述长度；群管理列表有分页 | 当前表情搜索已最多返回 8 个结果，可进一步评估候选字段投影和总字节预算；来源、摘要、允许路径等交付必需元数据仍保留在可信注册记录 |

依据：[工具发现与领取](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L3706-L3777)、[实际可见性规则](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L3604-L3643)、[引用预览](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/inbound.ts#L1316-L1355)、[引用全文工具](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L2575-L2615)、[消息去重](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/inbound.ts#L1051-L1062)、[时间头](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/inbound.ts#L122-L147)、[短 ID 展示](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L1382-L1426)、[引用清洗](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/quote-text.ts#L91-L126)。

上游实现与早期注释有差异：扩展工具目前仍会全局注册，实际节省取决于模型最终 schema 的剪枝；本实例工具默认保留，其他实例工具按领取情况放开，不是每个 QQ 会话都“只剩一个元工具”。`localizeHistoryImages()` 找不到本地图片时现在保留原 URL，不能按旧注释写成一律替换为 `[图片]`。[全局注册分支](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/channel-tools.ts#L3944-L3974)、[历史图片实际行为](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/inbound.ts#L1281-L1313)。

### 10.2 本地计算替代适合的模型工作，缓存重复计算

上游 `createLocalEmbedder()` 按模型目录复用加载实例；评分器按样例文件变更重建向量，相关度计算缓存历史消息向量。可借鉴到**表情语义检索、关系事实检索、离线分析**，降低这部分云端模型调用及等待。所谓“零 token”应理解为这些本地嵌入计算不消耗远程 LLM API token，本地模型仍分词并耗 CPU/内存，初次加载、硬件支持和检索效果都需测量。[嵌入器实例缓存](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/local-embed.ts#L115-L140)、[样例向量缓存与失效](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/value-score.ts#L95-L138)、[历史向量缓存](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/local-signals.ts#L34-L119)。

当前表情检索本来就是本地关键词排序，不应宣传“换本地 embedding 就从收费变免费”；新增价值主要是语义召回。当前独立接话判断器已隔离人格/工具、仅使用判断提示与所需上下文，记忆也已有小总览与按需查询，可继续复用。[sticker-catalog.mjs](../../src/channels/qq/sticker-catalog.mjs)、[group-participation-reply.mjs](../../plugin-src/host/channels/qq/group-participation-reply.mjs)、[group-memory.mjs](../../src/channels/qq/group-memory.mjs)。

不未经验证用本地相似度阈值替换现有 `reply/wait/decline` 模型语义判断。未来若评估预筛，先只观察误插话与漏接话，并计入所有被筛掉的样本；要改变接话策略时再明确选型。否则少回复造成的省 token 会损害本次用户目标。

### 10.3 可以参考、但不作为当前默认的办法

上游 `contextless-trim` 会用固定占位文本替换更早的模型可见历史，不调摘要模型，并记录与宿主 compaction 对应的事件；它**不是保留语义的模型摘要**。可学习“压缩须遵守宿主会话格式及 token 计量契约”，不直接复制内部事件、每轮裁剪历史或粗略字符/4估算。当前用户已经要求同群连续对话和记得自己的回答，应保留最近连贯对话、1200 字节记忆总览与按需检索；需要压缩时优先使用当前宿主支持的机制并验证信息保留。[压缩机制及历史错误说明](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/contextless-trim.ts#L1-L44)。

同样不照搬“把工具说明缩成四个字”作为普遍策略：说明过短可能增加误用、反复查询和重试。先删重复叙述，保留适用范围、必要输入及失败语义。磁盘 gzip/无损压缩不会让解压后的模型输入变短；把 system 文字移到另一种消息类型也不能凭此宣称减少计费。固定提示与动态数据分开是可评估方向，当前尚未验证提供商缓存命中或费用收益。

### 10.4 建议顺序与验证方法

1. **先测输入构成。**分别记录判断与真实回复的提示、工具 schema、近期对话、背景引用、记忆总览、关系摘要和工具结果大小；字节/字符是本地预算，token 以实际模型 usage 为准。
2. **先做低损耗削减。**优先去重复消息与元信息、隐藏无关工具、约束候选结果字段、长引用按需读取；再评估图片描述复用、本地语义检索和关系摘要。已有范围上限不因“省 token”擅自缩小。
3. **核算整条链路。**同一固定样本集比较输入/输出 token、调用次数、可见的思考 token、失败/重试、查询和后台摘要成本，以及 P50/P95 回复耗时。发现工具本身也有一轮成本，频繁需全文的引用可能适合直接提供，不能只看首轮少了多少字。
4. **同时验收质量。**同群追问、自己的上一条回答、同句不同语境、纯图片、嵌套引用、熟人关系、明确重发文件均不退化。不承诺未经实测的节省百分比；任何方案都不能以漏接话、少看图或忘上下文换取表面低成本。

## 11. 熟识度、好感度与成员记忆：让关系持续发展

### 11.1 分开表示“认识多熟”与“相处态度”

| 内容 | 上游实际机制 | 当前项目可学习的目标 |
|---|---|---|
| 熟识度 F | `affinity.json` 保存 `person:<openid>` 的消息、点名、接话、首次/最近互动及活跃日，计算 0–1 的 `memoryStrength`；面板映射成 0–100 | 让她区分初见、眼熟和老熟人，称呼和熟悉程度随长期互动变化；发言多不等于更喜欢 |
| 好感度 A | `attitude.json` 独立保存态度值、事件数、更新时间和最近变化解释；按回合升降，幅度受熟识度影响 | 让具体相处事件影响亲近程度、玩笑尺度和表达方式；熟人也可能产生分歧，陌生人也可以有好印象 |
| 活动日报 | `intimacy-daily.json` 按日期和 `group:<gid>\|<senderId>` 记录消息、点名、接话、图片计数；最多保留 14 个有记录的日期桶，`weeklyRows` 默认汇总近 7 个自然日 | 支持按需查看互动变化。它不是第三套好感分，也不是严格“超过 14 个自然日就删除”的 TTL；数字台账不用每次重新分析全文 |
| 成员小传 | `people/<uid>.md` 分栏保存偏好、经历、关系等文字，支持少量相关行召回、删除及归档 | 用有来源、可纠正的事实记住成员和共同经历，解释“为什么熟、为什么亲近”，避免只剩一个无来由的分数 |

依据：[熟识度更新](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/local-signals.ts#L200-L227)、[双维度定义](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/attitude.ts#L1-L29)、[日报清理](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/intimacy-ledger.ts#L59-L93)、[自然日汇总](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/intimacy-ledger.ts#L108-L130)、[成员小传结构](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/people-memo.ts#L88-L139)。

当前 [人格基线](../QQ大肥鱼人格基线.md) 与 [group-memory.mjs](../../src/channels/qq/group-memory.mjs) 已支持人格表达和群历史记忆；本次在 `src`、`plugin-src` 未发现对应的持久化 F/A 数值模块。可以在现有架构上增加关系状态，不必替换原群 Session 或另建一轮关系聊天。

### 11.2 熟识度：借鉴活跃日、缓慢积累和保留旧相识

上游每个本地自然日最多增加一次 `reviews`，并限制其不能超过认识的自然日数。实际曲线包含活跃日、点名和接话的对数项，再按距离上次互动的时间指数衰减；熟人保留非零下限，且衰减更慢。档位函数支持进入和退出阈值不同的滞回，但调用方不传旧档位就没有这个效果。源码有多版旧公式注释，应以函数体为准。[实际曲线与档位](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/local-signals.ts#L274-L327)。

实际参数供研究参考：`fam=min(1,0.28·log10(1+reviews)+0.15·log10(1+mentions)+0.15·log10(1+replies)+0.02)`；遗忘下限 `floor=min(0.6,0.15·log10(1+reviews))`，时间常数 `tauDays=3·(1+reviews/10)`，再将熟悉程度从 `max(fam,floor)` 向下限衰减。它们是上游产品参数，不是心理学定律，也不是本项目已选定的默认值。

可学习：多日自然互动比短时间刷屏更有意义；久别后依然记得老朋友；界面可解释分数来自哪些互动。不能宣称该算法完全防刷，因为点名、接话计数仍可反复增长，接话相关度也只是模型启发式。实施时用当前消息身份去重、区分发送者和被引用者，按产品目标测试增长曲线。

### 11.3 好感度：事件有来源，变化有解释，性格有连贯性

上游新记录以 A=0 开始，更新近似表示为 `A'=clamp(A+delta/(1+3F),−(1+2F),+(1+2F))`：越熟，单件事的变化越缓慢，允许表达的正负范围越宽。保存最近 8 条变化解释，人数上限为 500；未见独立按时间自动衰减 A 的机制，不能把 F 的遗忘写成 A 也自动回零。[公式及范围](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/attitude.ts#L40-L49)、[范围与阻尼](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/attitude.ts#L161-L168)、[实际持久化更新](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/attitude.ts#L299-L345)。

**上游好感度已有实际接线。**出站按完整回合聚合，在 `turn/end` 结算；分类器使用 reasoning、可选工具参数和回复正文生成变化。`ATTITUDE_GATE_ENABLED=true`，将 A 相对范围换成最多约 ±0.1 的接话分数偏移；真正是否拦截还受本地模型开关、`valueGate=off/log/block` 和 @ 豁免等分支控制。顶部“只观察”的旧注释不能概括当前行为，也不能从源码推断某个部署当前开了哪些选项。[回合结算](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/outbound.ts#L363-L414)、[分类到更新](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/four-source.ts#L350-L382)、[偏移开关](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/attitude.ts#L99-L159)、[入站配置分支](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/transport/inbound.ts#L381-L428)。

适合当前项目的设计是让同一个真实回复 Agent 看到**当前成员的简短关系状态与相关共同经历**，自然决定熟悉称呼、关心、吐槽、亲近或有分寸的不满。关系状态可供自主接话判断参考，但不直接换成概率或硬性评分门槛。低好感仍能正常、礼貌地回应；高好感也不要求奉承。基本事实与技术回答质量不随关系降低。

事件建议先依据可观察互动，例如明确感谢、承诺兑现、共同讨论、误会澄清或明确冒犯，并带触发消息 ID、真实成员、群、Session、Turn、理由与结算状态；这是建议契约，尚未实现。若由原回复 Agent 提出事件，宿主校验当前对象与回合，每事件只结算一次，可查看、纠正和撤销；不用额外开启一个模型分析每条群消息的“感情”。没有足够依据、模型弃权或上下文不全时不更新。

不照搬“reasoning 是真实内心”“短回答就是敷衍”以及被骂后加倍讨好等归因。当前回复模型关闭思考，也应正常支持关系表达；引用、反讽、角色扮演和多人同时说话不能导致给错人扣分。更不能让好感或昵称替代 owner 身份、工具守卫和账号授权。

### 11.4 成员小传也能省 token，但要控制注入总量

上游小传按当前成员最多召回 2 行，使用本地嵌入排序，不可用时取末尾；超过 30 天未修改的档案不自动注入，但原文保留。写入实际是每天最多 3 条、每条最多 300 字符，日限额只在内存且存在 force 入口；同栏合并后仍可能变长。不能把“每天几条、每次两行”当作总存储或 token 已有严格上限。[小传写入限制](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/people-memo.ts#L64-L85)、[写入与合并](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/people-memo.ts#L117-L158)、[相关行召回](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/people-memo.ts#L173-L211)。

借鉴“档案在本地，只给当前相关的人和事”，但关系摘要须纳入已有上下文总预算，不能在 1200 字节记忆总览之外再每轮塞所有成员、事件历史和小传全文。按当前参与者、相关性和档案版本选取，详细内容才按需查询；计数和档位本地计算，不消耗一轮云端生成。关系档案的持久化、查看、清除和已有采集开关应有一致语义，关闭时不暗中继续长期采集。

上游入站有同人 24 小时注入节流，但暂存是模块全局、最多 600 字符、90 秒 TTL；`takePendingMemoText()` 没有读后清空或按 bot/群/Session/Turn 隔离。另有注释声称 system 注入保护提示缓存，实际消费者却记载该通道在新宿主没生效，转为 pre-step。应借鉴按需与按变更去重复的思路，不能照搬共享暂存、固定 24 小时节流或据此保证缓存命中。[暂存实际实现](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/features/people-memo.ts#L227-L245)、[实际注入消费者](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/session/session-manager.ts#L1283-L1290)。

**验收：**同日连发百条不等于活跃百天；时区、跨日和久别变化可解释；同名、改名、多群与群/私聊身份不串档，不默认把不同平台标识视为同一个人。好感事件结算对象正确、重复事件不重复加减；引用别人攻击不惩罚引用者；关闭思考也能自然回复。档案写入失败可诊断，不把失败读档静默解释为“第一次认识”。关系只影响获准的角色表达、不提升权限；成员数和历史事件增加不导致注入无限增长。最终用同场景前后对话验证她是否更连贯、更有情感，而非仅验证分数发生变化。

## 12. 明确不照搬的机制

| 上游做法/线索 | 当前项目的取舍 |
|---|---|
| 评分门槛、好感度偏移、近邻样本决定是否回应 | 学习熟识度与好感度的独立状态和关系表达；接话仍由模型自主判断，不恢复随机概率或静默替换评分逻辑 |
| `debounce` 静默窗口、攒满消息立即发、忙时插话或排队 | 保留仅对未 @ 主动接话做语义完整性判断，尺度适当放松；忙时消息按当前规则丢弃，不建回复积压队列 |
| 正文 `[MEDIA:...]` 解析直接发送 | 保留可信工具/结构事件到 artifact registry 的来源边界 |
| 每轮 system 备忘 | 保留小总览与按需记忆查询，不把旧摘要重新全铺进上下文 |
| 转发或归档 reasoning 供情绪系统使用 | 排错只需结构化判断与执行状态，不把内部思考作为回复或可靠人格证据 |
| 扩展可直取宿主、密钥和执行权限 | 扩展视为 owner 安装的可信代码；群成员不可借此取得本机命令权限 |

其中静默窗口和忙时处理可直接见上游 [debounce.ts 的机制说明](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/src/gateway/debounce.ts#L1-L25)。这些差异源于当前用户已确认的产品行为，不是对上游用途的否定。

## 13. 复用前的依赖与证据要求

- 上游仓库的 [LICENSE](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/LICENSE#L1-L21) 为 MIT；若实际复制代码或实质性代码片段，应保留原版权及许可声明。表情图片、模型权重和第三方音频库不能仅凭仓库 MIT 一并视为同许可。
- 上游依赖固定的 QQ connector、DSH 组件以及语音库，并可选安装 transformers；兼容关系需要针对当前 DSH 版本核验，不能整份搬入依赖表。[依赖声明](https://github.com/zaofan-make/dsh-qqbot/blob/665852399e798aebc1ea00c54278b3c52ca41181/package.json#L94-L114)。本次未安装这些依赖。
- dHash 与 URL 分类阈值是上游实现参数，不是本机已验证指标；语音转换“可生成 MP3”不等于“QQ 原生语音已发送”；事件解析测试不等于真实宿主会发相同事件。
- 后续实际实施先选一项形成闭合改动与真实验收。建议第一批聚焦“逐条接话追踪、表情库管理、重复投递与模型输入诊断”；熟识度/好感度先定义关系事件与呈现方式，`present` 事件和语音格式先做契约验证，再进入实现。

本报告的完成范围是源码对照与建议文档。尚未验证上游运行效果、当前宿主交付物事件兼容性、QQ 语音格式支持及新增方案的真实延迟收益。
