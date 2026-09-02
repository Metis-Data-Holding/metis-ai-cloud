# Playground Reference Content UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一参考图片与本地参考视频入口，移除前端 URL 输入，并为首尾帧提供可访问的交换按钮。

**Architecture:** 继续由 `VideoReferenceInput` 管理输入校验、图片 Data URL 和视频临时上传；将两个 file input 收敛为支持混合多选的一个 input，不修改 API、DTO 或后端。首尾帧交换只调整现有 `VideoInputContent` 的 role，并复用现有 Button 与 Hugeicons。

**Tech Stack:** React 19、TypeScript、React Testing Library、Vitest、Base UI、Tailwind CSS、i18next。

---

### Task 1: 用测试锁定参考内容交互

**Files:**
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

**Step 1: Write the failing test**

- 把已有图片和本地视频用例改为通过 `Add reference content` 选择。
- 增加一次混合选择图片与视频并提交两种 role 的用例。
- 断言参考视频 URL 输入和添加按钮不再渲染。

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: FAIL，因为统一入口尚不存在，旧 URL 控件仍存在。

### Task 2: 用测试锁定首尾帧交换

**Files:**
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

**Step 1: Write the failing test**

- 断言首尾帧 fieldset 的可访问名称为 `First and last frames`。
- 断言只有一帧时交换按钮禁用；两帧齐全后点击交换并核对提交 payload 的 role 与 Data URL 对调。

**Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: FAIL，因为当前仍为 `Keyframes` 和装饰箭头。

### Task 3: 实现统一参考内容入口

**Files:**
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`

**Step 1: Write minimal implementation**

- 删除前端 URL 字段状态、校验和渲染。
- 使用一个支持图片和 MP4/MOV 的多选 input。
- 按现有限额校验图片和视频，读取图片并顺序上传视频，再同步 `reference_image` 与 `reference_video` 内容。
- 保留已上传视频卡片、删除和模式切换保护。

**Step 2: Run affected tests**

Run: `node node_modules/vitest/vitest.mjs run src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: 统一入口相关用例 PASS。

### Task 4: 实现首尾帧交换与国际化

**Files:**
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Create temporarily then delete: `web/scripts/add-missing-keys.mjs`
- Modify through script: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`

**Step 1: Write minimal implementation**

- 将 legend 从 `Keyframes` 改用已有 `First and last frames`。
- 使用 `ArrowLeftRightIcon`、`HugeiconsIcon` 和现有 Button 替换字符箭头。
- 双帧存在时交换 role；否则按钮禁用。
- 通过临时脚本新增 `Add reference content` 与 `Swap first and last frames` 翻译，再运行 `i18n:sync`，最后删除脚本。

**Step 2: Run affected tests**

Expected: 全部视频 Playground 用例 PASS。

### Task 5: 完整验证与集成

**Files:**
- Verify only: all changed frontend files

**Step 1: Run validation**

- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/@typescript/native-preview/bin/tsgo.js -b`
- `node node_modules/oxlint/bin/oxlint -c .oxlintrc.json <changed tsx files>`
- `node scripts/format-with-protected-headers.mjs --check <changed files if supported>`；如脚本仅支持全仓库则运行全量检查。
- `node node_modules/@rsbuild/core/bin/rsbuild.js build`

Expected: tests、typecheck、lint、format 和 build 全部通过。

**Step 2: Commit**

精确暂存本次文件，检查 diff 与 Secret 后提交中文 Conventional Commit。

**Step 3: Merge and push**

确认 `origin/main` 无新提交后，将功能分支合并到 `main`，再次运行关键验证并推送 `origin main`。
