# BytePlus Seedance Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Doubao 任务插件识别 BytePlus Dreamina Seedance 2.0/2.0 Fast，并对视频输入进行有上限的安全预扣，完成后仍按真实 usage 结算。

**Architecture:** 复用 `plugins/tasks/doubao/plugin.js` 作为 Ark 视频协议与计费事实的唯一模块。模型清单负责插件路由；提交用量 hook 对 Dreamina 视频输入加入 15 秒官方总时长上限，完成 hook 继续用 `completion_tokens` 覆盖预估。通用计费表达式、快照和退款模块不修改。

**Tech Stack:** Go 1.25、嵌入式 JavaScript 任务插件、testify、New API billingexpr。

---

### Task 1: Dreamina 模型路由声明

**Files:**
- Modify: `plugins/doubao_responses_test.go`
- Modify: `plugins/tasks/doubao/plugin.js:1-22`

**Step 1: Write the failing test**

在 `plugins/doubao_responses_test.go` 增加测试，加载 `doubao` factory plugin，并断言以下模型可在 `POST /v1/responses` 命中该插件：

```go
models := []string{
    "dreamina-seedance-2-0-260128",
    "dreamina-seedance-2-0-fast-260128",
}
```

**Step 2: Run test to verify it fails**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins -run TestDoubaoDeclaresBytePlusDreaminaModels -count=1`

Expected: FAIL，因为插件尚未声明 Dreamina 模型。

**Step 3: Write minimal implementation**

将两个 Dreamina ID 加入 `meta.models`，把插件版本从 `1.0.0` 升到 `1.1.0`，并让描述同时覆盖 Volcengine Doubao 与 BytePlus Dreamina。

**Step 4: Run test to verify it passes**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins -run TestDoubaoDeclaresBytePlusDreaminaModels -count=1`

Expected: PASS。

### Task 2: BytePlus 视频输入保守预扣

**Files:**
- Create: `plugins/doubao_billing_test.go`
- Modify: `plugins/tasks/doubao/plugin.js:116-151,260-301`

**Step 1: Write the failing tests**

直接调用插件 `extractUsage`，分别断言：

- Dreamina 720p、输出 5 秒、无视频输入仍估算 108000 tokens；
- Dreamina 720p、输出 5 秒、有视频输入按 20 秒（5 + 15）估算 432000 tokens；
- Doubao 720p、输出 5 秒、有视频输入仍维持 108000 tokens，避免改变 upstream 既有行为。

**Step 2: Run tests to verify they fail**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins -run TestDoubaoBytePlusSubmitUsage -count=1`

Expected: Dreamina 视频输入用例 FAIL，实际仍为 108000。

**Step 3: Write minimal implementation**

在插件内部增加仅识别 Dreamina 2.0/2.0 Fast 的小函数；`extractUsage` 检测到视频输入时，为估算秒数增加 15，并继续使用现有 `estimateTokens` 与 3600 秒上限。

**Step 4: Run tests to verify they pass**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins -run TestDoubaoBytePlusSubmitUsage -count=1`

Expected: PASS。

### Task 3: 最终 usage 与失败终态回归

**Files:**
- Modify: `plugins/doubao_billing_test.go`

**Step 1: Add regression tests**

断言 `extractUsageOnComplete` 优先返回 BytePlus 的 `usage.completion_tokens`，并断言 `cancelled`、`expired` 经 `parseTaskResult` 转为 `FAILURE`。

**Step 2: Run focused tests**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins -run 'TestDoubaoBytePlus(CompletionUsage|TerminalFailure)' -count=1`

Expected: PASS；这些行为由 upstream 已有实现提供，测试用于锁定验收契约。

### Task 4: 验证与状态记录

**Files:**
- Modify when milestone changes: `docs/CURRENT_STATE.md`
- Append when appropriate: `WORKLOG.md`

**Step 1: Format and diff checks**

Run: `gofmt -w plugins/doubao_responses_test.go plugins/doubao_billing_test.go`

Run: `git diff --check`

**Step 2: Focused verification**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache go test ./plugins ./relay/channel/task/jsplugin ./service -count=1`

**Step 3: Repository verification**

Run: `GOCACHE=/private/tmp/metis-byteplus-billing-go-cache make test`

**Step 4: Inspect scope**

Run: `git status --short && git diff --stat && git diff`

确认没有 Secret、研究文件、任务外重构或许可证改动。

**Step 5: Commit**

```bash
git add plugins/tasks/doubao/plugin.js plugins/doubao_responses_test.go plugins/doubao_billing_test.go docs/plans/2026-09-01-byteplus-seedance-billing.md
git commit -m "feat(billing): 接入 BytePlus Seedance 任务计费"
```
