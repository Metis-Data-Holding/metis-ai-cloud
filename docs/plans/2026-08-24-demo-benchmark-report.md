# 老板 Demo、Serving Benchmark 与汇报实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立可复现、无 Secret 的测试工具和执行流程，完成业务闭环验收、Singapore Gemma 分层容量测试、DeepSeek 官方参考，并输出老板版汇报材料。

**Architecture:** 使用 Go 标准库实现跨平台 OpenAI-compatible Streaming Benchmark 工具，以 JSON 配置定义测试路径和负载，原始结果写入本地忽略目录。Windows 与 ECS 分别采集资源指标；聚合程序生成 CSV / JSON，再由报告和演示材料引用，确保原始数据、测试结论和汇报图表可追溯。

**Tech Stack:** Go 1.25.1 标准库、OpenAI-compatible Chat Completions / SSE、Bash、PowerShell、Markdown、PPTX / PDF / HTML。

---

## 实施边界

- 默认在独立实现分支 / worktree 执行，不在 `main` 直接开发。
- 第一阶段只实现测试工具和离线测试；通过测试后才运行线上负载。
- API Key 只从环境变量读取，不出现在参数、配置、日志、结果或报告中。
- 用户负责在平台 UI 配置 DeepSeek Key；Codex 不读取、不索取、不回显 Key。
- 每次上探并发前检查停止条件；未经确认不运行故障注入。
- DeepSeek 仅作为体验、质量、成本和多 Provider 参考，不做官方容量上限测试。
- 运行态结果按采集时间报告；仓库文档和历史验收不代替测试当天现场检查。

## 计划文件布局

```text
cmd/serving-benchmark/
├── main.go
└── main_test.go

internal/servingbenchmark/
├── config.go
├── config_test.go
├── client.go
├── client_test.go
├── runner.go
├── runner_test.go
├── summary.go
├── summary_test.go
└── testdata/
    ├── stream-success.txt
    └── stream-error.txt

benchmark/serving/
├── README.md
├── config.example.json
├── prompts.json
├── quality-rubric.csv
└── monitor/
    ├── ecs-monitor.sh
    └── windows-nvidia-monitor.ps1

reports/demo/
├── business-flow-checklist.md
├── benchmark-report.md
├── executive-summary.md
└── demo-script.md

artifacts/benchmarks/<run-id>/
├── requests.jsonl
├── summary.json
├── summary.csv
├── environment.json
├── gpu.csv
└── ecs.csv
```

`artifacts/benchmarks/` 默认不提交；报告只引用经过检查、脱敏和确认的聚合结果。

### Task 1: 建立测试工具契约与忽略边界

**Files:**
- Create: `benchmark/serving/README.md`
- Create: `benchmark/serving/config.example.json`
- Create: `benchmark/serving/prompts.json`
- Modify: `.gitignore`

**Step 1: 写明 CLI 和数据契约**

在 README 固定以下命令形状：

```bash
BENCHMARK_API_KEY='由用户在本机设置' \
go run ./cmd/serving-benchmark run \
  --config benchmark/serving/config.local.json \
  --path public-gemma \
  --profile short-answer \
  --concurrency 1 \
  --requests 20 \
  --output artifacts/benchmarks/<run-id>
```

配置仅允许保存非敏感字段：路径名、Base URL、模型、请求参数、超时和 API Key 环境变量名。

**Step 2: 创建最小示例配置**

示例配置至少包含：

```json
{
  "paths": {
    "public-gemma": {
      "base_url": "https://many-models.metisdata.ai/v1",
      "model": "google/gemma-4-31b",
      "api_key_env": "BENCHMARK_API_KEY",
      "request_overrides": {}
    },
    "public-deepseek": {
      "base_url": "https://many-models.metisdata.ai/v1",
      "model": "deepseek-v4-flash",
      "api_key_env": "BENCHMARK_API_KEY",
      "request_overrides": {
        "thinking": {"type": "disabled"}
      }
    }
  }
}
```

不要在示例中保存真实 Channel 地址、Tailscale 地址或 Key。

**Step 3: 定义 Prompt profiles**

`prompts.json` 包含 `short-answer`、`long-generation` 和可选 `long-context`；固定 system message、user message、`max_tokens`、`temperature` 和是否 Streaming。

**Step 4: 忽略本地配置和原始结果**

只增加以下精确规则：

```gitignore
benchmark/serving/config.local.json
artifacts/benchmarks/
```

**Step 5: 验证**

Run:

```bash
git check-ignore benchmark/serving/config.local.json artifacts/benchmarks/example/requests.jsonl
git diff --check
```

Expected: 两个路径均被忽略，`git diff --check` 无输出。

**Step 6: Commit**

```bash
git add .gitignore benchmark/serving/README.md benchmark/serving/config.example.json benchmark/serving/prompts.json
git commit -m "test(benchmark): 定义模型容量测试契约"
```

### Task 2: 实现配置读取与 Secret 门禁

**Files:**
- Create: `internal/servingbenchmark/config.go`
- Create: `internal/servingbenchmark/config_test.go`

**Step 1: 写失败测试**

测试以下行为：

- 能读取合法路径和 profile；
- `api_key`、`authorization`、`credential` 等敏感配置字段出现时拒绝启动；
- 环境变量不存在时返回只包含变量名、不包含值的错误；
- Base URL 仅允许 `http` / `https`；
- 请求数、并发、超时和输出上限必须为正数且有合理上限；
- 配置必须包含不可绕过的最大并发、请求总数、运行总时长、单请求输出 Token、上下文和可选官方 API 预算上限；超过上限时拒绝启动。

关键接口：

```go
type PathConfig struct {
    BaseURL   string         `json:"base_url"`
    Model     string         `json:"model"`
    APIKeyEnv string         `json:"api_key_env"`
    RequestOverrides map[string]any `json:"request_overrides"`
}

func LoadConfig(path string) (Config, error)
func ResolveAPIKey(path PathConfig, getenv func(string) string) (string, error)
```

**Step 2: 运行失败测试**

Run:

```bash
GOWORK=off go test ./internal/servingbenchmark -run 'TestLoadConfig|TestResolveAPIKey' -v
```

Expected: FAIL，提示实现缺失。

**Step 3: 最小实现**

使用 `common/json.go` wrapper 解析 JSON；显式检查未知敏感字段。错误信息只引用字段名或环境变量名。所有新写 Go 测试按仓库规则使用 `testify/require` 做前置 / 致命断言，使用 `testify/assert` 做非致命断言。

**Step 4: 运行通过测试**

Run:

```bash
GOWORK=off go test ./internal/servingbenchmark -run 'TestLoadConfig|TestResolveAPIKey' -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add internal/servingbenchmark/config.go internal/servingbenchmark/config_test.go
git commit -m "test(benchmark): 增加配置与凭据安全门禁"
```

### Task 3: 实现 Streaming 请求与 TTFT 采集

**Files:**
- Create: `internal/servingbenchmark/client.go`
- Create: `internal/servingbenchmark/client_test.go`
- Create: `internal/servingbenchmark/testdata/stream-success.txt`
- Create: `internal/servingbenchmark/testdata/stream-error.txt`

**Step 1: 写失败测试**

使用 `httptest.Server` 验证：

- 请求路径为 `/chat/completions`；
- Authorization Header 正确发送，但不进入结果；
- TTFT 从请求发出到第一个非空内容 / reasoning delta；
- 正确识别 `[DONE]`；
- 解析最终 Usage；
- `stream_options.include_usage` 可配置，Provider 未返回 Usage 时结果明确标为 unavailable，不补零；
- `request_overrides` 合并到请求 JSON 顶层，DeepSeek 请求实际包含顶层 `"thinking":{"type":"disabled"}` 且不包含 `"request_overrides"`；
- HTTP 非 2xx、SSE error、超时和中断分别分类；
- 错误正文中的疑似 Key 被替换为 `[REDACTED]`。

关键返回结构：

```go
type RequestResult struct {
    RequestID        string         `json:"request_id"`
    StartedAt        time.Time      `json:"started_at"`
    DurationMS       float64        `json:"duration_ms"`
    TTFTMS           float64        `json:"ttft_ms"`
    PromptTokens     int            `json:"prompt_tokens"`
    CompletionTokens int            `json:"completion_tokens"`
    ReasoningTokens  int            `json:"reasoning_tokens"`
    UsageAvailable   bool           `json:"usage_available"`
    OutputTokensPS   float64        `json:"output_tokens_per_second"`
    HTTPStatus       int            `json:"http_status"`
    ErrorClass       string         `json:"error_class,omitempty"`
    Success          bool           `json:"success"`
    Metadata         map[string]any `json:"metadata,omitempty"`
}
```

**Step 2: 运行失败测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestStreamingClient -v
```

Expected: FAIL。

**Step 3: 最小实现**

使用 `net/http`、`bufio.Scanner` 和 `common/json.go`；增加 Scanner buffer 上限。生成速度从首个有效 Token 到完成时间计算，不能用总请求时间代替。合并 `request_overrides` 时保留工具控制的 `model`、`messages`、`stream` 和安全上限，禁止覆盖 Authorization 或目标 URL。

**Step 4: 运行通过测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestStreamingClient -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add internal/servingbenchmark/client.go internal/servingbenchmark/client_test.go internal/servingbenchmark/testdata
git commit -m "test(benchmark): 采集流式请求与首 Token 延迟"
```

### Task 4: 实现并发执行、停止条件与 JSONL 输出

**Files:**
- Create: `internal/servingbenchmark/runner.go`
- Create: `internal/servingbenchmark/runner_test.go`

**Step 1: 写失败测试**

覆盖：

- closed-loop worker 数等于并发数；
- 完成的成功 / 失败请求总数精确等于计划请求数；
- context 取消后不再启动新请求；
- 连续失败阈值、总错误率阈值和健康检查失败会触发停止；
- 每个结果立即 append 到 `requests.jsonl` 并执行安全 flush；
- 输出中不存在 Authorization Header、API Key 或完整响应正文。

**Step 2: 运行失败测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestRunner -v
```

Expected: FAIL。

**Step 3: 最小实现**

实现固定请求数和固定时长两种终止条件。默认停止条件：连续 5 次失败或最近 20 次错误率超过 10%；实际测试配置可更严格。增加费用 / Token 累计门禁，达到配置预算后不再启动新请求。

**Step 4: 运行通过测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestRunner -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add internal/servingbenchmark/runner.go internal/servingbenchmark/runner_test.go
git commit -m "test(benchmark): 增加并发执行与自动停止"
```

### Task 5: 实现统计汇总

**Files:**
- Create: `internal/servingbenchmark/summary.go`
- Create: `internal/servingbenchmark/summary_test.go`

**Step 1: 写失败测试**

用确定输入验证：

- P50 / P95 计算；有效样本少于 100 时 P95 必须标记为 exploratory；
- 成功率、错误率和超时率；
- 单请求 Output Tokens/s 中位数；
- Aggregate Output Tokens/s；
- Requests/min；
- 小样本不输出 P99；
- 失败请求不污染成功延迟分位数；
- 缺失 Usage 明确标为 unavailable，不补零。

**Step 2: 运行失败测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestSummarize -v
```

Expected: FAIL。

**Step 3: 最小实现**

聚合结果同时写 `summary.json` 和一行 `summary.csv`。CSV 至少包含 run ID、路径、模型、profile、并发、请求数、成功率、P50 / P95 TTFT、P50 / P95 latency、单请求与 Aggregate Output Tokens/s。

**Step 4: 运行通过测试**

```bash
GOWORK=off go test ./internal/servingbenchmark -run TestSummarize -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add internal/servingbenchmark/summary.go internal/servingbenchmark/summary_test.go
git commit -m "test(benchmark): 生成容量测试聚合指标"
```

### Task 6: 实现 CLI 与本地 Smoke

**Files:**
- Create: `cmd/serving-benchmark/main.go`
- Create: `cmd/serving-benchmark/main_test.go`
- Modify: `Makefile`

**Step 1: 写失败测试**

验证：

- `validate` 不发网络请求；
- `run` 必须显式给出路径、profile、并发和输出目录；
- 输出目录已存在且非空时拒绝覆盖；
- CLI 输出只显示路径名、模型和运行 ID，不显示 Key；
- SIGINT 能够安全停止并保留已完成结果。

**Step 2: 运行失败测试**

```bash
GOWORK=off go test ./cmd/serving-benchmark -v
```

Expected: FAIL。

**Step 3: 最小实现**

增加 Make targets：

```make
benchmark-test:
	GOWORK=off go test ./internal/servingbenchmark ./cmd/serving-benchmark

benchmark-build:
	GOWORK=off go build ./cmd/serving-benchmark
```

**Step 4: 完整测试**

```bash
make benchmark-test
make benchmark-build
gofmt -l cmd/serving-benchmark/*.go internal/servingbenchmark/*.go
```

Expected: tests / build PASS，`gofmt -l` 无输出。

**Step 5: Commit**

```bash
git add Makefile cmd/serving-benchmark
git commit -m "test(benchmark): 提供可执行容量测试命令"
```

### Task 7: 增加 Windows 与 ECS 资源监控脚本

**Files:**
- Create: `benchmark/serving/monitor/windows-nvidia-monitor.ps1`
- Create: `benchmark/serving/monitor/ecs-monitor.sh`
- Modify: `benchmark/serving/README.md`

**Step 1: Windows 脚本语法与安全测试**

脚本只调用 `nvidia-smi`，采集 timestamp、GPU 名称、驱动、显存、利用率、温度和功耗。输出路径必须由用户显式指定；不读取环境中的 Key。

示例：

```powershell
.\windows-nvidia-monitor.ps1 -OutputPath .\gpu.csv -IntervalSeconds 1
```

若现场不是 NVIDIA 或 `nvidia-smi` 不可用，明确输出 unsupported，不伪造数据。

**Step 2: ECS 脚本语法与安全测试**

脚本采集时间、load、内存、网络统计和指定容器的 `docker stats --no-stream`。不得读取 `/etc/metis-ai-cloud/*.env` 或打印容器环境变量。

```bash
bash -n benchmark/serving/monitor/ecs-monitor.sh
shellcheck benchmark/serving/monitor/ecs-monitor.sh
```

Expected: PASS。

**Step 3: 更新协作说明**

README 写清：用户运行 Windows 监控；Codex 运行或指导 ECS 监控；两个监控的时间必须使用带时区 ISO 8601，便于与请求数据对齐。

**Step 4: Commit**

```bash
git add benchmark/serving/monitor benchmark/serving/README.md
git commit -m "test(benchmark): 增加测试资源监控脚本"
```

### Task 8: 建立业务闭环验收清单

**Files:**
- Create: `reports/demo/business-flow-checklist.md`

**Step 1: 写清单**

每项包含：操作、期望结果、实际结果、证据、时间、是否通过和备注。至少包括：

1. 注册；
2. 登录与刷新会话；
3. Playground Gemma Streaming；
4. 创建限模型 Token；
5. `/v1/models`；
6. 非流式 Chat Completions；
7. Streaming 与 `[DONE]`；
8. Usage 返回；
9. Token / 用户 / 日志 Billing 对账；
10. 未授权模型 HTTP 403 且不计费；
11. 管理员日志页面展示和筛选。

**Step 2: Secret 检查**

确认清单明确禁止记录 Cookie、Token、API Key、Provider Base URL Credential 和完整敏感请求 Header。

**Step 3: 用户与 Codex 联合执行**

用户执行浏览器步骤；Codex记录脱敏结果并只引用必要截图。失败项保持失败，不为演示补写成功。

**Step 4: Commit 模板**

完成验收并检查证据后才提交：

```bash
git add reports/demo/business-flow-checklist.md
git commit -m "test(demo): 记录核心业务闭环验收"
```

### Task 9: 运行低负载 Smoke 与并发 1 分层基线

**Files:**
- Create locally: `benchmark/serving/config.local.json`（忽略，不提交）
- Create locally: `artifacts/benchmarks/<run-id>/`（忽略，不提交）

**Step 1: 当天现场门禁**

检查本地 Git 状态、ECS release、app / PostgreSQL / Redis、Tailscale、LM Studio 和公网 `/api/status`。只报告非敏感状态。

**Step 2: 用户准备 Token 与监控**

用户在自己的终端设置环境变量并启动 Windows 监控；Key 值不发送给 Codex。

**Step 3: validate**

```bash
go run ./cmd/serving-benchmark validate \
  --config benchmark/serving/config.local.json
```

Expected: 配置、Prompt 和输出路径检查 PASS，不发模型请求。

**Step 4: 公网并发 1 Smoke**

先运行 1 次，再运行 5 次。确认 Streaming、TTFT、Usage、结果写入和停止信号正常。

**Step 5: A / B / C / D 基线**

每条路径使用短问答，预热后采集至少 20 个成功样本作为探索性基线。若某路径因现场权限不能由 Codex直接执行，由用户运行同一跨平台工具并只回传脱敏结果目录。

**Step 6: 检查点**

结果表必须同时记录“压测机 × 被测路径”，四条路径只作为包含式对照，不直接相减为网络、Cloudflare或Gateway耗时。优先比较同一ECS压测机发起的B / C嵌套路径；其他差异只用于发现异常路径。20个样本的P95标为探索性；若结果无法解释，停止进入高并发，先修正测试路径、连接复用或时间同步。

### Task 10: 运行公网并发阶梯与稳定性测试

**Files:**
- Create locally: `artifacts/benchmarks/<run-id>/`

**Step 1: 短问答阶梯**

依次运行并发 1、2、4、8、16。每档预热后运行至少3分钟且完成至少30个请求，作为快速探测；关键拐点重复两轮。快速探测只能报告本轮观测值，不能据此声称成功率达到99%。

**Step 2: 内容生成阶梯**

使用固定输出上限重复并发阶梯。若低并发已触发停止条件，不继续上探。在并发1基线完成后、首次高并发前，双方先把本次Demo的TTFT、单请求Output Tokens/s和超时门槛写入run metadata。

**Step 3: 每档检查**

检查错误率、TTFT、单请求生成速度、Aggregate Output Tokens/s、GPU / 显存、ECS资源和LM Studio状态。

**Step 4: 确定候选稳定并发**

使用设计文档中的稳定容量定义，不简单选择“没有报错的最大数字”。候选档位至少收集100个有效样本后才正式报告P95；若要声称“成功率不低于99%”，应完成约300个零失败样本，否则只报告实际观测的N/N。

**Step 5: 30分钟稳定性测试**

在准备声称的“已验证稳定并发”上运行约30分钟。测试结束后重新执行健康检查，并观察指标是否恢复。验证通过后，再将其70%～80%单独列为保守运行建议值，不能把较低并发的soak当作较高并发已稳定的证据。

**Step 6: 瓶颈复核**

在拐点并发下选择性重复 A / B / C，结合固定压测机的配对路径、GPU、网络和Gateway资源证据缩小瓶颈范围。未经独立证据支持不做组件级因果归因。

**Step 7: 可选 arrival-rate ramp**

在closed-loop结果稳定后，使用硬性请求数、时长、并发和Token上限运行短时固定到达率ramp，观察突发到达、排队和超时。若不执行，报告明确说明容量只代表持续在途请求数，不能外推峰值RPS或注册用户数。

### Task 11: 接入 DeepSeek 并完成参考测试

**Files:**
- Modify locally: `benchmark/serving/config.local.json`（忽略，不提交）
- Create: `benchmark/serving/quality-rubric.csv`

**Step 1: 用户配置 Channel**

用户在平台后台创建 DeepSeek 官方 Channel，直接填写专用 API Key；使用 `deepseek-v4-flash`，配置测试价格并限制测试 Token 可访问模型。不得把 Key 或完整 Credential 截图发给 Codex。

**Step 2: 功能 Smoke**

通过 metis-ai-cloud 公网入口测试非流式、Streaming、`[DONE]`、Usage 和 Billing；检查实际HTTP body中的`thinking`是顶层disabled字段，并从API Usage与平台日志确认未产生reasoning tokens。若官方响应仍显示thinking行为，停止性能对比并先修正请求。

**Step 3: 小样本性能参考**

并发1运行10～20次；可选并发2 / 4仅用于观察平台接入体验，不探测DeepSeek容量上限。

**Step 4: 质量参考**

Gemma与DeepSeek使用相同10～20题；保存模型输出的脱敏副本或摘要，用户与Codex按rubric评分。Tokenizer不同，因此不直接用Token数量排名。

**Step 5: 成本核对**

以测试当天DeepSeek官方价格、API返回Usage和平台日志计算单次成本；记录测试UTC时间、价格快照、缓存命中 / 未命中、输出Token和Usage可得性。无法取得缓存或Usage字段时明确标为估算值。平台测试价格与官方实际成本分栏展示。

### Task 12: 汇总数据并编写测试报告

**Files:**
- Create: `reports/demo/benchmark-report.md`
- Create: `reports/demo/executive-summary.md`

**Step 1: 数据质量检查**

核对运行ID、时间、模型、路径、profile、并发、请求数、Usage缺失、监控时间对齐和错误分类。排除预热样本必须保留规则说明。

**Step 2: 生成核心表格**

至少输出：

- 并发 vs TTFT / latency；
- 并发 vs 单请求 / Aggregate Output Tokens/s；
- 并发 vs 成功率；
- A / B / C / D 分层开销；
- 并发 vs GPU / VRAM；
- Gemma vs DeepSeek 体验 / 质量 / 成本。

**Step 3: 形成瓶颈判断**

每条结论使用以下模板：

```text
观察：发生了什么。
证据：哪些请求与资源指标支持。
判断：最可能的原因。
边界：仍不能排除什么。
建议：下一步如何验证或投入。
```

**Step 4: 编写老板摘要**

`executive-summary.md`控制在一页左右，只回答：闭环、容量、体验、瓶颈、下一步投入。

**Step 5: 验证与 Commit**

```bash
git diff --check -- reports/demo
rg -n "Bearer [A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9_-]{12,}|api[_-]?key[=:][[:space:]]*[A-Za-z0-9_-]{12,}" reports/demo
```

Expected: diff check PASS。人工审阅Secret扫描的每一条命中；无命中不代替人工检查，出现字段名等预期文本也不能直接判定为泄露。确认后显式暂存报告文件并提交。

### Task 13: 制作架构图、PPT、PDF 与 HTML 附录

**Files:**
- Create: `reports/demo/assets/architecture-business.png`
- Create: `reports/demo/assets/architecture-deployment.png`
- Create: `reports/demo/metis-ai-cloud-demo.pptx`
- Create: `reports/demo/metis-ai-cloud-demo.pdf`
- Create: `reports/demo/metis-ai-cloud-demo.html`
- Create: `reports/demo/demo-script.md`

**Step 1: 使用演示文稿技能**

执行时必须先读取并使用 `presentations:Presentations` skill；涉及图表和整页报告时可按任务需要使用 `lieflat-charts`。不得把 mock 页面性能值带入材料。

**Step 2: 绘制两张架构图**

业务调用图：Client / Cloudflare / ECS / Auth / Routing / Billing / PostgreSQL / Redis / Tailscale / LM Studio / GPU。

发布图：GitHub-hosted验证和构建 / GHCR digest / ECS Self-hosted Runner /受限发布入口 / immutable release / rollback。

**Step 3: 制作老板版PPT**

建议8～10页：

1. 项目一句话；
2. 商业背景；
3. 已完成真实闭环；
4. 业务架构；
5. Demo用户旅程；
6. 容量与用户体验；
7. 瓶颈与DeepSeek参照；
8. 商业含义；
9. 当前边界；
10. 下一步决策。

**Step 4: 导出与视觉验收**

导出PDF和HTML；逐页渲染检查字体、溢出、图例、单位、日期和来源。图表必须注明测试环境和as-of时间。

**Step 5: 编写现场讲稿与备用路径**

主流程控制在用户确认的汇报时长内；为登录失败、模型响应慢、上游异常和网络问题准备截图或录屏替代，不现场停服制造故障。

**Step 6: 最终Secret和事实检查**

检查PPT、PDF、HTML、图片metadata和讲稿，不包含Token、Key、内部Credential或未经验证的性能承诺。

### Task 14: 最终回归与交付

**Files:**
- Modify: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`

**Step 1: 最终Demo彩排**

按讲稿执行公网登录、Playground、API Key调用、Usage / Billing和管理员日志；记录实际耗时和失败点。

**Step 2: 最终运行态检查**

检查ECS release、容器健康、公网状态、Tailscale和Gemma；DeepSeek Channel只检查启用状态与Smoke，不读取Key。

**Step 3: 更新当前状态**

只把已完成的Benchmark、稳定容量、瓶颈结论和Demo材料写入 `CURRENT_STATE`；未完成项保持未完成。

**Step 4: 更新工作记录**

在 `WORKLOG.md` 简洁记录本轮实际完成内容，不复制完整测试报告。

**Step 5: 最小充分验证**

```bash
make benchmark-test
make benchmark-build
git diff --check
git status --short
```

根据实际改动范围决定是否追加 `make test`、前端测试或构建；未运行项在最终报告中说明。

**Step 6: 独立审查**

非简单实现完成后交由tester验证、reviewer只读审查。主Agent复核Secret、License / attribution、原始数据口径和所有完成声明。

**Step 7: 交付边界**

最终列出：修改文件、测试证据、实际运行时间、环境、未验证项、风险和下一步。未经明确授权不push、merge或部署代码变更。

## 执行协作方式

建议采用同一会话分阶段执行：

1. Codex先实现并离线验证测试工具；
2. 用户配置本地Token、DeepSeek Channel和Windows监控；
3. 双方共同完成低负载Smoke；
4. Codex逐级执行负载并在检查点汇报；
5. 用户观察LM Studio和设备状态；
6. 双方确认瓶颈结论后，Codex制作报告与演示材料。

每个阶段完成后再进入下一阶段，不把工具实现、线上测试、报告生成和PPT制作一次性混在同一个不可审查的大步骤中。
