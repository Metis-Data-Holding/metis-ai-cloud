# 老板 Demo、Serving Benchmark 与汇报实施计划

> 日期：2026-08-24
>
> 状态：执行中
>
> 执行原则：GuideLLM 优先，薄脚本补缺；不开发自有压测框架。

## 1. 目标

用最小工具完成三类可复核证据：

1. 验证“注册 / 登录 → Playground → API Key → API → Usage / Billing → 管理日志”的业务闭环；
2. 测出 Singapore 本地模型在真实公网链路上的并发退化、稳定容量与主要瓶颈；
3. 以 DeepSeek 官方模型作为体验、质量和成本参考，形成老板版 PPT / PDF / HTML 与讲稿。

## 2. 工具选择

### 主工具：GuideLLM

使用 GuideLLM 的 OpenAI-compatible HTTP backend，直接获得 Streaming、并发 / 速率控制、TTFT、ITL / TPOT、端到端延迟、吞吐以及 JSON / CSV / HTML 结果。首轮固定 GuideLLM 版本；版本号以安装当天兼容性验证通过的版本为准，并写入运行元数据。

### 只允许的辅助资产

- 无 Secret 的 GuideLLM 配置与 Prompt 数据；
- 从未跟踪 `.env.local` 注入 endpoint / model / API Key 的安全启动脚本；
- Windows `nvidia-smi` 监控脚本；
- 必要时用于脱敏、合并结果或生成图表的短脚本。

不新增 Go CLI、并发调度器、SSE 解析器、统计框架、Makefile target 或 Docker 测试环境。只有 GuideLLM 冒烟证明存在关键缺口时，才为该缺口增加最小适配层。

## 3. 安全与执行边界

- API Key 仅存在于用户本机环境变量或未跟踪的本地配置中，不进入命令参数、Git、日志、结果、截图或聊天。
- 先进行无密钥 CLI 检查和单请求冒烟，再进入并发测试。
- DeepSeek 使用专用 Key、小额预算和小样本，不探测官方容量上限。
- 每档设置请求数、时长、并发和输出 Token 硬上限；连续失败、OOM、服务异常或资源安全风险时立即停止。
- 原始结果保存在 `artifacts/benchmarks/`，默认不提交；报告只引用脱敏且复核过的聚合数据。
- 测试通过不等于 Production SLA、HA 或注册用户容量已经得到证明。

## 4. 文件布局

```text
benchmark/serving/
├── README.md
├── guidellm.example.yaml
├── prompts.jsonl
├── run-guidellm.sh
└── monitor/
    └── windows-nvidia-monitor.ps1

reports/demo/
├── business-flow-checklist.md
├── benchmark-report.md
├── executive-summary.md
└── demo-script.md

artifacts/benchmarks/<run-id>/
├── environment.json
├── guidellm.json
├── guidellm.csv
├── guidellm.html
└── gpu.csv
```

本地实际 endpoint、模型映射和 Key 不放入示例文件。

## 5. 分阶段计划

### Task 1：计划改版与工具预检

1. 将计划从自研 Go 工具改为 GuideLLM-first；同步修正设计文档中的工具和分工描述。
2. 确认当前 Git 分支、工作树、Python 与 `uv` 状态。
3. 在隔离环境运行 GuideLLM `--help` / `--version`，不加载真实 Key，不调用线上模型。
4. 记录 GuideLLM、Python、操作系统版本以及安装方式。

验收基线：GuideLLM 0.7.2、Python 3.13。macOS 必须设置 `GUIDELLM__MP_CONTEXT_TYPE=spawn`；默认 `fork` 已稳定复现 worker `signal 11`。不修改产品源码，不使用 Go / Docker；CLI 可执行，且没有 Secret 出现在进程参数或输出中。

### Task 2：建立最小测试契约

创建：

- `benchmark/serving/README.md`：安装、密钥、运行、停止与结果说明；
- `benchmark/serving/guidellm.example.yaml`：只含无敏感字段的占位配置；
- `benchmark/serving/prompts.jsonl`：短问答和内容生成两种固定负载；
- `benchmark/serving/run-guidellm.sh`：从权限受限的未跟踪 `.env.local` 加载 GuideLLM 环境变量；
- `.gitignore`：精确忽略本地配置和 `artifacts/benchmarks/`。

安全要求：README 只展示环境变量名；通过 `GUIDELLM__SPEC__BACKEND__TARGET`、`GUIDELLM__SPEC__BACKEND__MODEL` 和 `GUIDELLM__SPEC__BACKEND__API_KEY` 注入运行态配置，不把 Key 写入 CLI 参数；使用 `sample_size=0` 关闭 Prompt、完整回答和请求参数持久化。GuideLLM 原始 JSON / CSV 仍会记录 target，必须保留在忽略目录，汇报前脱敏。运行前检查请求数、时长、并发、`max_tokens` 和 DeepSeek 预算。

验收：示例配置可解析；本地配置和原始结果被 Git 忽略；`git diff --check` 通过。

### Task 3：单请求兼容性冒烟

按风险从低到高执行：

1. 无密钥配置解析或本地 mock 检查；
2. 公网 Gemma 单请求；
3. 公网 Gemma Streaming 单请求；
4. DeepSeek 单请求（Channel 就绪后）。

每次只运行 1 个请求，检查 Bearer 鉴权、`/v1/chat/completions`、模型名、Streaming、`[DONE]`、Usage、TTFT / ITL / latency，以及结果文件中没有 Key、Authorization Header 或完整敏感内容。DeepSeek 的 `thinking` 关闭参数必须位于 HTTP body 顶层。

如 GuideLLM 不兼容，先尝试其 backend / extra body 配置；仍无法解决时才编写针对单一缺口的薄适配脚本。冒烟结果由双方确认后才能开始并发测试。

### Task 4：业务闭环验收

用户负责浏览器操作，Codex 负责清单、脱敏证据和事实记录：

1. 注册、登录与会话刷新；
2. Playground 选择 Gemma 并获得 Streaming 回复；
3. 创建限模型、限额度、短期 API Key；
4. `/v1/models`、非流式与 Streaming Chat Completions；
5. Usage、余额、Token 额度和管理员日志对账；
6. 调用未授权模型，确认拒绝且不计费。

交付：`reports/demo/business-flow-checklist.md`。失败项保持失败，不用历史验收或截图补写为本次成功。

### Task 5：轻量容量测试

#### 5.1 环境基线

记录测试时间、Git release、GuideLLM 版本、LM Studio 版本、模型、量化、Context Length、GPU Offload、并行设置、GPU / 驱动、ECS 与公网健康状态。未知项明确写“待确认”。

#### 5.2 并发 1 基线

优先运行两条老板最关心的路径：

- D：外部测试端 → Cloudflare → metis-ai-cloud → Singapore LM Studio；
- A：可达时，测试端 → Singapore LM Studio。

B / C 只在需要缩小瓶颈范围且能安全从 ECS 发起时补充。各路径是包含式对照，不能把差值直接命名为某个组件耗时。

#### 5.3 公网阶梯

Gemma D 路径按并发 `1 → 2 → 4 → 8 → 16` 运行短问答和内容生成。每档先做短时探测；只有前一档稳定且用户确认设备正常才进入下一档。关键拐点重复验证。

每档记录实际完成数、成功 / 失败 / 超时、TTFT、ITL / TPOT、端到端延迟、单请求 / 聚合 Output Tokens/s、GPU utilization / VRAM / 温度 / 功耗，以及 ECS CPU / 内存 / 网络和服务健康。

P95 少于 100 个有效样本时标为探索性；没有约 300 个零失败样本时，不声称成功率达到 99%。

#### 5.4 稳定性与瓶颈复核

在候选稳定并发上进行约 30 分钟测试。若时间不足，明确降级为短时容量探测，不使用“稳定容量”措辞。仅在出现拐点后补测 A / B / C 和资源指标，判断 GPU、推理引擎、网络或 Gateway 中最可能的瓶颈。

#### 5.5 DeepSeek 参考

以并发 1 的 10～20 个请求为主，并发 2 / 4 仅作小样本体验观察。记录当天 UTC 时间、官方价格快照、Usage、缓存口径和实际成本；缺失信息标为估算或 unavailable。

### Task 6：报告与老板材料

基于脱敏聚合结果生成测试报告、老板一页摘要、核心容量曲线、Gemma—DeepSeek 对比、两张架构图、8～10 页 PPT、PDF、HTML 和现场讲稿。每条瓶颈结论均区分“观察、证据、判断、边界、建议”；图表注明环境和 as-of 时间，不把探索性结果包装为 SLA。

### Task 7：最终验收

1. 按讲稿进行 Demo 彩排；
2. 检查线上、ECS、Tailscale、LM Studio 和 DeepSeek Channel 当天状态；
3. 检查报告、图片、PPT、PDF、HTML 和 metadata 中无 Secret；
4. 运行 `git diff --check`、敏感信息扫描和文件范围检查；
5. 仅把实际完成结果更新到 `docs/CURRENT_STATE.md` 和 `WORKLOG.md`；
6. 未经明确授权不 push、merge、部署或删除测试 Key。

## 6. 分工

### Codex

- 调整计划、准备 GuideLLM 配置并执行可达路径的命令；
- 管理负载上限、停止条件、结果脱敏和数据质量；
- 汇总测试数据并制作报告、架构图和演示材料。

### 用户

- 在本机保存线上地址与 API Key，不把值发到聊天；
- 保持 LM Studio 目标模型加载，确认 Windows 设备状态；
- LM Studio 仅 Windows localhost 可达时，执行 Codex 提供的一条 PowerShell 命令；
- 完成浏览器业务闭环步骤并观察硬件安全状态。

### 共同检查点

1. 单请求兼容性冒烟；
2. 业务闭环；
3. 并发 1 基线；
4. 每次上探前的设备与服务状态；
5. 稳定容量、瓶颈和老板材料事实复核。

## 7. 当前执行顺序

```text
计划改版
→ GuideLLM 隔离安装与无密钥预检
→ 用户本机配置 endpoint / Key
→ 单请求冒烟
→ 业务闭环
→ 并发阶梯与资源监控
→ DeepSeek 参考
→ 报告与演示材料
```
