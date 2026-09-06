# MiniMax H3 首帧图生视频实施计划

> 后续演进：用户在 ComfyUI 验证首尾帧工作流后，平台在保留本计划单首帧兼容性的基础上扩展为可选尾帧；提交描述符支持最多两个顺序预请求，当前状态以 `docs/CURRENT_STATE.md` 为准。

> **Required skill:** Use `superpowers:executing-plans` to execute this plan task-by-task.

**Goal:** 复用现有 Playground 视频 UI，为 MiniMax H3 增加单首帧图生视频，并以一次受控预上传衔接 ComfyUI `/upload/image` 与 `/prompt`。

**Architecture:** Task Plugin 请求描述符增加单个可选 `prepareRequest`，Go Host 在正常提交前执行它；H3 插件仅在收到 `input_reference` 时声明 ComfyUI 图片上传并生成带 `LoadImage` 的 workflow；前端仅对 H3 首帧请求改用 multipart。

**Tech Stack:** Go 1.25、Gin、GORM 无变更、Goja JS Plugin、React 19、TypeScript、React Hook Form、Vitest、Bun。

---

### Task 1: Task Plugin 单次预请求

**Files:**
- Modify: `relay/channel/task/jsplugin/adaptor.go`
- Test: `relay/channel/task/jsplugin/adaptor_test.go`

1. 在现有 adaptor 集成测试中新增插件 descriptor 含 `prepareRequest` 的案例，断言 `/upload/image` 在 `/submit` 前收到 multipart 文件。
2. 运行 `go test ./relay/channel/task/jsplugin -run Prepare`，确认测试先因能力缺失而失败。
3. 为 `requestDescriptor` 增加单个可选预请求，并复用现有 descriptor URL 校验和 multipart body 构造。
4. 在 `DoRequest` 前执行预请求；非 2xx 或网络错误直接返回，不发送主请求。
5. 增加 URL 越界、失败短路和无预请求兼容测试，逐项红绿。
6. 运行 `gofmt` 与该包测试。

### Task 2: H3 插件首帧 workflow

**Files:**
- Modify: `plugins/tasks/minimax-h3/plugin.js`
- Modify: `plugins/minimax_h3_test.go`

1. 新增 multipart 协议解码与首帧 descriptor 测试，断言上传字段、`temp` 类型和唯一文件名。
2. 新增 workflow 测试，断言 `LoadImage` 输出连接到 `MiniMaxH3ImageToVideo.first_frame`；保留现有纯 T2V 断言。
3. 运行 `go test ./plugins -run MinimaxH3`，确认新增测试先失败。
4. 最小修改请求归一化、协议解码与 workflow 生成；只接受一个 `input_reference`。
5. 运行插件格式检查与 `go test ./plugins -run MinimaxH3`。

### Task 3: Playground 复用单首帧 UI

**Files:**
- Modify: `web/src/features/playground/types.ts`
- Modify: `web/src/features/playground/api.ts`
- Modify: `web/src/features/playground/lib/video/video-generation.ts`
- Modify: `web/src/features/playground/lib/video/__tests__/video-generation.test.ts`
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-composer.tsx`
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

1. 新增行为测试：H3 不再是纯文本限定模型，首帧模式只允许一张首帧，并把首帧请求标记为 multipart。
2. 运行对应 Vitest 文件，确认测试先失败。
3. 为现有首尾帧组件增加 `firstFrameOnly` 能力开关，复用卡片、校验、预览和移除交互。
4. 保持 H3 文生视频入口；选择首帧模式时仅呈现首帧卡片。
5. 在 API 层把 H3 首帧 Data URL 转成 `File`/`FormData`；Seedance 与 H3 纯 T2V 继续使用 JSON。
6. 运行两个相关 Vitest 文件、`bun run typecheck` 和涉及文件 lint。

### Task 4: 集成验证与状态记录

**Files:**
- Modify: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`

1. 运行 `go test ./plugins ./relay/channel/task/jsplugin`。
2. 运行前端相关测试、`bun run typecheck`、`bun run lint`、`bun run format:check` 和 `bun run build`；无法运行的项目明确记录原因。
3. 检查 `git diff --check`、`gofmt -l`、`git status` 和差异中是否含 Secret/临时文件。
4. 更新状态：代码已进入 `develop` 候选，但真实新加坡 ComfyUI 首帧链路仍待部署 smoke；不得提前写成生产已验证。

### Task 5: 审查、提交与集成

1. 以 `origin/develop` 为固定点执行 Standards 与 Spec 双轴审查；修复有效发现并重新验证。
2. 使用 Conventional Commits 提交小而完整的中文 commit。
3. 将功能分支 fast-forward 合并到本地 `develop` 工作树。
4. 推送 `origin/develop`，核对远端 SHA 与本地一致。
5. 不合并 `main`，不部署；等待 `develop` 部署后的真实首帧、音频、计费与失败退款验收。
