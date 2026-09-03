# 视频参考素材托盘布局 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让多个参考素材在折叠态呈现稳定交错堆叠，展开后占用真实布局空间且不覆盖提示词。

**Architecture:** 在 `VideoReferenceInput` 内统一管理托盘的折叠、展开与首次上传抑制状态，通过回调把展开状态传给 `VideoComposer`。父级根据该状态调整参考素材列宽，托盘在受限宽度内横向滚动；卡片旋转角度由素材序号确定，展开时归零。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library。

---

### Task 1: 锁定托盘布局回归

**Files:**
- Test: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

1. 增加两个素材的上传用例，断言折叠卡片具有不同的固定旋转角度。
2. 触发托盘重新悬浮，断言参考素材父区域进入受限展开宽度，托盘启用内部横向滚动，卡片旋转归零。
3. 运行目标用例，确认当前实现失败。

### Task 2: 实现受控展开与稳定交错

**Files:**
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-composer.tsx`

1. 在参考素材组件中增加受控的展开状态及 `onExpandedChange` 回调。
2. 保留首次上传后的展开抑制；鼠标真正离开后再次进入才展开，键盘聚焦仍可访问。
3. 使用素材序号循环生成固定旋转角度，折叠时应用、展开时清零。
4. 父级素材区域在展开时占用最多 46% 的真实布局宽度；素材超出后在托盘内部滚动，不覆盖提示词。
5. 运行目标用例，确认通过。

### Task 3: 验证与集成

**Files:**
- Test: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

1. 运行组件测试、完整前端测试、类型检查、受影响文件 lint、格式检查与生产构建。
2. 检查 diff、未跟踪文件与敏感信息，仅提交本次文件。
3. 合并回 `main`，在合并结果上重新运行关键测试，然后推送 `origin/main`。
