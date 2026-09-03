# Playground Video Reference Mentions Implementation Plan

**Goal:** 实现参考素材堆叠/展开展示、稳定 `@图片N/@视频N` 引用和 Seedance 2.0 分辨率条件回归保护。

**Architecture:** 新增纯函数从 `VideoInputContent[]` 派生素材名称与引用词；参考输入组件只负责保持上传顺序和展示，组合输入框负责提示词引用菜单，现有请求构造继续原样透传有序 `metadata.content`。

**Tech Stack:** React 19、TypeScript、Base UI、Tailwind CSS、Vitest、Testing Library、i18next。

---

### Task 1: 用测试固定素材顺序和引用契约

**Files:**
- Modify: `web/src/features/playground/components/video/__tests__/video-playground.test.tsx`
- Modify: `web/src/features/playground/lib/video/__tests__/video-generation.test.ts`

先写失败测试，覆盖混合素材上传顺序、素材名称、`@` 插入、仅视频保留 1080p、图片场景隐藏 1080p。

### Task 2: 增加素材描述与顺序处理

**Files:**
- Create: `web/src/features/playground/lib/video/video-reference-assets.ts`
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`

以内容数组为事实来源生成类型内编号；混合文件按用户选择顺序读取/上传，再一次性写回内容数组。首尾帧继续单独排序。

### Task 3: 实现素材堆叠、展开和提示词引用

**Files:**
- Modify: `web/src/features/playground/components/video/video-reference-input.tsx`
- Modify: `web/src/features/playground/components/video/video-composer.tsx`

实现正方形堆叠预览、悬浮/聚焦展开托盘、素材标签和删除动作；在 textarea 光标附近的输入状态上提供 `@` 候选菜单并插入稳定引用词。

### Task 4: 国际化与验证

**Files:**
- Modify: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`

补齐占位文案和素材名称相关翻译，运行定向测试、全量测试、类型检查、Lint、格式检查和生产构建。

### Task 5: 提交、合并与推送

仅暂存本轮文件，在功能分支提交；确认远端 `main` 基线后 fast-forward 合并到本地主分支并推送 `origin main`。
