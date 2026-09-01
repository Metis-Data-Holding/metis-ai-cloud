# Playground 视频生成实施计划

> 目标：在一轮开发内交付 Seedance 文生视频 MVP，保持现有聊天 Playground 和公共 `/v1/videos` API 兼容。

## 1. 视频模型能力

**修改：** `model/pricing.go`、`model/pricing_endpoint_test.go`、`controller/user.go`、`controller/model_list_test.go`

1. 先增加失败测试：任务插件声明 `openai_video` 后，对应模型的端点能力包含 `openai-video`。
2. 先增加失败测试：`GET /api/user/models?group=default&endpoint_type=openai-video` 只返回视频模型，未传参数仍返回全部模型。
3. 从任务插件路由代际中合并共享协议能力到定价端点缓存。
4. 在用户模型接口中实现可选端点过滤，并保证原响应结构不变。

## 2. Playground 视频代理

**新增/修改：** `middleware/playground.go`、`middleware/playground_test.go`、`router/relay-router.go`、`router/task_plugin_protocol_router_test.go`

1. 先增加失败测试：Dashboard 会话可转换为临时 Playground Token；不可用分组和 PAT 被拒绝。
2. 新增 `PlaygroundVideoAuth`，从查询参数读取分组、校验权限、写入用户和临时 Token 上下文。
3. 将现有聊天 `Distribute` 从 `/pg` Group 调整到聊天路由，保持其行为不变。
4. 注册视频提交、查询和内容路由，复用任务插件、分发、任务查询和制品代理控制器。
5. 路由测试断言三条 `/pg/videos` 路径均已注册且方法正确。

## 3. 前端领域逻辑与 API

**新增/修改：** `web/src/features/playground/types.ts`、`constants.ts`、`api.ts`、`lib/video/*`、对应 `__tests__`

1. 先为请求体构造、Fast 分辨率约束、终态识别写失败测试。
2. 增加视频配置、任务与状态类型。
3. 用户模型请求支持可选 `endpoint_type`。
4. 实现提交、查询、带鉴权 Blob 下载 API。
5. 实现无副作用的参数归一化和请求体构造函数。

## 4. 视频状态机与界面

**新增/修改：** `web/src/features/playground/hooks/use-video-generation.ts`、`components/video/*`、`index.tsx`、对应 `__tests__`

1. 先写 Hook/组件失败测试，覆盖提交、轮询完成、失败、手动重试、Blob 预览和清理。
2. 实现独立 Hook：提交事件直接发请求；React Query 仅负责选项加载，轮询计时器只在非终态存在。
3. 实现视频表单、任务状态卡、视频播放器和下载按钮。
4. 在 Playground 顶部增加聊天/视频切换；聊天组件仅在聊天模式挂载。
5. 无视频模型时展示空状态并禁用提交；切换 Fast 时自动修正分辨率。

## 5. i18n 与项目状态

**修改：** `web/src/i18n/locales/en.json`、`web/src/i18n/locales/zh.json` 及仓库现有其他 locale；`docs/CURRENT_STATE.md`、`WORKLOG.md`

1. 所有新增用户可见文本通过 `t()`。
2. 以英文 key/fallback 同步所有 locale，至少中英文提供准确翻译，其他语言保持英文回退语义。
3. 更新当前状态和工作记录，明确 MVP 已覆盖与未覆盖项。

## 6. 验证

1. 运行新增 Go 测试和相关 router/controller/model/middleware 测试。
2. 运行前端受影响测试，再运行完整 `bun run test`。
3. 运行 `bun run typecheck`、`bun run lint`、`bun run format:check`、`bun run build`。
4. 运行 `gofmt -l`、相关 Go build；如完整 `make test` 受时长或环境限制，明确记录。
5. 检查 `git diff`、`git status`、Secret 和任务外文件；完成独立代码审查后再提交实现。
