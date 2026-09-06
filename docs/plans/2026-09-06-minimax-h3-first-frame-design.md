# MiniMax H3 首帧图生视频设计

## 目标

在不改变既有 MiniMax H3 文生视频行为的前提下，让 Playground 可以为 `minimax-h3-fl2va` 提交一张首帧图片，并通过现有 Task Plugin 链路调用 ComfyUI 生成视频。

## 已确认事实

- 当前 H3 Task Plugin 只向 ComfyUI `/prompt` 提交一次 JSON 请求，并明确拒绝参考内容。
- 用户导出的 ComfyUI API Format workflow 使用 `LoadImage` 节点，并把其输出连接到 `MiniMaxH3ImageToVideo.first_frame`。
- 用户已在同一台 ComfyUI 机器上用该工作流成功生成 5 秒、H.264 + AAC 的首帧图生视频。
- ComfyUI 本地服务提供 `/upload/image` multipart 上传接口；上传到 `temp` 区域后，`LoadImage` 可通过带 `[temp]` 后缀的路径读取。
- Playground 已有首尾帧上传卡片、图片校验和 Data URL 预览，无需新增一套视觉组件。

## 方案

### 请求链路

```text
Playground 首帧图片
  -> POST /pg/videos（multipart）
  -> Task Plugin prepareRequest
  -> POST ComfyUI /upload/image（multipart）
  -> Task Plugin submitRequest
  -> POST ComfyUI /prompt（JSON workflow）
```

Task Plugin 的提交描述符增加一个可选的 `prepareRequest`。Host 最多执行一次预请求，且只接受与普通 Provider 请求相同的 URL 白名单、方法、Header 和 body 约束。预请求失败时立即终止，不创建伪成功的上游任务。

H3 首帧请求把上传文件命名为基于平台公开任务 ID 的唯一安全文件名，上传到 ComfyUI `temp` 区域；workflow 增加 `LoadImage`，并将 `<filename> [temp]` 接入 `MiniMaxH3ImageToVideo.first_frame`。纯文生视频不返回 `prepareRequest`，workflow 保持原样。

### Playground

复用现有视频生成组件和首帧卡片样式：

- H3 支持文生视频和“首帧”模式。
- H3 首帧模式只显示第一帧卡片，不显示尾帧、交换按钮、通用多素材或参考视频入口。
- 首帧仍使用现有图片格式、单文件 30 MB 和预览校验。
- H3 有首帧时，前端把 Data URL 转成 `File`，以 multipart 提交 `model`、`prompt`、`seconds`、`metadata` 和 `input_reference`；无首帧时继续提交原 JSON。
- Seedance 的现有参考内容和首尾帧行为不变。

### 安全与兼容性

- 不允许插件指定第二个任意请求链；只提供一个可选预请求，避免演变成通用编排器。
- 预请求 URL 继续经过 `ValidateRequestURL`，沿用 Channel Base URL / `allowedHosts` 边界。
- 文件字节由 Go Host 持有；JS 只引用 `request_file:input_reference`，不读取任意本地路径。
- 文件名由 Host 可控的公开任务 ID 和受限扩展名组成，不使用用户原始路径。
- 不新增数据库表、依赖或 Windows 端自定义 ComfyUI 节点。
- 本轮不做尾帧、多图、参考视频和上传后清理编排。使用 ComfyUI `temp` 降低长期残留风险；如真实运行仍积累文件，再单独设计清理策略。

## 错误处理

- 缺少首帧文件、文件引用无效或 multipart 解析失败：请求校验失败。
- ComfyUI 上传返回非 2xx：返回 Provider 错误，不继续 `/prompt`。
- 上传成功但 `/prompt` 失败：按既有任务提交失败链处理；唯一 temp 文件可能短期残留，但不会产生成功任务。
- 纯文生视频不经过上传步骤，因此不引入额外失败点。

## 验证边界

- Go：预请求执行顺序、multipart 文件转发、URL 校验、失败短路、纯提交兼容。
- Plugin：首帧 descriptor、唯一文件名、`LoadImage -> first_frame` 连线、纯 T2V workflow 不变。
- Frontend：H3 能显示单首帧 UI，构造 multipart；纯 T2V 与 Seedance 仍走原链路。
- 本地自动化通过不等于新加坡 ComfyUI 真实验收。合并到 `develop` 后仍需部署，再做有图/无图、音频开关、计费与失败退款 smoke。
