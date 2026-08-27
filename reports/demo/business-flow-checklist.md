# 老板 Demo 业务闭环验收清单

> 验收日期：2026-08-24
>
> 结论：通过

## 闭环结果

| 环节 | 结果 | 本次证据 |
|---|---|---|
| 普通用户注册 | 通过 | 用户在 Edge 中完成新普通用户注册 |
| 普通用户登录 | 通过 | 新用户正常登录并进入系统 |
| Playground | 通过 | `google/gemma-4-31b` Streaming 调用成功；日志记录输入 293、输出 90 Token，TTFT 1.0 秒、总耗时 5.0 秒 |
| 创建 API Key | 通过 | 新普通用户创建独立 Key，并仅在未跟踪的本地配置中使用 |
| 模型权限 | 通过 | `/v1/models` 仅返回 `google/gemma-4-31b` |
| 非流式 API | 通过 | 输入 19、输出 16 Token，Usage 正常返回 |
| Streaming API | 通过 | SSE 正常结束于 `[DONE]`；输入 19、输出 16 Token，Usage 与非流式口径一致 |
| 可见正文 | 通过 | 64 Token 上限下正常 `finish_reason=stop`，输入 21、输出 50 Token，返回可见正文 |
| Usage / 计费 | 通过 | 三次 API 调用合计输入 59、输出 82 Token；日志逐笔记录并按配置价格计费 |
| 未授权模型拒绝 | 通过 | 使用 Gemma-only Key 请求 `deepseek-v4-flash` 返回 HTTP 403 |
| 拒绝不计费 | 通过 | many-models 后台确认 DeepSeek 403 无消费记录 |

## 计费复核

Gemma 用户侧配置价格为输入 `$1/M Token`、输出 `$2/M Token`。本次四条可见成功记录与理论值一致：

| 场景 | 输入 / 输出 Token | 理论费用 | 页面费用 |
|---|---:|---:|---:|
| API 非流式 | 19 / 16 | $0.000051 | $0.000052 |
| API Streaming | 19 / 16 | $0.000051 | $0.000052 |
| API 可见正文 | 21 / 50 | $0.000121 | $0.000122 |
| Playground | 293 / 90 | $0.000473 | $0.000474 |

页面金额为逐行四舍五入后的显示值。页面顶部当日累计用量包含此前容量测试，不能作为本次闭环费用。

## 演示建议

现场沿用以下顺序：

1. 普通用户登录；
2. Playground 选择 Gemma 并获得 Streaming 回复；
3. 展示只允许 Gemma 的临时 API Key；
4. 调用 API 并查看 Usage / 余额变化；
5. 展示未授权模型被拒绝且不计费。

API Key、密码和完整请求内容不得进入截图、PPT、PDF、HTML 或现场录屏。

## 加权路由功能测试（待执行）

本项作为平台路由能力的补充测试，不改变上方核心业务闭环已经通过的结论。测试目标是：
普通用户仍以 `google/gemma-4-31b` 发起请求，平台在后台按权重将部分请求映射到
`deepseek-v4-flash`，并通过 New API 渠道日志、DeepSeek 官方后台和 LM Studio 日志证明
真实去向。当前已完成[配置与验收方案](./new-api-routing-research.md)和首次执行：Model
Mapping、非流式及 Streaming 均成功。校正两条渠道为同一优先级后，20 个非流式短请求
得到 Gemma 13 次、DeepSeek 7 次，即 65% / 35%，接近目标 70% / 30%；随后 30 个
Streaming 请求全部成功、0 错误。核心功能判定为通过，Streaming 批次的逐渠道命中数仍待
New API 后台日志交叉确认。
