# Playground 视频生成设计

## 目标

在现有 `/playground` 中增加一个可供普通登录用户使用的视频生成入口，首轮支持 BytePlus ModelArk 的 Dreamina Seedance 2.0 与 2.0 Fast 文生视频。用户可以选择分组、模型、时长、分辨率和宽高比，提交异步任务后看到进度、失败信息，并在成功后预览或下载视频。

首轮不包含图片/视频参考输入、任务取消、跨刷新任务恢复、完整历史列表和费用预估。这些能力已有任务日志作为补充入口，避免第一轮同时重做任务管理页面。

## 方案比较

### 方案 A：Playground 内增加独立视频模式（采用）

聊天模式继续沿用现有状态和 `/pg/chat/completions`；视频模式拥有独立表单、异步任务状态和 `/pg/videos` 调用链，只复用分组、模型选择器和基础 UI 组件。

优点是用户入口自然、异步语义清晰，对现有聊天链影响小。代价是需要为浏览器登录态增加一组 Playground 视频代理路由。

### 方案 B：新增独立视频 Playground 页面

页面职责最清楚，但会重复导航、页面布局与选项加载逻辑，也会扩大路由和产品入口范围。首轮没有必要。

### 方案 C：把视频生成塞进聊天 `/v1/responses`

表面改动较少，但同步请求容易被 Cloudflare 超时，任务状态、失败和制品下载也难以准确表达。真实验收已经出现 524，因此不采用。

## 后端设计

### Playground 登录态代理

新增以下仅供登录用户使用的路由：

- `POST /pg/videos?group=<group>`：提交视频任务。
- `GET /pg/videos/:task_id`：查询任务状态。
- `GET /pg/videos/:task_id/content`：读取任务制品。

这些路由复用任务插件的 `openai_video` 解析、渠道选择、任务落库、计费和制品代理，不新增 Provider 协议。新增的 Playground 鉴权中间件把 Dashboard 用户转换为临时内部 Token 上下文，并校验请求分组属于该用户可用分组。PAT 仍按现有 Playground 规则拒绝，避免两套凭据语义混用。

制品在前端通过统一 API 客户端请求 Blob，再创建浏览器 Object URL。不能把受保护的内容地址直接放进 `<video src>`，因为媒体标签不会携带 Dashboard Authorization Header。

### 视频模型能力识别

`GET /api/user/models` 增加可选参数 `endpoint_type=openai-video`。未传参数时响应保持不变；传入时只返回该分组中被任务插件声明支持 `openai_video` 的模型。

能力来自已加载任务插件的协议声明和模型别名解析，不通过 `seedance` 字符串猜测。这样未来接入其他视频插件时，Playground 无需维护模型名称白名单。

## 前端设计

Playground 顶部提供“聊天 / 视频”模式切换。视频模式使用独立组件和 Hook，避免把异步任务状态混入聊天消息与流式生成状态。

表单字段：

- 分组：沿用用户可用分组。
- 模型：调用带 `endpoint_type=openai-video` 的模型接口。
- Prompt：必填。
- 时长：首轮提供常用秒数选项。
- 分辨率：2.0 支持 `480p / 720p / 1080p / 4k`；2.0 Fast 仅展示其当前可用档位 `480p / 720p`。
- 宽高比：写入 `metadata.ratio`。

提交体遵循现有 OpenAI Video 兼容格式：

```json
{
  "model": "dreamina-seedance-2-0-fast-260128",
  "prompt": "...",
  "seconds": 5,
  "metadata": {
    "resolution": "480p",
    "ratio": "16:9"
  }
}
```

提交成功后以固定间隔查询状态；`queued`、`in_progress` 显示状态和进度，`completed` 停止轮询并加载视频 Blob，`failed` 停止轮询并显示上游错误。组件卸载、重新提交或终态到达时清理计时器与 Object URL。

## 错误与边界

- 无可用视频模型时展示明确空状态，不允许提交。
- Prompt 为空、模型为空或参数不合法时在前端阻止提交；后端仍由插件做最终校验。
- 网络查询失败不会伪装成任务失败，用户可手动重试状态查询。
- 失败任务不展示下载按钮；制品加载失败提供重试。
- Fast 模型切换后若当前分辨率不受支持，自动回落到 `720p`。

## 验证范围

- Go：分组校验、临时 Token 上下文、视频模型能力过滤、路由链测试。
- 前端纯逻辑：Fast 分辨率约束、状态终态判断、请求体构造。
- 前端交互：模式切换、表单校验、提交、轮询成功/失败、预览加载失败与下载。
- 完成后运行相关 Go 测试、前端测试、typecheck、lint、format check 和 build。
