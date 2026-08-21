# Metis AI Cloud 当前状态

> 最后更新：2026-08-21
> 当前 Milestone：BytePlus ECS 部署
> 当前目标：2026-08-24 周一上午前完成可向老板演示的 Demo / PoC

本文档是项目当前状态的单一快照，采用覆盖式维护。长期背景见 [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)，执行历史与重要决策分别见 [`../WORKLOG.md`](../WORKLOG.md) 和 [`DECISIONS.md`](DECISIONS.md)。

## 1. 当前摘要

- 项目：`metis-ai-cloud`，来源于 New API fork。
- Step 0：已完成 AI 开发协作与上下文基础设施。
- 当前阶段：准备在 BytePlus ECS 部署未修改的 `metis-ai-cloud`。
- 当前 Git 分支：`develop`。
- 下一主 Milestone：BytePlus ECS Deployment。
- 可运行 Deployment Baseline：待建立；当前代码尚未经过本轮构建、部署和运行态验证。

目标闭环：

```text
Internet / Client
        ↓
Cloudflare
        ↓
BytePlus ECS
        ↓
metis-ai-cloud
        ↓
Singapore Local Model
        ↓
GPU / Model
```

目标产物包括公网 Demo、真实 API / 模型调用、Streaming、Usage / Billing、Serving Benchmark 数据和 Cost-aware Routing / Model Cascading 实验结果。除本地仓库与 Step 0 文档外，这些产物当前均未标记为完成。

## 2. Step 0 状态

| 项目 | 状态 | 当前说明 |
|---|---|---|
| New API fork 与本地 clone | ✅ | `origin` 指向 `Metis-Data-Holding/metis-ai-cloud` |
| `AGENTS.md` | ✅ | 已建立长期 Agent 协作规则与项目知识导航 |
| `.codex/` | ✅ | 已建立主 Agent / SubAgent 配置 |
| `docs/PROJECT_CONTEXT.md` | ✅ | 已建立长期项目背景 |
| `docs/CURRENT_STATE.md` | ✅ | 已建立当前状态快照 |
| `WORKLOG.md` | ✅ | 已建立关键工作历史 |
| `docs/DECISIONS.md` | ✅ | 已建立重要决策记录 |
| `.env.example` / `.gitignore` | ✅ | 已完成最小必要补充 |
| Secrets 基础检查 | ✅ | 未发现 Step 0 变更中包含真实凭据或敏感文件 |

Step 0 已完成；本轮变更仅包含协作、上下文与 Secrets 基础保护文件，不包含业务代码或部署配置。

## 3. 当前执行路线
```text
Step 0 → BytePlus ECS → Cloudflare DNS / HTTPS → ECS 到 Singapore 网络验证
→ 可运行 baseline → 轻量 Branding → Local Model Provider → Usage / Billing
→ Serving Benchmark → Cost-aware Routing Experiment → Demo 回归与演示
```
当前分为两条工作线：

- Track A — Platform / Demo：`metis-ai-cloud`、BytePlus ECS、Cloudflare、HTTPS、Branding、Demo 配置、Usage / Billing。
- Track B — AI Infra / Test：Singapore Local Model、网络链路、Provider 接入、Serving Benchmark、Cost-aware Routing。
- 汇合点：`metis-ai-cloud → Singapore Local Model` 的真实调用链路。

## 4. 基础设施状态

| 项目 | 当前状态 | 说明 |
|---|---|---|
| 本地仓库 | ✅ | 已 clone；当前分支 `develop`，Step 0 基础设施已完成 |
| BytePlus ECS | 待验证 | 尚无本轮部署完成或运行态证据 |
| Cloudflare DNS | 待配置 | 已有 `metisdata.ai`；Demo 子域名待确认 |
| HTTPS | 待配置 | 尚无配置或验证证据 |
| Singapore Local Model | 已存在 / 接口待确认 | 公司本地已有小模型服务 |
| ECS → Singapore 网络 | 未验证 | 当前最高风险项之一 |
| 公网 Demo | 未建立 | 需在 ECS、DNS、HTTPS 与模型链路完成后验收 |

## 5. Singapore Local Model

- 模型名称：待确认
- 参数规模：待确认
- 推理框架：待确认
- API Base URL：待确认，不在本文记录 Secret
- OpenAI-compatible：待确认
- Streaming：待确认
- Usage 返回：待确认
- GPU：待确认
- ECS 网络可达性：未验证

## 6. Demo Deployment

- ECS Provider：BytePlus
- ECS 地址：待确认；本文不记录凭据，公网 IP 仅在确有长期必要时记录
- Domain：待确认
- DNS：Cloudflare
- HTTPS：待配置
- Deployment：待执行 / 待验证
- 可运行 Deployment Baseline：待建立；Step 0 Commit 不代表已通过本轮构建、ECS 部署与运行态验收

## 7. 当前风险与 Blockers

1. ECS → Singapore Local Model 网络链路尚未验证，可能直接阻塞真实 Demo 闭环。
2. Singapore 模型 API 形态、推理框架、Streaming 与 Usage 能力尚未确认。
3. New API Branding / License / Attribution 边界需要在品牌二开前进一步确认。
4. 尚无真实 Serving Benchmark 数据，容量、延迟、吞吐和瓶颈均未知。
5. Cost-aware Routing 仍是实验方向，尚无质量、成本或性能结论。

## 8. 当前 Scope

### 当前必须完成

- BytePlus ECS 可访问部署与原版 baseline 验证
- Cloudflare DNS + HTTPS
- ECS → Singapore Local Model 网络连通性验证
- Singapore Local Model Provider 接入
- API / Streaming 与 Usage / Billing 闭环
- Serving Benchmark
- Cost-aware Routing / Model Cascading 实验
- Demo 回归与演示

### 当前明确不做

- Kubernetes、自动扩缩容和 Production HA
- 完整支付、发票、退款与企业 RBAC
- 大规模 GPU Cluster 与完整 GPU Scheduler
- New API 大规模重构或从零重写 Gateway
- 最终 Production 架构设计

## 9. 下一步行动

1. 建立 BytePlus ECS 部署任务分支。
2. 分析当前 New API 官方推荐部署方式。
3. 在 BytePlus ECS 部署未修改的 `metis-ai-cloud`。
4. 验证 ECS IP / Port 访问与数据持久化。
5. 配置 Cloudflare DNS / HTTPS。
6. 尽快验证 ECS → Singapore Local Model 网络连通性。

完成上述事项后，覆盖更新本节与对应状态，不在文件末尾追加旧任务。

## 10. 上下文导航

- 长期 Agent 规则：[`../AGENTS.md`](../AGENTS.md)
- 长期项目背景：[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)
- 重要决策：[`DECISIONS.md`](DECISIONS.md)
- 历史执行记录：[`../WORKLOG.md`](../WORKLOG.md)
