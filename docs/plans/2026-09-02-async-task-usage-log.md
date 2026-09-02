# Async Task Usage Log Adaptation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将异步任务计费日志标签区分为预扣费、补扣和退款。

**Architecture:** React 使用日志界面从现有结构化字段派生标签。后端、历史日志、Token、费用统计和任务耗时链路保持不变。

**Tech Stack:** React 19、TypeScript、Vitest、i18next

---

### Task 1: 添加标签派生测试

**Files:**
- Create: `web/src/features/usage-logs/lib/__tests__/async-task-display.test.ts`

1. 添加失败测试，覆盖预扣费、补扣、退款与普通消耗。
2. 运行定向测试并确认缺少派生函数时失败。

### Task 2: 接入桌面、移动端和详情展示

**Files:**
- Modify: `web/src/features/usage-logs/lib/utils.ts`
- Modify: `web/src/features/usage-logs/types.ts`
- Modify: `web/src/features/usage-logs/components/columns/common-logs-columns.tsx`
- Modify: `web/src/features/usage-logs/components/usage-logs-mobile-card.tsx`
- Modify: `web/src/features/usage-logs/components/dialogs/details-dialog.tsx`

1. 根据 `is_task` 派生“预扣费”。
2. 根据正向 `pre_consumed_quota` / `actual_quota` 差额派生“补扣”。
3. 保持退款和普通消费标签不变。
4. 在桌面表格、移动端卡片和日志详情复用同一派生函数。

### Task 3: 同步多语言文案

**Files:**
- Modify: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`（仅由脚本生成）

1. 通过临时 i18n 脚本补充“补扣”的七种语言文案。
2. 运行同步脚本并删除临时脚本。

### Task 4: 综合验证与提交

**Files:**
- Review: all files changed above

1. 运行前端定向测试、类型检查、Lint、格式检查与构建。
2. 运行前端构建，检查 `git diff --check`、状态、敏感信息和任务外文件。
3. 仅提交本次展示适配相关文件。
