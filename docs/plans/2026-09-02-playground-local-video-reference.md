# Playground Local Reference Video Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让已登录用户在 Playground 上传本地 MP4/MOV 作为 Seedance 参考视频，并通过 ECS 上的 50 小时签名 URL 安全提供给 BytePlus。

**Architecture:** 新增一个独立的临时参考视频存储服务：上传接口流式写入 `/data/video-reference-uploads`，公开内容接口仅接受带过期时间的 HMAC 签名并用 `http.ServeContent` 支持 HEAD/Range。前端复用现有参考素材组件，上传成功后仍生成现有 `video_url/reference_video` 请求，不修改 Doubao 插件协议。项目现有系统任务框架每小时清理 50 小时正式文件和 1 小时中断文件。

**Tech Stack:** Go 1.25、Gin、React 19、TypeScript、Axios、Vitest、React Testing Library、现有 SystemTask 框架。

---

### Task 1: 后端存储、校验与签名能力

**Files:**
- Create: `service/video_reference_upload.go`
- Test: `service/video_reference_upload_test.go`

**Step 1: Write the failing tests**

覆盖：MP4/MOV 文件签名识别、80 MB 上限、`.uploading` 原子落盘、随机且不可穿越的文件 ID、50 小时 HMAC URL 签发和过期/篡改拒绝、清理 50 小时正式文件与 1 小时中断文件。

**Step 2: Run tests to verify they fail**

Run: `GOWORK=off go test ./service -run 'Test(VideoReference|CleanupVideoReference)' -count=1`

Expected: FAIL，因为服务与导出函数尚不存在。

**Step 3: Write minimal implementation**

实现 `SaveVideoReference`、`BuildVideoReferenceContentURL`、`VerifyVideoReferenceAccess`、`OpenVideoReference`、`CleanupVideoReferenceUploads`。目录、当前时间与随机 ID 使用可测试的参数或包内 seam；读取时用 `io.LimitedReader` 强制 `80*1024*1024` 上限，文件名只采用服务端生成的 ID 和已识别扩展名。

**Step 4: Run tests to verify they pass**

Run: `GOWORK=off go test ./service -run 'Test(VideoReference|CleanupVideoReference)' -count=1`

Expected: PASS。

**Step 5: Commit**

```bash
git add service/video_reference_upload.go service/video_reference_upload_test.go
git commit -m "feat(playground): 增加参考视频临时存储"
```

### Task 2: 上传与签名内容 API

**Files:**
- Create: `controller/video_reference_upload.go`
- Modify: `router/api-router.go`
- Modify: `router/relay-router.go`
- Modify: `router/relay_router_test.go`
- Test: `controller/video_reference_upload_test.go`

**Step 1: Write the failing tests**

增加路由契约及 handler 测试：Dashboard Session 才能 POST 单个 multipart 文件；成功返回 `id/url/name/size/content_type`；无文件、格式错误、超限返回稳定错误；签名 GET/HEAD/Range 返回正确状态与头；过期或篡改签名拒绝。

**Step 2: Run tests to verify they fail**

Run: `GOWORK=off go test ./controller ./router -run 'Test(VideoReference|RelayRouter)' -count=1`

Expected: FAIL，因为路由和 handler 尚不存在。

**Step 3: Write minimal implementation**

在 `/api/playground/video-reference-files` 增加受 `UserAuth` 保护的 POST；在 `/v1/video-reference-files/:file_id/content` 增加无需 Token、但必须验证 `expires` 与 `access` 的 GET/HEAD。上传响应使用现有 JSON response 形式，内容响应交给 `http.ServeContent` 并设置 `Cache-Control: private, no-store`。

**Step 4: Run tests to verify they pass**

Run: `GOWORK=off go test ./controller ./router -run 'Test(VideoReference|RelayRouter)' -count=1`

Expected: PASS。

**Step 5: Commit**

```bash
git add controller/video_reference_upload.go controller/video_reference_upload_test.go router/api-router.go router/relay-router.go router/relay_router_test.go
git commit -m "feat(playground): 提供参考视频上传与读取接口"
```

### Task 3: 定时清理任务

**Files:**
- Modify: `model/system_task.go`
- Modify: `controller/system_task_handlers.go`
- Test: `controller/system_task_test.go`

**Step 1: Write the failing test**

断言 `video_reference_cleanup` handler 已注册、始终启用、间隔一小时，并将扫描/删除/释放字节/失败统计写入成功结果；目录级失败写入失败终态。

**Step 2: Run test to verify it fails**

Run: `GOWORK=off go test ./controller -run TestVideoReferenceCleanupHandler -count=1`

Expected: FAIL，因为新任务类型与 handler 尚不存在。

**Step 3: Write minimal implementation**

新增 `SystemTaskTypeVideoReferenceCleanup`，注册 `videoReferenceCleanupHandler`，调用 Task 1 的清理服务；保持现有调度器首次启动扫描、数据库租约和每小时周期语义。

**Step 4: Run test to verify it passes**

Run: `GOWORK=off go test ./controller -run TestVideoReferenceCleanupHandler -count=1`

Expected: PASS。

**Step 5: Commit**

```bash
git add model/system_task.go controller/system_task_handlers.go controller/system_task_test.go
git commit -m "feat(system-task): 定时清理参考视频临时文件"
```

### Task 4: 前端上传 API 与媒体元数据校验

**Files:**
- Modify: `web/src/features/playground/constants.ts`
- Modify: `web/src/features/playground/api.ts`
- Modify: `web/src/features/playground/types.ts`
- Create: `web/src/features/playground/lib/video/video-reference-upload.ts`
- Test: `web/src/features/playground/lib/video/__tests__/video-reference-upload.test.ts`

**Step 1: Write the failing tests**

覆盖 MP4/MOV 与 80 MB 边界、2～15 秒单文件、合计 15 秒、混合引用最多 3 个；验证 multipart 上传使用统一 `api`、返回数据被归一化且上传进度可传给调用方。

**Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-reference-upload.test.ts`

Expected: FAIL，因为校验和上传函数尚不存在。

**Step 3: Write minimal implementation**

新增 `uploadVideoReference(file, onProgress)` 和纯校验函数；媒体时长通过临时 object URL 与隐藏 `<video>` 读取，所有 object URL 在完成或失败后释放。

**Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-reference-upload.test.ts`

Expected: PASS。

**Step 5: Commit**

```bash
git add web/src/features/playground/constants.ts web/src/features/playground/api.ts web/src/features/playground/types.ts web/src/features/playground/lib/video/video-reference-upload.ts web/src/features/playground/lib/video/__tests__/video-reference-upload.test.ts
git commit -m "feat(playground): 增加本地参考视频上传客户端"
```

### Task 5: Playground 参考视频交互

**Files:**
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/zh.json`
- Modify: `web/src/i18n/locales/zh-TW.json`
- Modify: `web/src/i18n/locales/ja.json`
- Modify: `web/src/i18n/locales/ko.json`
- Modify: `web/src/i18n/locales/fr.json`
- Modify: `web/src/i18n/locales/ru.json`

**Step 1: Write the failing component tests**

从用户视角覆盖：选择本地视频后显示上传状态和进度；成功卡片显示文件名/大小/时长并提交返回 URL；失败可重试/移除；本地视频与 URL/asset 共享 3 个名额；总时长超限阻止上传；切换首尾帧清空引用状态。

**Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: FAIL，因为本地视频入口尚不存在。

**Step 3: Write minimal implementation**

在现有参考生成区域增加本地 MP4/MOV input 和素材卡片；上传完成后把服务端签名 URL 写成现有 `VideoReferenceContent`。提交按钮在上传中或引用无效时禁用，不把 `File` 或 Data URL 长期保存在表单状态。

**Step 4: Add all locale strings**

为选择视频、上传中、文件大小、格式、单段/总时长、名额和上传失败等文案同步补全七种 locale；不改已有品牌或归属文本。

**Step 5: Run tests to verify they pass**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: PASS。

**Step 6: Commit**

```bash
git add web/src/features/playground/components/video/video-reference-input.tsx web/src/features/playground/components/video/video-playground.tsx web/src/features/playground/components/video/__tests__/video-playground.test.tsx web/src/i18n/locales/*.json
git commit -m "feat(playground): 支持上传本地参考视频"
```

### Task 6: 回归、构建和部署配置核对

**Files:**
- Modify if needed: `deploy/byteplus/compose.yml`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`

**Step 1: Run focused backend and frontend tests**

Run: `GOWORK=off go test ./service ./controller ./router -run 'Test(VideoReference|CleanupVideoReference|RelayRouter)' -count=1`

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-reference-upload.test.ts src/features/playground/lib/video/__tests__/video-generation.test.ts src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: PASS。

**Step 2: Run static checks**

Run: `gofmt -l service/video_reference_upload.go service/video_reference_upload_test.go controller/video_reference_upload.go controller/video_reference_upload_test.go controller/system_task_handlers.go controller/system_task_test.go model/system_task.go router/api-router.go router/relay-router.go router/relay_router_test.go`

Expected: no output。

Run: `cd web && bun run typecheck && bun run lint && bun run format:check`

Expected: PASS；若全仓旧问题导致失败，记录与本次文件的关系并至少确保涉及文件无 error。

**Step 3: Run builds and broader tests**

Run: `cd web && bun run build`

Run: `GOWORK=off go test ./...`

Run: `cd relaykit && GOWORK=off go build ./...`

Expected: PASS。

**Step 4: Verify deployment mount**

Run: `docker compose -f deploy/byteplus/compose.yml config`

Expected: `/data/metis-ai-cloud/shared/app-data:/data` 仍存在；仅当当前配置不足时才修改 compose。

**Step 5: Update project state and commit**

记录“本地测试通过但尚未等同于线上 BytePlus 验收”，并给出部署后的真实上传、生成、计费、预览、下载检查清单。

```bash
git add docs/CURRENT_STATE.md WORKLOG.md deploy/byteplus/compose.yml
git commit -m "docs(playground): 更新本地参考视频验收状态"
```
