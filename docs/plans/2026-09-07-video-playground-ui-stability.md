# 视频 Playground 输入区稳定性实施计划

> **Required skill:** Use `superpowers:test-driven-development` while executing this plan.

**Goal:** 以最小前端差异修复视频模式切换空白、模型名截断和首尾帧错误提示。

**Architecture:** 复用现有 Composer、参考输入组件和通用模型选择器；仅调整视频页布局类名与 i18n 文案，不新增组件、状态、接口或依赖。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、i18next、Vitest。

---

### Task 1: 添加回归测试

**Files:**
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`

1. 断言首尾帧容器桌面端按内容宽度占位，不再使用固定 `22rem`。
2. 断言首尾帧模式使用不含 `@` 的专用提示文案。
3. 断言视频页模型选择按钮为 `16rem`，并有窄视口上限。
4. 运行定向测试并确认新增断言先失败。

### Task 2: 实现最小修复

**Files:**
- Modify: `web/src/features/playground/components/video/video-composer.tsx`
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/zh.json`

1. 首尾帧外层和内部控件组在桌面端改用内容宽度。
2. 只加宽视频 Composer 的模型选择触发按钮。
3. 用清晰分支计算三类模式的提示词占位文案并补齐中英文翻译。
4. 重跑定向测试直至通过。

### Task 3: 验证、审查与集成

1. 运行 `bun run typecheck`、定向测试、`bun run lint`、`bun run format:check` 和 `bun run build`。
2. 检查差异、Secret、临时文件和任务外改动，并进行独立代码审查。
3. 使用中文 Conventional Commit 提交。
4. 快进合并到 `develop`，推送 `origin/develop`。
5. 触发 BytePlus 的 `develop` 部署 Action，等待结果并做公网布局复核。
