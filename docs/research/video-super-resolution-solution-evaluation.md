# AI 生成视频云端超分与增强方案调研

> 状态：Draft 1.0<br>
> 调研日期：2026-08-28 至 2026-08-31<br>
> 目标读者：管理层、产品、研发与基础设施同事<br>
> 当前范围：Tencent Cloud International 与 BytePlus；低分辨率 Seedance 视频后处理至 1080p/4K
>
> 带42张画质对比图的可视化版本：[打开HTML报告](./video-super-resolution-solution-evaluation.html)

## 1. 管理层摘要

### 1.1 业务问题

在用户需要高清视频时，以下路线能否在画质可接受的前提下降低总成本：

```text
Seedance 低分辨率生成（480p / 720p）
  + 云端视频超分 / AIGC 增强
  = 1080p / 4K 交付视频
```

最终选型不能只比较后处理单价，需要比较：

```text
单条成片总成本
= 生成成本
+ 增强与转码成本
+ 存储、跨区传输和分发成本
+ 失败与重试成本
```

### 1.2 阶段结论

1. Tencent 327007、BytePlus Fast、BytePlus Standard/Natural 和普通放大的16条同源输出均已验收。输入与增强结果、480p与720p输入结果及动态对比视频均已生成。
2. 静帧对比中，Tencent 327007 的毛发、冰面和背景边缘最锐利，处理也最激进。BytePlus 两档更保守；Standard 相对 Fast 的静帧提升较小且不稳定。
3. 官方4K、≤30fps按量价格中，BytePlus Fast为 `USD 0.8264/min`，Standard/Natural为 `USD 1.6528/min`；Tencent 327007的大模型增强与Singapore H.264 4K TSC合计为 `USD 2.1991/min`。
4. 同源测试可以比较输入分辨率和处理路线，但没有真实4K参考，不能判断增强纹理是否真实恢复，也不能计算有意义的全参考4K VMAF、PSNR或SSIM。
5. 多名同事在常规观看中认为几种增强结果没有明显差异；当前可辨差别主要出现在静帧放大和局部Crop中。结合官方单价，Fast是成本优先候选，Tencent 327007是锐度优先候选，Standard/Natural暂不作为默认方案。

### 1.3 下一步

- Standard/Natural在常规观看中没有体现出足以支撑约2倍目录价的明显提升，现阶段不作为默认候选。

## 2. 方案定义与比较边界

### 2.1 方案层次

| 层次 | 方案 | 回答的问题 |
|---|---|---|
| 普通缩放基线 | 仅 Resize / Transcode | 分辨率数字变大但没有 AI 重建时，最低基线如何 |
| 纯超分 | Tencent Super Resolution / BytePlus LAS DOVE | 单一超分算法本身的效果与成本如何 |
| 场景化增强 | Tencent 327007 / BytePlus VOD AIGC Fast、Standard、Pro | 厂商针对 AIGC 视频提供的生产方案如何 |

普通转码负责输出格式、编码、码率、分辨率等规格；视频增强负责重建细节、去伪影或改善主观画质。增强任务通常仍包含转码层，因此不是简单的“转码或增强”二选一。

### 2.2 评价维度与权重

最终权重需由业务负责人确认。建议初版：

| 维度 | 建议权重 | 核心指标 |
|---|---:|---|
| 画质 | 40% | 常规观看、局部Crop、细节、伪影、时间稳定性、身份/文字一致性 |
| 单条总成本 | 30% | 生成、增强、转码、存储、流量、重试 |
| 时延与吞吐 | 15% | 排队、处理、端到端耗时、并发限制 |
| 接入与运维 | 10% | API、回调、幂等、失败处理、区域与数据路径 |
| 商务与合规 | 5% | SLA、数据驻留、合同折扣、支持与内容政策 |

## 3. 测试样本与媒体参数

样本目录：`/Users/hongbo/Desktop/SR 测试/`

### 3.1 `ffprobe` 验收结果

| 字段 | Seedance 480p 原片 | Tencent 327007 输出 | Seedance 720p 原片 | Tencent 327007 输出 |
|---|---:|---:|---:|---:|
| 内容 | 毛毛虫微距 | 同源 | 猫、人物场景 | 同源 |
| 分辨率 | 864×496 | 3762×2160 | 1280×720 | 3840×2160 |
| 视频编码 | H.264 High | H.264 High | H.264 High | H.264 High |
| 像素格式 | yuv420p（8-bit） | yuv420p（8-bit） | yuv420p（8-bit） | yuv420p（8-bit） |
| 帧率 | 24 fps | 24 fps | 24 fps | 约 24 fps |
| 视频帧数 | 193 | 193 | 361 | 361 |
| 文件时长 | 8.057 s | 8.140 s | 15.069 s | 15.152 s |
| 视频码率 | 1.131 Mbps | 7.449 Mbps | 4.012 Mbps | 14.453 Mbps |
| 文件大小 | 1.297 MB | 7.594 MB | 7.822 MB | 27.369 MB |
| 音频 | AAC LC / 44.1 kHz / 2ch | 同规格 | AAC LC / 44.1 kHz / 2ch | 同规格 |

参数解读：

- 327007 保留了源视频帧率和视频帧数，没有进行插帧。
- 两个输出均为 H.264 8-bit，与模板截图描述一致。
- 480p 输出严格保持约 `54:31` 的源宽高比，因此长边为 3762；如果下游校验写死 `3840×2160`，会被拒绝或再次缩放。
- 输出体积分别约为原片的 5.9 倍与 3.5 倍；存储与分发成本不能只按原片估算。
- `ffprobe` 未报告明确的 color primaries / transfer / color space 标签。后续需检查播放链是否依赖这些元数据，并避免把“标签缺失”误写成已发生色彩偏移。

### 3.2 Tencent 控制台任务记录

以下数据来自 2026-08-28 的 Tencent Cloud International MPS 任务详情截图；任务与输入、输出均位于 Singapore `ap-singapore`。

| 字段 | 480p + 327007 | 720p + 327007 |
|---|---:|---:|
| 任务状态 | 成功 | 成功 |
| 开始时间 | 22:41:24 | 22:39:42 |
| 结束时间 | 22:43:12 | 22:43:04 |
| 控制台墙钟耗时 | 108s（1分48秒） | 202s（3分22秒） |
| 控制台输入时长 | 8s | 15s |
| 墙钟耗时 / 输入时长 | 13.50× | 13.47× |
| 控制台输入总码率 | 1257.41 Kbps | 4055.08 Kbps |
| 控制台输出总码率 | 7288.01 Kbps | 14110.85 Kbps |
| 控制台输入大小 | 1.24 MB | 7.46 MB |
| 控制台输出大小 | 7.24 MB | 26.10 MB |

“墙钟耗时”由控制台开始、结束时间相减得到，可能包含排队、调度、增强、转码和结果落盘，不能直接称为纯模型推理时间。两条样本均约需 `13.5 秒墙钟时间 / 1 秒输入视频`。这个数字只代表当前账号、区域和模板的初步端到端处理速度，不能外推为 SLA 或并发容量。

控制台文件大小、码率采用十进制展示和整数秒时长；本地 `ffprobe` 表格使用容器中的精确时长、字节数及视频流码率，所以两组数字存在正常口径差异。最终报告同时保留两者，不混算。

### 3.3 同源受控输入

两条原生 720p 视频各生成两个控制输入。720p 支路重新编码一次；480p 支路从同一原片下采样并重新编码一次。两条支路均使用 H.264 High、`libx264`、`preset slow`、CRF 18、yuv420p 和源帧率，音频直接复制。这样可以避免 720p 未重编码、480p 多经历一次编码所造成的额外变量。

| 同源组 | 控制输入 | 分辨率 | 视频码率 | 文件大小 | 帧率 / 帧数 | 视频时长 |
|---|---|---:|---:|---:|---:|---:|
| 第 1 组 | 480p | 854×480 | 2.014 Mbps | 4.043 MB | 24fps / 361 | 15.041667s |
| 第 1 组 | 720p | 1280×720 | 3.720 Mbps | 7.251 MB | 24fps / 361 | 15.041667s |
| 第 2 组 | 480p | 854×480 | 2.191 Mbps | 4.377 MB | 24fps / 361 | 15.041667s |
| 第 2 组 | 720p | 1280×720 | 4.040 Mbps | 7.853 MB | 24fps / 361 | 15.041667s |

输入目录：`/Users/hongbo/Desktop/SR 测试/同源受控输入/`

### 3.4 Tencent 同源输出与普通放大基线

四条控制输入均已使用模板 327007 处理。每条输入还生成了一条非 AI 的 Lanczos 放大基线。普通基线使用 H.264、CRF 18、`preset slow`，用于观察付费增强相对传统缩放增加了什么，不用于估算生产文件大小或分发成本。

| 同源组 | 输入 | Tencent 输出规格 | Tencent 视频码率 | Tencent 大小 | Lanczos 输出规格 | Lanczos 视频码率 | Lanczos 大小 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 第 1 组 | 480p | 3842×2160 | 13.763 Mbps | 26.071 MB | 3842×2160 | 23.109 Mbps | 43.707 MB |
| 第 1 组 | 720p | 3840×2160 | 14.665 Mbps | 27.768 MB | 3840×2160 | 21.881 Mbps | 41.396 MB |
| 第 2 组 | 480p | 3842×2160 | 13.667 Mbps | 25.893 MB | 3842×2160 | 22.913 Mbps | 43.339 MB |
| 第 2 组 | 720p | 3840×2160 | 13.989 Mbps | 26.499 MB | 3840×2160 | 22.872 Mbps | 43.261 MB |

四条 Tencent 输出均为 H.264 High、yuv420p、24fps、361 帧，视频时长约 15.042 秒。`ffprobe` 未报告明确的 color primaries、transfer 或 color space 标签。480p 支路输出为 `3842×2160`，原因是 `854×480` 略宽于精确的 `16:9`，而模板按短边 2160 等比例缩放。

输出目录：

- Tencent：`/Users/hongbo/Desktop/SR 测试/腾讯同源受控输出-4k/`
- Lanczos：`/Users/hongbo/Desktop/SR 测试/普通放大基线-4k/`

### 3.5 跨方案媒体参数验收

四种路线、两组内容和两档输入分辨率形成16条输出。完整逐文件数据保存在 `media-inventory.csv` 和 `media-inventory.json`。摘要如下：

| 路线 | 输出尺寸 | 视频码率范围 | 单文件大小范围 | 色彩元数据 | 帧率 / 帧数 |
|---|---|---:|---:|---|---|
| Lanczos | 480p支路 3842×2160；720p支路 3840×2160 | 21.881至23.109 Mbps | 41.396至43.707 MB | 未显式报告 | 24fps / 361 |
| Tencent 327007 | 480p支路 3842×2160；720p支路 3840×2160 | 13.667至14.665 Mbps | 25.893至27.768 MB | 未显式报告 | 约24fps / 361 |
| BytePlus Fast | 480p支路 3844×2160；720p支路 3840×2160 | 30.430至30.622 Mbps | 57.472至57.829 MB | 显式 BT.709 | 24fps / 361 |
| BytePlus Standard/Natural | 全部 3840×2160 | 29.444至31.414 Mbps | 55.616至59.321 MB | 未显式报告 | 24fps / 361 |

三家对 `854×480` 输入的比例处理并不一致：Tencent/Lanczos 输出宽度为3842，BytePlus Fast为3844，Standard为3840。对比制作时先统一为 `3840×2160`，避免显示尺寸本身影响判断。Fast明确写入BT.709，而Standard、Tencent和Lanczos未被 `ffprobe` 识别出对应标签；这是播放链和交付契约的元数据一致性风险，但目前没有证据表明已经产生可见色偏。

### 3.6 跨方案同帧、Crop与动态素材

两组内容、480p/720p两档输入均比较原始输入放大、Tencent 327007、BytePlus Fast和BytePlus Standard/Natural，方案名称已写在图内。

图中的 `Input enlarged (Lanczos, no AI)` 是把原始480p或720p输入用Lanczos放大到与4K结果相同的显示尺寸。它没有AI细节重建，作用是呈现处理前的视觉基线，便于判断三种付费增强相对输入增加了什么。

每个组合抽取第72、192、312帧，约对应3秒、8秒和13秒。Crop先把输出统一到3840×2160，再直接裁取960×720原像素区域；覆盖猫、猫毛与耳缘、儿童面部与发丝、远处北极熊与冰面、北极熊与树木、北极熊眼睛与毛发。动态四路视频统一为1920×1080、24fps、361帧，避免容器尾部时长差异造成单路提前结束。

产物包括12张有标签四路全图、12张有标签Crop、18张480p/720p输入结果对照图和4条有标签动态视频。

### 3.7 输入与增强结果的视觉比较

全图用于判断构图、主体轮廓和背景纹理，Crop用于检查毛发、发丝、面部、冰面和远景边缘。每张四路图都把原始输入放大结果与三种增强结果放在同一帧中，避免把不同画面或不同时间点造成的差异误认为算法效果。

这组比较回答的是“增强后看起来增加了什么”，不能回答“增加的细节是否真实”。当前母版只有720p，没有真实4K参考，因此锐度更高可能来自有效重建，也可能来自锐化、局部对比度或生成式纹理。

### 3.8 同一影片的480p与720p输入结果

新增18张同方案局部对照图。每张图固定影片、处理方案、帧号和Crop区域，只改变输入分辨率，直接比较480p和720p输入生成的4K结果。覆盖Tencent 327007、BytePlus Fast和BytePlus Standard/Natural，每种方案包含两组内容、三个时间点。

当前两组样本中，720p输入通常保留更清楚的轮廓和局部结构，但差异并非每一帧都明显。Tencent在部分毛发和边缘区域更容易看出480p与720p的差别；BytePlus两档的差别相对较小。是否值得支付更高的上游生成成本，还需结合Seedance价差判断。

对照图目录：`docs/research/assets/video-sr-report/resolution/`

### 3.9 非盲静帧初审

以下是静帧放大观察。多名同事在常规观看中认为几种结果没有明显差异，因此这些局部差别不应外推为普通用户一定能感知的整体提升：

1. Tencent 327007 在猫毛、发丝、北极熊毛发、冰面边界、草地和远景轮廓上普遍最锐利，高频细节最明显。
2. Tencent 的处理也最激进。部分结果可能包含锐化、对比度提升或生成式纹理；没有真实4K参考时，不能把“更清楚”解释为“更真实”。动态视频还需检查纹理游走、闪烁和边缘呼吸。
3. BytePlus Fast 与 Standard/Natural 整体更保守，视觉上通常更接近输入和Lanczos。Standard在部分人脸、睫毛和毛发区域比Fast多一些纹理，但多数静帧差异较小，且并非每个场景都稳定可见。
4. 720p输入通常比480p输入保留更明确的结构，但当前两组Seedance母版本身偏软，增益并非所有场景都很大。是否值得为720p生成支付额外上游成本，仍需结合Seedance价差。
5. 静帧结果尚不足以证明Standard约为Fast两倍的处理单价合理。

### 3.10 评价边界

真实480p与720p样本的内容和时长不同，只能用于兼容性和业务观感检查。两组同源受控样本来自原生720p母版，可以比较输入分辨率和处理路线，但不能衡量输出距离真实4K有多近。

若要计算全参考 VMAF、VMAF NEG、PSNR 或 SSIM，需要另取真实 4K 母版，分别受控下采样到 480p 和 720p，再由相同方案恢复到 4K。当前同源组只用于常规观看、Crop、无参考观察和时间稳定性检查。

## 4. 厂商方案

### 4.1 Tencent Cloud International

当前实测候选：MPS 音视频增强模板 `327007`。控制台截图确认其模板名称为“真人场景-大模型增强-MP4-4K-帧率随源-计费-降噪+超分+综合增强”，当前完整可见配置如下：

| 类别 | 327007 当前配置 |
|---|---|
| 转码 | 极速高清转码（TSC） |
| 容器 / 视频编码 | MP4 / H.264 |
| 输出分辨率 | 短边 2160px，长边按源比例缩放 |
| 帧率 | 与源文件一致 |
| 视频场景 | AIGC |
| 基础画质增强 | 大模型增强 `strong` 开启 |
| 其他基础能力 | 大模型修复、综合增强、去毛刺的独立开关关闭 |
| 扩展能力 | 插帧、超分辨率、HDR、低光照、色彩、降噪、去划痕的独立开关关闭 |
| 码控 | VBR（默认）、CRF=0、压缩率自动、平均码率上限 16000 Kbps |
| GOP | 结构同源关闭；GOP 长度、最大连续 B 帧数自动 |
| 编码高级项 | 编码器级别、Profile 自动；8-bit；不保留原始时间戳 |
| 音频 | 开启转码；AAC、96 Kbps、44.1 kHz、双声道 |

截图显示，界面只开启“大模型增强 strong”，独立超分、降噪、综合增强开关均关闭。模板名称同时标注“计费-降噪+超分+综合增强”。官方文档把大模型增强按组合能力计费，因此不能根据独立开关关闭推断这些计费项为零。

Tencent MPS 官方说明，增强能力叠加在转码流程上。大模型增强基于 Diffusion，按“综合增强 + 超分辨率 + 视频降噪”计费，转码费另计。[官方增强模板说明](https://www.tencentcloud.com/document/product/1041/48789)

已由截图确认：

- 模板 ID、名称、AIGC 场景、输出规格、增强强度、转码和音频参数；
- 两条任务均成功，输入输出均在 `ap-singapore`；
- 当前样本的控制台墙钟耗时和输入输出文件展示值。

仍待确认：

- `327007` 的底层模型版本；
- 单文件、并发、队列、区域与跨区 COS 限制；
- 标准 UHD 4K 输出的宽高比策略。

### 4.2 BytePlus

新版 VOD 增强明确提供 AIGC content 场景、Fast/Standard/Pro 档位、Natural/High definition 强度、AI Super Resolution 与源帧率匹配。Natural 的官方定位是尽量贴近原纹理，并降低 AI 人物视频的油画感风险。[官方模板说明](https://docs.byteplus.com/en/docs/byteplus-vod/docs-image-enhancement-template)

官方文档说明，增强强度只适用于 Standard 和 Pro。Fast 没有 Natural 或 High definition 选项，因此本报告统一写作 `Fast` 和 `Standard/Natural`，不再使用 `Fast/Natural`。

用户提供的控制台截图确认，空间 `sr-test` 位于“亚太东南（柔佛）”。该区域与新版视频增强模板要求一致。当前控制台路径是：

```text
空间管理 → 进入 sr-test
  → 左侧：媒体处理设置 → 媒体处理模版
    → 右侧：画质增强模版
      → 创建/添加画质增强模版
```

官方英文文档把右侧标签称为 `Video enhancement`。中文控制台对应“画质增强模版”。“视频转码模版”和“高清低码模版”都不是本次 AIGC 超分入口。[官方模板创建步骤](https://docs.byteplus.com/en/docs/byteplus-vod/docs-image-enhancement-template)

本轮创建两套模板。下表区分控制台证据与输出文件证据，避免把成片参数误当成模板设置：

| 字段 | Fast 模板 | Standard/Natural 模板 | 证据状态 |
|---|---|---|---|
| 区域 / 空间 | Johor / `sr-test` | Johor / `sr-test` | 空间截图与任务记录确认 |
| 模板名称 | `AIGC-SR-4K-Fast-8bit` | `AIGC-SR-4K-Standard-8bit` | 两个模板详情截图确认 |
| 模板描述 | 未记录 | `Seedance low-resolution video to 4K` | Standard详情截图确认；不影响处理算法 |
| 预设场景 | AIGC content | AIGC content | 两个模板详情截图确认 |
| Enhancement tier | Fast | Standard | 两个模板详情截图确认 |
| Enhancement intensity | 不提供该选项 | Natural version | Standard详情截图确认 |
| Resolution | AI super resolution → 4K | AI super resolution → 4K | 两个模板详情截图确认；4K输出由 `ffprobe` 验证 |
| Frame rate | Match source file | Match source file | 两个模板详情截图确认；输出均保持24fps、361帧 |
| AI frame interpolation | 不启用 | 不启用 | 两个模板详情截图确认；帧率和帧数未变化 |
| Target bitrate | 30000 Kbps | 30000 Kbps | 两个模板详情截图确认；Standard实测约29.44至31.41 Mbps |
| AIGC专家模块 | 截图未展示 | 结构、运动、风格管理、特效专家均显示“已配置” | Standard详情截图确认；属于模板内部模块状态，不是独立画质档位 |
| 最终视频规格 | MP4、H.264 High、yuv420p（8-bit） | MP4、H.264 High、yuv420p（8-bit） | 本地下载文件确认 |
| 最终音频规格 | AAC LC、44.1 kHz、双声道，约128至130 Kbps | AAC LC、44.1 kHz、双声道，约128至130 Kbps | 本地下载文件确认；不是控制台音频策略截图 |

官方给出的 4K、25/30fps 目标码率范围是 25 至 35 Mbps，默认值为 30 Mbps。实际输出可在目标值的 0.8 至 1.5 倍之间波动。两套模板使用同一目标码率，避免码率差异干扰 Fast 与 Standard 的画质比较。

当前单视频测试不需要先创建工作流。模板保存后，可在视频管理中选择素材，处理类型选择“视频增强”，再选择 Fast 或 Standard 模板。工作流适合把增强、转码、截图、字幕或发布串联起来；本轮单方案对比不加入工作流，以免增加处理变量和费用。[官方媒体处理说明](https://docs.byteplus.com/en/docs/byteplus-vod/docs-media-processing) [官方工作流说明](https://docs.byteplus.com/en/docs/byteplus-vod/docs-workflow)

新版模板仅在 Johor 提供；Singapore 继续提供 Legacy 模板，价格需联系技术支持。报告必须记录每个任务的区域和模板版本。[官方区域说明](https://docs.byteplus.com/en/docs/byteplus-vod/docs-image-enhancement-template)

另有 LAS DOVE Video Super Resolution，公开价为 `0.6 USD/min`，按输出时长、分辨率和帧率换算计费，精度到毫秒级；它适合作为纯 SR 技术基线，不能与 VOD AIGC Standard 直接视为同档产品。[LAS 官方说明](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_super-resolution)

### 4.3 FFmpeg Lanczos 普通放大基线

FFmpeg路线不是AI超分，而是用于回答“只把像素尺寸放大到4K、不进行细节重建时会得到什么”。四条基线使用同一套编码参数，只有480p与720p支路的目标宽度不同：

| 参数 | 本轮实际设置 | 作用 |
|---|---|---|
| 缩放算法 | `scale=...:2160:flags=lanczos` | 使用Lanczos插值放大，不生成AI纹理 |
| 480p支路尺寸 | `3842×2160` | 对应受控输入 `854×480` 的宽高比 |
| 720p支路尺寸 | `3840×2160` | 标准16:9 UHD 4K |
| 像素宽高比 | `setsar=1` | 输出方形像素 |
| 视频编码 | `libx264`，`preset=slow`，`crf=18` | 使用固定质量编码；CRF 18不是目标码率 |
| 像素格式 | `yuv420p` | 8-bit 4:2:0，保持常见播放兼容性 |
| 帧率 | `-fps_mode passthrough` | 沿用输入时间戳和24fps，不插帧 |
| 音频 | `-c:a copy` | 音频流直接复制，不重编码 |
| 封装优化 | `-movflags +faststart` | 将MP4元数据移到文件前部，便于渐进播放 |
| 覆盖策略 | `-n` | 已存在输出时拒绝覆盖 |

实际执行命令模板：

```bash
# 480p受控输入
ffmpeg -n -hide_banner -loglevel warning -stats -i INPUT_480P.mp4 \
  -map 0:v:0 -map '0:a?' \
  -vf 'scale=3842:2160:flags=lanczos,setsar=1' \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -fps_mode passthrough -c:a copy -movflags +faststart OUTPUT_480P_4K.mp4

# 720p受控输入
ffmpeg -n -hide_banner -loglevel warning -stats -i INPUT_720P.mp4 \
  -map 0:v:0 -map '0:a?' \
  -vf 'scale=3840:2160:flags=lanczos,setsar=1' \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -fps_mode passthrough -c:a copy -movflags +faststart OUTPUT_720P_4K.mp4
```

四条输出均由 `ffprobe` 验证为H.264 High、yuv420p、24fps、361帧，视频码率约21.88至23.11 Mbps；音频与输入流的哈希一致。当前机器安装的是 FFmpeg `9.0.1`，但生成时未单独保存版本快照，因此报告不把该版本号写成生成时已确认事实。

需要注意：Tencent模板中的 `CRF=0` 是其VBR控制台字段，不能等同于FFmpeg/libx264语义中的无损 `-crf 0`。本基线明确使用的是 `-crf 18`。

### 4.4 BytePlus 本地下载验收

BytePlus 同源输出目录：`/Users/hongbo/Desktop/SR 测试/Byteplus同源受控输出-4k/`

本地8个MP4对应8个不同的SHA-256和存储对象，内容分组及480p/720p映射正确。文件均为H.264 High、yuv420p、24fps、361帧，视频码率为29.44至31.41 Mbps。

`cat-480` 两个文件最初按错误的Fast/Standard名称保存。任务完成时间、输出宽度、BT.709标签和流顺序共同确认：对象 `dcd9...` 是Fast，`85f2...` 是Standard。本地文件已改名并复核。

BytePlus Fast与Standard/Natural的控制台核心参数均已补齐；当前仍未知的是厂商未公开的内部模型版本，而不是本轮用户可配置项。

## 5. 三条路线的官方计费

本节统一采用本轮输出规格：4K、24fps，因此落入官方“4K、≤30fps”档。[BytePlus VOD官方定价](https://docs.byteplus.com/en/docs/byteplus-vod/docs-pay-as-you-go-pricing) [Tencent MPS官方定价](https://intl.cloud.tencent.com/zh/document/product/1041/49204?lang=zh)

| 路线 | 官方计费项 | 计费依据 | 官方单价 | 相对Fast |
|---|---|---|---:|---:|
| BytePlus Fast | Video enhancement · Fast | 处理后输出时长、增强档位、输出分辨率与帧率 | **USD 0.8264/min** | 1.00× |
| BytePlus Standard/Natural | Video enhancement · Standard | 处理后输出时长、增强档位、输出分辨率与帧率 | **USD 1.6528/min** | 2.00× |
| Tencent 327007 | 大模型视频增强 + H.264 4K极速高清转码 | 增强后/转码后输出时长、4K、≤30fps、Singapore | **USD 2.1991/min** | 2.66× |

Tencent 327007的 `USD 2.1991/min` 是两项官方价格之和：

```text
大模型视频增强：        USD 2.0458/min
Singapore H.264 4K TSC：USD 0.1533/min
合计：                  USD 2.1991/min
```

Tencent官方说明音视频增强基于转码实现，增强任务会同时收取增强费和转码费；模板327007使用大模型增强并启用H.264 4K极速高清转码，因此主表采用两项合计。BytePlus官方表直接按Fast或Standard档位给出视频增强费；同页另列H.264 4K普通转码 `USD 0.0495/min`，但增强定价章节没有说明该项会自动叠加，因此不并入三条路线主表。

官方价的横向关系是：Standard为Fast的2倍；Tencent 327007的视频处理组合价约为Fast的2.66倍、Standard的1.33倍。以上均为USD/输出分钟，不含Seedance生成、音频、存储、出网/CDN、跨区传输、失败重试、折扣和资源包。Tencent模板开启AAC，但现有模板信息不能确认其按普通音频转码还是音频TSC计费，因此未并入主表。

## 6. 测试矩阵

### 6.1 Phase A：当前真实 Seedance 样本

| 输入 | Tencent 327007 | BytePlus Fast | BytePlus Standard/Natural |
|---|---|---|---|
| 当前 480p 毛毛虫 | 已完成 | 待测 | 待测 |
| 当前 720p 猫/人物 | 已完成 | 待测 | 待测 |

用途：验证真实业务素材兼容性、主观观感、处理时延与账单。不同输入之间不做输入分辨率因果比较。

### 6.2 Phase B：同源受控算法比较

当前两组原生 720p 母版已生成 480p、720p 控制输入。普通缩放、Tencent 327007 和 BytePlus Fast/Standard 的同源受控输出均已完成：

| 输入 | Lanczos 4K | Tencent 327007 | BytePlus Fast | BytePlus Standard/Natural |
|---|---|---|---|---|
| 第 1 组控制 480p | 已完成 | 已完成 | 已完成 | 已完成 |
| 第 1 组控制 720p | 已完成 | 已完成 | 已完成 | 已完成 |
| 第 2 组控制 480p | 已完成 | 已完成 | 已完成 | 已完成 |
| 第 2 组控制 720p | 已完成 | 已完成 | 已完成 | 已完成 |

这两组用于比较输入分辨率、传统缩放和云端增强的差异。它们没有真实 4K 参考，不用于全参考 4K 指标。

### 6.3 真实 4K 母版组

建议补充五类真实 4K 母版，每类生成 480p、720p 两个受控输入：

1. 人物近景：脸、头发、皮肤、手指；
2. 文字与 Logo：字符边缘和内容一致性；
3. 建筑与几何：直线、栏杆、重复纹理；
4. 自然细节：树叶、草地、水面、动物毛发；
5. 快速运动与遮挡：时间闪烁、拖影、纹理游走。

每个输入至少测试普通 Resize、Tencent 327007、BytePlus Fast 和 BytePlus Standard。Pure SR 只在需要解释算法差异或压缩成本时补充；BytePlus Pro 只对高价值代表样本抽测。

## 7. 画质评价方法

### 7.1 主观观看

- 使用同一播放器、显示器和缩放比例，先按正常尺寸连续观看，再查看相同帧的全图与Crop；
- 只记录能够稳定复现的差异或明显问题，如身份漂移、错误文字、严重闪烁、纹理游走和假细节；
- 本轮多名同事在常规观看下均未发现几种增强结果存在明显差异。该反馈说明普通观看场景下差别不突出，不代表各方案完全一致；放大静帧与Crop中仍能看到局部锐度和纹理处理差异。

### 7.2 客观评价

- 真实 4K 母版受控样本：VMAF、VMAF NEG、PSNR、SSIM，用于辅助判断保真度；
- 当前 720p 母版同源样本：不计算全参考 4K 指标，使用Crop、无参考观察与时间稳定性检查；
- 真实独立生成样本：不使用另一次 Native 4K 生成为全参考基准，优先采用常规观看、Crop、无参考观察与时间稳定性分析；
- 对所有输出做 `ffprobe` 契约验收：分辨率、DAR/SAR、编码、色深、帧率、帧数、时长、色彩元数据、码率和音频。

## 8. 接入与运行验收

每个厂商至少记录：

| 类别 | 必填证据 |
|---|---|
| 任务 | 区域、模板 ID/版本、请求参数、任务 ID |
| 时延 | 提交、开始、完成、下载时间；排队与处理分开 |
| 可靠性 | 成功、失败、超时、重试、幂等与回调重复 |
| 限制 | 文件大小/时长、分辨率、帧率、并发、队列 |
| 数据 | 上传、输出、保存期限、跨区路径、删除流程 |
| 账单 | 增强、转码、存储、出网、折扣和最低计费 |

凭据仅在本地 Secret 或平台凭据管理中保存；报告、日志和截图不得包含 AK/SK、Token、Cookie 或签名 URL。

## 9. 方案对照

| 方案 | 画质 | 总成本 | 时延 | 区域/接入 | 适用定位 | 最终意见 |
|---|---:|---:|---:|---|---|---|
| Tencent 327007 | 放大静帧与Crop中局部最锐利、处理最激进；常规观看差异不明显 | 2.1991 USD/min，约Fast 2.66倍 | 待补四条任务时间 | 已跑通国际站 | 强锐度候选 | 保留为锐度优先候选，待动态验证 |
| BytePlus Fast | 较保守自然；常规观看与其他方案差异不明显 | 0.8264 USD/min，当前最低 | 待补任务时间 | Johor 新版，已跑通 | 成本优先候选 | 当前默认候选 |
| BytePlus Standard/Natural | 部分局部区域略优于Fast；常规观看未见明显提升 | 1.6528 USD/min，约Fast 2倍 | 待补任务时间 | Johor 新版，已跑通 | 平衡候选 | 当前观察不足以证明约2倍溢价，暂不作为默认 |

## 10. 主要官方资料

- [Tencent MPS Audio/Video Enhancement Template](https://www.tencentcloud.com/document/product/1041/48789)
- [Tencent MPS enhancement billing announcement](https://www.tencentcloud.com/document/product/1041/56692)
- [Tencent media processing pricing](https://www.tencentcloud.com/document/product/1045/49489)
- [Tencent MPS ProcessMedia API](https://www.tencentcloud.com/document/product/1041/33640)
- [BytePlus VOD video enhancement template](https://docs.byteplus.com/en/docs/byteplus-vod/docs-image-enhancement-template)
- [BytePlus VOD media processing overview](https://docs.byteplus.com/en/docs/byteplus-vod/docs-media-processing)
- [BytePlus VOD workflows](https://docs.byteplus.com/en/docs/byteplus-vod/docs-workflow)
- [BytePlus VOD pay-as-you-go pricing](https://docs.byteplus.com/en/docs/byteplus-vod/docs-pay-as-you-go-pricing)
- [BytePlus VOD limits](https://docs.byteplus.com/en/docs/byteplus-vod/docs-limits)
- [BytePlus VOD Legacy enhancement template](https://docs.byteplus.com/en/docs/byteplus-vod/docs-video-enhancement-template-legacy)
- [BytePlus LAS Video Super Resolution](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_super-resolution)
