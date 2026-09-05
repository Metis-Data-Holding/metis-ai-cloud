# MiniMax H3 文生视频接入设计

## 目标

把新加坡 RTX 5090 上通过 ComfyUI 运行的 MiniMax H3 FL2VA 文生音视频能力接入现有 `/v1/videos` 与视频 Playground，同时复用已有异步任务、轮询、产物代理、日志和表达式计费链路。

第一阶段只支持纯文本生成，不包含首帧、尾帧或 Ref2VA 多模态参考输入。

## 已确认的运行边界

- H3 由 Windows 上的 ComfyUI `0.34.0` 提供服务，不是 LM Studio 模型。
- ComfyUI 监听 Tailscale 私网地址的 `8888` 端口，BytePlus ECS 已能访问 `/system_stats`、`/prompt` 和任务历史接口。
- 当前成功工作流使用 `minimax_h3_fl2va_pruned_int8_convrot.safetensors`、H3 音视频 VAE 和 FL2V Turbo LoRA。
- `CreateVideo` 的 `audio` 是可选输入：有声模式连接 H3 解码音频，无声模式省略该输入。
- H3 Base 使用 24 FPS；时长换算后的帧数需满足工作流的 `17n + 5` 对齐约束。
- 第一阶段输出档位准确标记为 `768p`，不借用 Seedance 的 `720p` 名称。

## 方案选择

采用独立的 Task Plugin 适配 ComfyUI，而不是新增原生 Go Channel，也不在 Windows 上部署额外的 OpenAI Video 包装服务。

理由：

- Task Plugin 已提供 `/v1/videos` 协议绑定、异步任务持久化、轮询失败处理、退款、产物代理和用量事实提取。
- H3 与 ComfyUI 的差异可以局限在一个插件内，避免修改核心 relay 和数据库。
- Channel 的 Base URL 继续由后台配置，仓库不记录主机地址和凭据。
- 未来接入 FL2VA 图片模式或 Ref2VA 时，可以在同一插件中新增明确的模型和能力分支，不需要提前搭建抽象层。

## 模型与协议

- Task Plugin key：`minimax-h3`
- 公共模型 ID：`minimax-h3-fl2va`
- 推荐展示名称：`MiniMax H3`
- 协议：仅声明 `openai_video`
- Channel 类型：使用现有 `Task Plugin` Channel，不占用旧 Channel 类型编号
- 鉴权：插件本身使用 `auth: "none"`；网络边界由 Tailscale 与 Windows 防火墙限制，不把 ComfyUI 暴露到公网

H3 模型仍通过 `/v1/videos` 对外呈现，客户端不接触 ComfyUI 的节点 ID、文件路径或输出文件名。

## 请求与工作流转换

插件只接受 JSON 请求，并验证：

- `model` 必须是 `minimax-h3-fl2va`；
- `prompt` 去除首尾空白后不能为空；
- `seconds` 为 `5` 到 `15` 的整数；
- `metadata.resolution` 只能是 `768p`；
- `metadata.ratio` 只能是 `16:9`、`9:16`、`1:1`、`4:3` 或 `3:4`；
- `metadata.generate_audio` 必须是布尔值；
- 第一阶段如果携带 `metadata.content`，直接返回明确的不支持错误，避免误以为参考内容已经生效。

画幅映射：

| 画幅 | 宽 × 高 |
|---|---:|
| `16:9` | `1344 × 768` |
| `9:16` | `768 × 1344` |
| `1:1` | `768 × 768` |
| `4:3` | `1024 × 768` |
| `3:4` | `768 × 1024` |

帧数沿用已验证工作流的计算方式：先计算 `round(seconds × 24)`，再向上对齐到满足 `frameCount % 17 == 5` 的帧数。

插件内保存最小 ComfyUI API 工作流模板，只动态替换提示词、宽高、帧数、音频连接和随机种子。随机种子由每个任务唯一的 `publicTaskId` 稳定哈希得到：同一任务重试保持一致，不同任务获得不同 seed。

## 异步任务与产物

1. `POST /v1/videos` 经插件转换为 `POST {baseUrl}/prompt`。
2. 从返回值读取 `prompt_id`，作为上游任务 ID 保存。
3. 后台轮询 `GET {baseUrl}/history/{prompt_id}`：
   - 无历史记录：`IN_PROGRESS`；
   - ComfyUI 状态成功且存在 `SaveVideo` 输出：`SUCCESS`；
   - 状态错误、执行被中断或缺少有效视频输出：`FAILURE`；
   - 无法识别的响应：`UNKNOWN`，交给现有轮询失败阈值处理。
4. 成功后从历史结果中保存经过校验的 `filename`、`subfolder` 和 `type`。
5. `/v1/videos/{task_id}/content` 通过插件构造 `{baseUrl}/view` 请求，由网关代理视频内容；不向客户端暴露 Tailscale 地址。

ComfyUI 历史接口不提供与当前任务稳定关联的实时百分比，因此第一阶段只展示排队/生成中状态，完成时显示 `100%`，不伪造中间进度。

## Playground

现有 Playground 继续通过 `endpoint_type=openai-video` 获取模型。前端把 H3 识别为视频模型，并按模型能力返回参数：

- H3 只显示 `768p`；
- 保留现有五种画幅；
- 保留 `5–15 秒`；
- 保留有声/无声开关；
- H3 下隐藏或禁用参考内容与首尾帧入口，只允许纯文本提交；
- Seedance 的现有参数、上传和请求结构保持不变。

模型列表和已选模型继续使用后台“展示名称”，请求仍使用稳定模型 ID。

## 计费

插件声明以下用量事实：

- `seconds`：请求视频时长；
- `resolution`：固定为 `768p`；
- `audio`：是否输出音频。

H3 是自托管模型，没有可直接采用的官方零售价。本次不在 `builtin_billing.go` 添加臆造价格，也不写入旧 ratio 表。管理员需在启用模型前为 `minimax-h3-fl2va` 配置显式 billing expression；提交时按请求参数预扣，任务失败沿用现有异步退款链。

## 错误与安全

- 提交响应缺少 `prompt_id` 时拒绝建成有效任务。
- 轮询响应和输出文件字段均按白名单结构解析，URL 参数逐项编码。
- ComfyUI 返回错误时，只向用户返回清理后的简短原因，不泄露本机路径、工作流全文或提示词。
- 仓库不写入 Tailscale IP、Windows 路径、API Key、真实提示词或测试素材。
- ComfyUI 当前没有确认的应用层鉴权；正式启用前必须确认 Windows 防火墙仅允许指定 Tailscale 来源访问 `8888`。
- MiniMax H3 使用专门的 Community License。公网开放范围和商业使用条件需由项目方独立确认；代码接入通过不代表许可证审查完成。

## 测试与验收

采用 TDD，至少覆盖：

- 插件 manifest、模型与协议声明；
- 合法请求生成正确的 ComfyUI 工作流；
- 五种画幅、5/15 秒边界和帧数对齐；
- 有声/无声工作流连接差异；
- 不同任务 seed 不同、同一任务 seed 稳定；
- 非法参数和参考内容被拒绝；
- `/prompt`、任务进行中、成功、失败和异常响应解析；
- 视频产物发现与 `/view` 内容请求；
- 用量事实与表达式计费输入；
- Playground 只为 H3 提供 `768p` 和纯文本模式，Seedance 行为不回归。

本地自动化通过后，再进行需要用户授权的真实回归：配置 H3 Task Plugin Channel 和定价，提交一条短提示词任务，核对生成、轮询、下载、任务日志、扣费与失败退款。真实生成会占用 GPU，不作为自动测试的一部分。
