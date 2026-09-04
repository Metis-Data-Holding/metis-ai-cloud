# Playground Model Display Name Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变实际模型 ID 和既有客户端契约的前提下，让 Playground 模型选择器优先显示模型显示名称并保留模型 ID。

**Architecture:** `/api/user/models` 保留字符串数组，并新增可选的显示名称映射。Playground API 层将映射转换为 `ModelOption.label`，选择器用 `value` 保留模型 ID，并在下拉项中按需显示为次级文本。

**Tech Stack:** Go、Gin、React 19、TypeScript、Vitest、React Testing Library、Bun

---

### Task 1: 扩展用户模型响应

**Files:**
- Modify: `controller/user.go`
- Modify: `controller/model_list_test.go`

**Step 1:** 新增失败测试，断言 `data` 仍是字符串数组，且响应附带已配置的非空显示名称映射。

**Step 2:** 运行 `GOWORK=off go test ./controller -run 'TestGetUserModels'`，确认新测试因映射缺失而失败。

**Step 3:** 在 `GetUserModels` 中按最终筛选后的模型集合读取显示名称并新增响应字段，不改变 `data`。

**Step 4:** 重新运行定向 Go 测试，确认通过。

### Task 2: 转换 Playground 模型选项

**Files:**
- Modify: `web/src/features/playground/api.ts`
- Modify: `web/src/features/playground/types.ts`
- Create: `web/src/features/playground/__tests__/model-options.test.ts`

**Step 1:** 新增失败测试，覆盖显示名称、空白名称及旧后端响应的回退行为。

**Step 2:** 运行定向 Vitest，确认失败原因是当前 API 仍把模型 ID 作为 label。

**Step 3:** 扩展 `ModelOption`，解析可选映射；`value` 始终保留模型 ID。

**Step 4:** 重新运行定向 Vitest，确认通过。

### Task 3: 调整模型选择器展示

**Files:**
- Modify: `web/src/components/model-group-selector.tsx`
- Create: `web/src/components/model-group-selector/__tests__/display-name.test.tsx`

**Step 1:** 新增失败交互测试，断言展开项显示显示名称及次级模型 ID，触发器不重复显示 ID，并可通过模型 ID 搜索。

**Step 2:** 运行定向 Vitest，确认当前单行实现无法满足断言。

**Step 3:** 为模型项增加按需次级 ID，复用现有搜索数据并保持选中回调传递 `value`。

**Step 4:** 重新运行定向 Vitest，确认通过。

### Task 4: 验证与集成

**Files:**
- Verify only

**Step 1:** 运行 Go 定向测试、前端相关测试、`bun run typecheck`、涉及文件 lint、`bun run format:check` 和 `bun run build`。

**Step 2:** 检查 `git diff`、`git status` 和 Secret/任务外文件。

**Step 3:** 使用 Conventional Commit 提交实现，合并到 `main` 后重复最小测试。

**Step 4:** 推送 `origin/main` 并核对远端提交。
