# Async Task Usage Log Adaptation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 异步任务完成后在使用日志展示实际计费 Token，并将计费日志标签区分为预扣、补扣和退款。

**Architecture:** 任务结算时持久化最终用量快照；读取日志时按 `task_id` 批量补充安全展示字段；React 表格从结构化字段派生标签和 Token。历史日志、费用统计和任务耗时链路保持不变。

**Tech Stack:** Go、GORM、Gin、React 19、TypeScript、Vitest、i18next

---

### Task 1: 持久化任务最终用量

**Files:**
- Modify: `model/task.go`
- Modify: `service/task_polling.go`
- Test: `service/task_billing_test.go`

1. 先添加失败测试，证明成功结算应设置并持久化“用量已结算”状态和最终 `UsageFacts`。
2. 运行定向 Go 测试并确认因缺少持久化而失败。
3. 为任务计费快照增加向后兼容的结算标记，并在表达式结算成功后写回 `private_data`。
4. 重新运行测试并确认通过。

### Task 2: 查询日志时批量补充实际 Token

**Files:**
- Modify: `model/log.go`
- Test: `model/log_task_usage_test.go`

1. 添加失败测试，覆盖未完成任务不补充、成功结算任务补充小数 `task_usage_tokens`。
2. 实现按页面日志 `task_id` 去重并批量读取任务的补充逻辑。
3. 在管理员与普通用户日志查询路径调用补充逻辑；失败时返回查询错误，不产生部分错误数据。
4. 运行模型层定向测试。

### Task 3: 适配前端标签与 Token 单值展示

**Files:**
- Modify: `web/src/features/usage-logs/types.ts`
- Modify: `web/src/features/usage-logs/components/columns/common-logs-columns.tsx`
- Create: `web/src/features/usage-logs/components/__tests__/async-task-display.test.tsx`
- Modify: `web/scripts/add-missing-keys.mjs`
- Modify: `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json`（仅由脚本生成）

1. 添加失败测试，覆盖预扣、补扣、退款标签及任务完成前后的 Token。
2. 添加结构化字段类型和纯展示派生逻辑。
3. 通过 i18n 脚本补充“补扣”等多语言文案并运行同步脚本。
4. 运行前端定向测试、类型检查、Lint 与格式检查。

### Task 4: 综合验证与提交

**Files:**
- Review: all files changed above

1. 运行相关 Go 测试与前端测试。
2. 运行前端构建，检查 `git diff --check`、状态、敏感信息和任务外文件。
3. 更新必要的当前状态记录，按范围分别提交文档与实现。
