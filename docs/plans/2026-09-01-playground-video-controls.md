# Playground Video Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将视频参数统一为可滚动分段选择器，支持 5–15 秒时长，并为 Seedance 请求增加默认关闭的同步音频开关。

**Architecture:** 保留现有 React Hook Form 与视频任务链，新增一个只负责展示和滚动的可复用分段选择组件。表单值仍由 `VideoPlayground` 管理，纯函数将 `generateAudio` 映射为上游可识别的 `metadata.generate_audio`。

**Tech Stack:** React 19、TypeScript、React Hook Form、Zod、Base UI/shadcn `ToggleGroup`、`ScrollArea`、`Button`、`Switch`、Vitest、Testing Library、Bun。

---

### Task 1: 扩展视频请求契约

**Files:**
- Modify: `web/src/features/playground/constants.ts`
- Modify: `web/src/features/playground/types.ts`
- Modify: `web/src/features/playground/lib/video/video-form-schema.ts`
- Modify: `web/src/features/playground/lib/video/video-generation.ts`
- Test: `web/src/features/playground/lib/video/__tests__/video-generation.test.ts`

**Step 1: Write the failing test**

在请求构造测试中使用 `seconds: 15` 与 `generateAudio: false`，期望请求包含：

```ts
metadata: {
  resolution: '480p',
  ratio: '16:9',
  generate_audio: false,
}
```

并为 schema 增加 5、15 通过，4、16 拒绝的边界测试。

**Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-generation.test.ts`

Expected: FAIL，因为 `generateAudio` 尚未定义且时长仍仅允许 5/10。

**Step 3: Write minimal implementation**

- 将时长常量改为 5–15 的静态只读数组。
- 将 schema 改为整数且范围为 5–15。
- 在配置类型中增加 `generateAudio: boolean`。
- 在请求类型中增加 `metadata.generate_audio: boolean`。
- 在纯函数中完成 camelCase 到 snake_case 映射。

**Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-generation.test.ts`

Expected: PASS。

### Task 2: 增加复用的分段选择组件

**Files:**
- Create: `web/src/features/playground/components/video/video-segmented-control.tsx`
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Test: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

**Step 1: Write the failing component tests**

从用户视角断言：

- 页面提供 5–15 秒共 11 个选项；
- 选择 15 秒后提交的请求为 `seconds: 15`；
- 三组参数位于统一的分段选择容器；
- 时长控件存在“向前滚动”和“向后滚动”可访问按钮。

**Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: FAIL，因为页面仍为独立 outline pills 且只有 5/10 秒。

**Step 3: Write minimal implementation**

创建 `VideoSegmentedControl`：

- 用现有 `ToggleGroup` 渲染离散选项；
- 外层使用 `bg-muted`、圆角和内边距，选中项使用现有主题 token；
- `scrollable` 时用现有 `ScrollArea` 横向承载选项，并使用现有 `Button` 与 Hugeicons 箭头调用 viewport 的 `scrollBy`；
- 不保存滚动像素到 React state，避免滚动过程触发重渲染；
- 保留 `aria-labelledby`、禁用状态和单选不可清空逻辑。

在 `VideoPlayground` 中用该组件替换三处重复的 `ToggleGroup`。

**Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: PASS。

### Task 3: 增加同步音频开关

**Files:**
- Modify: `web/src/features/playground/components/video/video-playground.tsx`
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/zh.json`
- Modify: `web/src/i18n/locales/zh-TW.json`
- Modify: `web/src/i18n/locales/ja.json`
- Modify: `web/src/i18n/locales/fr.json`
- Modify: `web/src/i18n/locales/ru.json`
- Modify: `web/src/i18n/locales/vi.json`

**Step 1: Write the failing component tests**

断言默认提交包含 `generate_audio: false`；打开“生成音频”后提交包含 `generate_audio: true`。

**Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: FAIL，因为页面没有音频开关。

**Step 3: Write minimal implementation**

- 默认表单值增加 `generateAudio: false`。
- 使用现有 `Switch`，通过 `checked` 与 `onCheckedChange` 更新表单。
- 添加简短说明：关闭时输出静音视频，可减少音频版权审核失败。
- 所有用户可见文本接入各 locale。

**Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- src/features/playground/components/video/__tests__/video-playground.test.tsx`

Expected: PASS。

### Task 4: 完整前端验证

**Files:**
- Verify all modified frontend files.

**Step 1: Run focused tests**

Run: `cd web && bun run test -- src/features/playground/lib/video/__tests__/video-generation.test.ts src/features/playground/components/video/__tests__/video-playground.test.tsx src/features/playground/hooks/__tests__/use-video-generation.test.tsx`

Expected: PASS。

**Step 2: Run static checks**

Run: `cd web && bun run typecheck && bun run lint && bun run format:check`

Expected: all commands exit 0。

**Step 3: Run build**

Run: `cd web && bun run build`

Expected: production build exits 0。

**Step 4: Review scope**

Run: `git diff --check && git status --short`

Expected: 仅包含本功能文件；用户已有未跟踪研究资料保持未暂存。
