# BytePlus Seedance 计费适配设计

## 目标

在不新增数据库字段、不复制任务插件的前提下，让现有 Doubao Video 任务插件识别 BytePlus ModelArk 的 Dreamina Seedance 2.0 与 2.0 Fast 模型，并接入 upstream 已提供的任务用量表达式计费、预扣和完成后差额结算链路。

## 方案选择

采用“扩展现有 `doubao` 任务插件”的方案，而不是新增 `byteplus` 插件或恢复 Go adaptor：BytePlus 与火山引擎使用相同 Ark 视频任务协议，现有插件已经声明 `tokens`、`resolution`、`video_input` 三个计费事实。新增插件会复制请求转换、轮询、产物代理和结算逻辑，增加后续 upstream 同步成本。

管理员仍通过模型定价页面的任务价格矩阵填写 BytePlus 官方美元单价。代码不硬编码会随供应商调整的目录价，也不继续以 `ModelRatio` 作为 Seedance 主计费方式。

## 模型与路由

在 `plugins/tasks/doubao/plugin.js` 的模型清单中增加：

- `dreamina-seedance-2-0-260128`
- `dreamina-seedance-2-0-fast-260128`

保留渠道模型映射，由公开模型名映射到 BytePlus 账户实际接受的上游模型名。插件负责协议和计费事实，渠道映射负责供应商模型名，两者职责不混合。

## 预扣与结算

无视频输入时继续按输出时长、分辨率和 24 fps 估算 Token。

BytePlus 官方计费公式包含“输入视频总时长 + 输出视频时长”，但请求只提供视频 URL，网关无法在不下载并探测媒体的情况下取得准确输入时长。为避免 SSRF、额外流量和提交阶段预扣不足，Dreamina Seedance 2.0/2.0 Fast 检测到视频输入时，按官方允许的输入视频总时长上限 15 秒加入预估。

任务完成后，以 Provider 返回的 `usage.completion_tokens`（回退 `usage.total_tokens`）覆盖提交估算，并使用冻结的计费表达式进行差额结算。任务失败、过期或 Provider 取消时沿用现有失败退款链，不增加用户主动取消接口。

## 数据与兼容性

计费表达式、预估事实和分组倍率继续保存在 `TaskPrivateData.BillingContext.TieredSnapshot`，不新增表、列或 migration。已有 `doubao-seedance-*` 行为保持不变；保守的 15 秒输入预估只对本次新增的 Dreamina 2.0 系列生效。

已有按 Token/倍率配置不会自动迁移。部署代码后，管理员需要把两个 Dreamina 模型切换为“表达式”计费，并在 `resolution × video_input` 矩阵中录入 BytePlus 官方 `USD / M tokens` 价格。

## 验证范围

- Dreamina 2.0/2.0 Fast 被插件声明并可通过共享视频端点选中。
- 文生视频保持原输出 Token 估算。
- 视频输入按 15 秒上限加入预扣 Token 估算，Doubao 模型不受影响。
- 完成响应的 `completion_tokens` 成为最终用量事实。
- `cancelled`、`expired` 仍映射为失败终态。
- 运行插件、任务适配器和任务计费相关测试，再执行仓库规定的最小充分验证。
