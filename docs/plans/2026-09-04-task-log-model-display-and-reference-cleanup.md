# 任务日志模型展示与参考内容清理实施计划

> **执行说明：** 按测试先行逐项完成，每个任务只修改列出的范围。

**目标：** 增加可配置模型展示名称并用于异步任务日志，同时为参考内容清理任务补充中文名称、真实进度和结果详情。

**架构：** 模型表增加可选 `display_name`，定价缓存同时承载模型展示元数据，任务初始化时将展示名称快照写入现有 JSON 属性。清理服务接受可选进度回调，系统任务复用现有进度 reporter；前端用纯函数解析任务模型副标题和清理结果，组件只负责渲染。

**技术栈：** Go、GORM、React、TypeScript、Vitest、i18next。

---

### 任务一：模型展示名称元数据

**文件：**
- 修改：`model/model_meta.go`
- 修改：`model/pricing.go`
- 修改：`model/task.go`
- 测试：`model/pricing_endpoint_test.go`
- 测试：`model/task_openai_video_test.go`

1. 先写失败测试，验证模型展示名称进入定价元数据，并在任务初始化时保存 `display_model_name`。
2. 增加可选字段、缓存传播和回退解析。
3. 运行相关 Go 测试确认转绿。

### 任务二：模型管理配置入口

**文件：**
- 修改：`web/src/features/models/types.ts`
- 修改：`web/src/features/models/lib/model-form.ts`
- 修改：`web/src/features/models/components/drawers/model-mutate-drawer.tsx`
- 新增测试：`web/src/features/models/lib/__tests__/model-display-name.test.ts`
- 修改：`web/src/i18n/locales/*.json`

1. 先写表单转换失败测试。
2. 增加可选“Display Name”表单字段及 API 类型传播。
3. 同步全部 locale 的新增文案并运行目标测试。

### 任务三：任务日志模型展示

**文件：**
- 修改：`web/src/features/usage-logs/types.ts`
- 新增：`web/src/features/usage-logs/lib/task-log-display.ts`
- 新增测试：`web/src/features/usage-logs/lib/__tests__/task-log-display.test.ts`
- 修改：`web/src/features/usage-logs/components/columns/task-logs-columns.tsx`

1. 先写失败测试，覆盖展示名、请求模型 ID、动作三层回退。
2. 实现纯解析函数并接入任务日志副标题。
3. 运行目标测试。

### 任务四：参考视频清理真实进度

**文件：**
- 修改：`service/video_reference_upload.go`
- 修改：`service/video_reference_upload_test.go`
- 修改：`controller/system_task_handlers.go`
- 修改：`controller/video_reference_cleanup_handler_test.go`

1. 先写失败测试，验证目录不存在时完成进度，以及每个目录项处理后的进度序列。
2. 为清理服务增加可选回调并在 handler 中接入现有 system task reporter。
3. 运行 service/controller 目标测试。

### 任务五：系统任务中文名称与详情

**文件：**
- 新增：`web/src/features/system-info/lib/system-task-display.ts`
- 新增测试：`web/src/features/system-info/lib/__tests__/system-task-display.test.ts`
- 修改：`web/src/features/system-info/components/system-tasks-panel.tsx`
- 修改：`web/src/features/system-settings/types.ts`
- 修改：`web/src/i18n/locales/*.json`

1. 先写失败测试，覆盖中文名称对应的源 key、结果摘要及失败信息优先级。
2. 接入任务名称和详情格式化；成功任务显示扫描、清理、失败和释放空间。
3. 运行目标测试。

### 任务六：验证、提交与集成

1. 运行本次相关 Go 测试、`gofmt -l`。
2. 运行前端目标测试、全量测试、类型检查、Lint、格式检查和构建。
3. 检查 diff、未跟踪文件和敏感信息，仅暂存本任务文件。
4. 提交功能分支，合并回 `main` 后再次运行关键验证。
5. 推送 `origin/main`，核对远端提交及部署 Action 状态。
