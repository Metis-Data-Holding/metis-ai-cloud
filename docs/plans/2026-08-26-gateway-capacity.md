# Gateway Capacity Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立一套不调用真实大模型、可通过公网完整链路测量 many-models 网关容量的可重复测试工具，并形成可清理、可审计的测试证据。

**Architecture:** MacBook 以 k6 通过真实公网 HTTPS 发压；ECS 上运行不暴露宿主端口的临时 OpenAI-compatible Mock Provider，many-models 通过现有 Docker 内部网络访问它。只新增测试资产，不修改 Go/React 核心代码和生产 Compose。

**Tech Stack:** Node.js 22 内置 HTTP/测试模块、Docker、k6 官方 Docker 镜像、POSIX Shell、SSH、many-models OpenAI Channel。

---

### Task 1: 实现 Mock Provider 协议

**Files:**
- Create: `benchmark/gateway-capacity/mock-provider/server.mjs`
- Create: `benchmark/gateway-capacity/mock-provider/server.test.mjs`
- Create: `benchmark/gateway-capacity/mock-provider/Dockerfile`
- Create: `benchmark/gateway-capacity/mock-provider/.dockerignore`

**Step 1: 编写失败测试**

使用 Node.js 内置 `node:test` 编写真实 HTTP 行为测试，覆盖：

- `/health` 返回健康状态；
- `/v1/models` 只暴露 `mock-sleep-1s`；
- 非流式 `/v1/chat/completions` 在异步等待后返回 OpenAI-compatible JSON 与 usage；
- 流式请求按 SSE 返回 chunk，并以 `data: [DONE]` 结束；
- 不支持路径返回 404，非法请求返回 400；
- 日志不得包含 Authorization 或 Prompt。

**Step 2: 验证 RED**

Run: `node --test benchmark/gateway-capacity/mock-provider/server.test.mjs`
Expected: FAIL，因为服务实现尚不存在。

**Step 3: 最小实现**

只使用 Node.js 内置模块；等待使用异步 Timer。通过环境变量设置模型、非流式等待、流式首包等待、chunk 间隔、chunk 数和监听端口，并提供安全默认值。

**Step 4: 验证 GREEN**

Run: `node --test benchmark/gateway-capacity/mock-provider/server.test.mjs`
Expected: PASS。

**Step 5: 容器验证**

Run: `docker build -t metis-ai-cloud-mock-provider:test benchmark/gateway-capacity/mock-provider`
Expected: 构建成功，健康检查不依赖 curl/wget，容器以非 root 用户运行且只监听 8080。

### Task 2: 实现 k6 负载脚本和安全运行器

**Files:**
- Create: `benchmark/gateway-capacity/k6/smoke.js`
- Create: `benchmark/gateway-capacity/k6/non-stream.js`
- Create: `benchmark/gateway-capacity/k6/streaming.js`
- Create: `benchmark/gateway-capacity/run-k6.sh`
- Create: `benchmark/gateway-capacity/.env.example`

**Step 1: 定义安全门禁测试**

先写一个 Shell 静态验证，确认运行器：

- 只从 `.env.local` 或当前环境读取 Key；
- 要求 `.env.local` 权限为 `600`；
- 不把 API Key 放进 Docker 命令参数、结果或输出；
- 要求显式选择 `smoke`、`non-stream` 或 `streaming`；
- 正式模式要求单独确认变量；
- 结果写入忽略目录。

**Step 2: 验证门禁先失败**

Run: `bash -n benchmark/gateway-capacity/run-k6.sh` 以及精确文本/行为检查。
Expected: 在运行器尚不存在时失败。

**Step 3: 实现脚本**

所有请求使用专用模型、固定 Prompt 和 OpenAI-compatible Chat Completions。记录 HTTP 状态、请求失败、端到端延迟、RPS；流式额外验证 SSE 完整结束。阈值默认错误率不高于 1%。

运行器使用 k6 官方 Docker 镜像，不进行全局安装。Smoke 可直接执行；阶梯和稳定性模式必须要求明确确认，防止误触公网压力。

**Step 4: 静态和 k6 解析验证**

Run:

- `bash -n benchmark/gateway-capacity/run-k6.sh`
- `docker run --rm -v "$PWD/benchmark/gateway-capacity/k6:/scripts:ro" grafana/k6:<pinned> inspect /scripts/smoke.js`
- 对另外两个脚本执行同样的 `inspect`。

Expected: 全部通过，输出不包含 Secret。

### Task 3: 编写操作、监控与清理文档

**Files:**
- Create: `benchmark/gateway-capacity/README.md`
- Create: `benchmark/gateway-capacity/monitor/ecs-snapshot.sh`

**Step 1: 编写最小监控脚本**

采集时间、`docker stats --no-stream`、关键容器重启/OOM/健康状态、`vmstat`、`ss -s` 和网卡计数；缺少某个命令时明确标记 unavailable，不中断其他采集。输出不得包含环境变量、请求头、Prompt 或 Secret。

**Step 2: 编写完整 README**

包含：

- 测试目的与不能外推的边界；
- MacBook 与 ECS 分工；
- `.env.local` 创建和权限；
- Mock 本地构建/验证；
- ECS 只读核对、临时部署和无公网端口验证；
- many-models 后台专用渠道字段；
- 注意 OpenAI Channel 会把请求路径直接拼到 Base URL，渠道 API 地址应为 `http://mock-provider:8080`，不能额外添加 `/v1`；
- Smoke、阶梯、流式、30 分钟稳定性操作；
- 监控、停止线、证据目录；
- 禁用渠道、删除临时容器及正式业务复核。

**Step 3: 文档安全检查**

确认没有真实域外凭证、IP、Token 或服务器 Secret；命令使用占位变量，不能要求用户回传 Key。

### Task 4: 本地集成验证

**Files:**
- Verify: `benchmark/gateway-capacity/**`

**Step 1: Secret 与忽略规则**

Run:

- `git check-ignore benchmark/gateway-capacity/.env.local`
- `git check-ignore artifacts/benchmarks/gateway-capacity/example/result.json`

Expected: 两者均被忽略。

**Step 2: Mock 测试和容器 Smoke**

Run:

- Node 测试；
- Docker build；
- 临时启动容器；
- curl 健康、模型、非流式与流式接口；
- 停止并删除本地临时容器。

Expected: 协议通过，响应包含 Mock 标记，无真实模型请求。

**Step 3: k6 对本地 Mock Smoke**

使用虚拟 Key 与本地目标运行 k6 Smoke；确认结果目录生成、Key 未出现在命令行和结果中。

**Step 4: 总体检查**

Run: `git diff --check` 和精确 `git status --short`。
Expected: 无格式错误、无 Secret、无任务外暂存内容。

### Task 5: ECS Preflight 与临时 Mock 部署

**Files:**
- Runtime only: ECS 临时容器与脱敏证据

**Step 1: 只读核对**

通过既有 SSH 别名核对应用容器、Docker 网络、CPU/内存余量和现有健康状态。不猜测网络名，不修改正式 Compose。

**Step 2: 部署临时容器**

构建或安全传输测试镜像，以 `metis-ai-cloud-mock-provider` 启动，加入应用实际网络，不发布宿主端口。

**Step 3: 内部连通性验证**

从应用容器所在网络验证 `http://mock-provider:8080/health` 与模型列表；检查容器无宿主端口映射、健康、非 root、无重启。

**Step 4: 向用户提供页面配置**

用户创建专用 OpenAI Channel：名称 `Gateway Capacity Mock`、Base URL `http://mock-provider:8080`、专用虚拟上游 Key、模型 `mock-sleep-1s`、独立测试分组或确保测试 Token 可访问，并避免正式渠道参与此模型。

### Task 6: Smoke Test 和流量隔离验收

**Files:**
- Runtime results: `artifacts/benchmarks/gateway-capacity/<run-id>/`

**Step 1: 单请求**

用普通用户专用 API Key 执行非流式与流式 Smoke。

**Step 2: 三方证据交叉确认**

- k6/客户端成功；
- many-models 日志命中专用模型与渠道；
- Mock 日志收到请求；
- LM Studio 与 DeepSeek 无新增调用。

**Step 3: 监控和停止方式确认**

确认 ECS 监控窗口、SSH 监控命令与立即停止 k6 的方式均可用。

### Task 7: 正式容量测试与报告

**Files:**
- Modify: `reports/demo/benchmark-report.md`
- Modify: `reports/demo/benchmark-report.html`
- Modify if state changes: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`

**Step 1: 开跑确认**

向用户说明首个档位、预计持续时间、停止线和线上无人使用状态，获得明确确认后才开始公网阶梯压测。

**Step 2: 阶梯与流式测试**

按设计从低档开始；每档保存 k6 结果和 ECS/容器快照。触发停止线即停止上探。

**Step 3: 稳定性测试**

在短测最大稳定容量的 70%～80% 连续运行 30 分钟，保存完整证据。

**Step 4: 清理与正式链路复核**

停止 k6、禁用/删除 Mock 渠道、删除临时容器，复核 `/api/status`、页面、PostgreSQL、Redis、Tunnel 和正式模型单请求。

**Step 5: 更新报告**

用老板可读的语言补充网关容量章节：稳定并发、RPS、延迟、错误率、资源瓶颈、模型容量与网关容量的区别，以及商业化前仍需补齐的 HA/SLA 测试。HTML 图表不得覆盖文本或数据。

**Step 6: 最终验证与审查**

运行相关测试、`git diff --check`、Secret 检查、HTML 可视检查和独立代码审查；只暂存明确属于本任务的文件。
