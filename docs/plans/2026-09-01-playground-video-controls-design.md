# Playground 视频参数控件设计

## 目标

完善 Seedance 视频 Playground 的参数选择体验，并允许用户明确关闭同步音频，避免仅依赖提示词控制音频而触发上游版权审核。

## 交互设计

- 将“耗时”统一改为“时长”。
- 时长提供 5 至 15 秒的逐秒离散选项，默认 5 秒。
- 时长、分辨率和画面比例统一使用现有 `ToggleGroup` 组成分段选择器：外层为弱化背景，选中项为清晰的独立块。
- 时长选择器使用现有 `ScrollArea` 承载横向内容，并在两侧使用现有 `Button` 提供滚动操作；触控板、触屏和键盘操作仍可直接使用。
- 增加现有 `Switch` 实现的“生成音频”开关，默认关闭。关闭时向上游发送 `generate_audio: false`，开启时发送 `true`。
- 任务提交期间所有参数控件保持禁用，避免界面值与已提交请求不一致。

## 数据与组件

- 扩展视频表单和请求类型，增加 `generateAudio: boolean`。
- `buildVideoGenerationRequest` 将其转换为 `metadata.generate_audio`，由现有 Doubao 插件原样转发给 BytePlus。
- 将 `VIDEO_DURATION_OPTIONS` 从 `[5, 10]` 扩展为 `[5, 6, ..., 15]`，Zod 校验改为 5 至 15 的整数范围。
- 不新增后端接口、Provider 参数适配或第三方依赖。

## 错误与边界

- 单选组不允许通过再次点击清空当前值。
- 模型切换后继续复用现有分辨率归一化逻辑。
- 横向滚动按钮只改变滚动位置，不引入业务状态；滚动边界由浏览器自然裁剪。
- 失败任务继续展示上游错误，计费退款沿用既有异步任务终态处理。

## 验证

- 单元测试覆盖 5–15 秒请求与 `metadata.generate_audio`。
- 组件测试覆盖默认静音、音频开关、11 个时长选项、选定时长提交，以及统一分段容器。
- 运行 Playground 专项测试、前端 typecheck、lint、format check 和 build。
