# Playground Video Composer Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将视频生成表单重构为统一组合输入框，并支持 1–4 条独立异步任务的提交与结果展示。

**Architecture:** 保留现有请求构造、参考内容上传和单任务状态轮询。新增组合输入组件与参数面板；批量提交层只负责顺序创建任务并保存任务列表，每个结果项继续通过独立查询轮询和获取制品。

**Tech Stack:** React 19、TypeScript、React Hook Form、TanStack Query、Base UI/shadcn、Tailwind CSS、Vitest、Testing Library、i18next。

---

### Task 1: 用测试定义组合输入框结构

**Files:**
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`
- Test: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

**Step 1: Write the failing tests**

覆盖空状态居中、参数摘要与弹层、模式下拉、展开/收起、箭头提交按钮、提交后底部布局。

**Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/features/playground/components/video/__tests__/video-playground.test.tsx`
Expected: FAIL，因为组合输入框与新控件尚不存在。

### Task 2: 定义批量任务行为

**Files:**
- Modify: `web/src/features/playground/hooks/__tests__/use-video-generation.test.tsx`
- Modify: `web/src/features/playground/hooks/use-video-generation.ts`
- Modify: `web/src/features/playground/lib/video/video-form-schema.ts`

**Step 1: Write the failing tests**

验证生成数量限制为 1–4、顺序提交指定数量、部分失败保留成功任务、重置释放状态。

**Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/features/playground/hooks/__tests__/use-video-generation.test.tsx`
Expected: FAIL，因为当前 hook 只保存一个 taskId。

**Step 3: Write minimal implementation**

批量提交层保存任务数组；抽取单任务轮询 hook，维持原有 3 秒轮询、Blob URL 创建与销毁逻辑。

**Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/features/playground/hooks/__tests__/use-video-generation.test.tsx`
Expected: PASS。

### Task 3: 实现组合输入框与参数面板

**Files:**
- Create: `web/src/features/playground/components/video/video-composer.tsx`
- Create: `web/src/features/playground/components/video/video-parameter-panel.tsx`
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-generation-result.tsx`

**Step 1: Implement the composer shell**

复用 `PromptInput`、模式 DropdownMenu、参数 Popover/Sheet、模型选择器与箭头按钮，建立默认/展开状态及响应式工具行。

**Step 2: Integrate reference inputs**

为现有参考内容组件增加 composer 展示变体，不改变上传校验、文件接口与首尾帧交换行为。

**Step 3: Integrate task list**

首次提交后切换为结果区滚动、输入框底部布局；每个任务渲染独立结果项。

**Step 4: Run component tests**

Run: `cd web && ./node_modules/.bin/vitest run src/features/playground/components/video/__tests__/video-playground.test.tsx`
Expected: PASS。

### Task 4: 完成国际化

**Files:**
- Create then delete: `web/scripts/add-missing-keys.mjs`
- Modify through script: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`

**Step 1: Inventory new static keys**

从实际 `t()` 调用确定展开、收起、视频设置、生成数量、部分提交等新文案。

**Step 2: Apply translations through the sanctioned script**

Run: `cd web && node scripts/add-missing-keys.mjs`

**Step 3: Normalize and verify**

Run: `cd web && node scripts/sync-i18n.mjs`
Expected: 七个 locale 同步且新增 key 无缺失。

### Task 5: 全量验证与集成发布

**Files:**
- Modify if status materially changes: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`

**Step 1: Run focused and full validation**

Run from `web/`: `./node_modules/.bin/tsgo -b`、`./node_modules/.bin/vitest run`、`./node_modules/.bin/oxlint -c .oxlintrc.json <modified files>`、`node scripts/format-with-protected-headers.mjs --check <modified files>`、`./node_modules/.bin/rsbuild build`。

**Step 2: Review diff and secrets**

Run: `git status --short` and `git diff --check`，只纳入本任务文件。

**Step 3: Commit, integrate, and push**

在功能分支提交；确认 main/origin/main 基线后以 `--ff-only` 合并，推送 `origin main`。

**Step 4: Trigger and verify deployment Action**

使用仓库既有 GitHub Actions 手动触发 `Deploy BytePlus ECS`，等待 Action 完成并报告 workflow run URL 与真实结果。若不可变 release 冲突，先核对镜像与 release 标识，不覆盖已有 release。

### Task 6: 校准组合输入框视觉

**Files:**
- Modify: `web/src/features/playground/components/video/video-composer.tsx`
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`
- Modify if needed: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`

**Step 1: Write failing regression tests**

覆盖参考入口左对齐、参考区与提示区等高、白色语义输入表面、宽模式菜单、首尾帧水平布局以及尾帧文案。

**Step 2: Verify the tests fail for the current UI**

Run: `cd web && ./node_modules/.bin/vitest run src/features/playground/components/video/__tests__/video-playground.test.tsx`

**Step 3: Apply the minimum visual changes**

复用现有 DropdownMenu、PromptInput 和参考内容上传组件，只调整组合方式、语义样式与响应式布局。

**Step 4: Verify affected and full frontend checks**

Run from `web/`: targeted Vitest, full Vitest, `tsgo -b`, affected-file oxlint and format check, then Rsbuild production build.
