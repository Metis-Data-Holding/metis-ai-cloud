# Metis AI Cloud 当前状态

> 最后更新：2026-08-22
> 当前 Milestone：Local Model Provider、Usage / Billing 闭环
> 当前目标：2026-08-24 周一上午前完成可向老板演示的 Demo / PoC

本文档是项目当前状态的单一快照，采用覆盖式维护。长期背景见 [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)，执行历史与重要决策分别见 [`../WORKLOG.md`](../WORKLOG.md) 和 [`DECISIONS.md`](DECISIONS.md)。

## 1. 当前摘要

- 项目：`metis-ai-cloud`，来源于 New API fork。
- Step 0：已完成 AI 开发协作与上下文基础设施。
- 当前阶段：BytePlus ECS 公网部署、Cloudflare HTTPS、持久化、自动发布 / 回滚和 ECS → Singapore 私网链路 baseline 均已建立。
- Git 基线：部署资产已合入并推送 `main` 与 `develop`；当前 ECS release 为 `b740f5f52f8c14290b62d5b4351cf64ce0ab97db`。
- 下一主 Milestone：完成 Local Model Provider 的产品配置与真实 Usage / Billing 闭环。
- 可运行 Deployment Baseline：应用通过 `https://many-models.metisdata.ai` 对外提供 HTTPS 访问，app、PostgreSQL 与 Redis 均通过健康和持久化验证。

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

目标产物包括公网 Demo、真实 API / 模型调用、Streaming、Usage / Billing、Serving Benchmark 数据和 Cost-aware Routing / Model Cascading 实验结果。公网与网络 baseline 已完成；Provider 产品闭环、平台侧 Usage / Billing、Benchmark 和 Routing 实验仍未完成。

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

Step 0 已完成并作为后续部署、Provider 和产品任务的协作基础；部署资产与运行态进展见后续章节。

## 3. 当前执行路线
```text
Step 0 → BytePlus ECS → Cloudflare DNS / HTTPS → ECS 到 Singapore 网络验证
→ 可运行 baseline → Local Model Provider → Usage / Billing → 轻量 Branding
→ Serving Benchmark → Cost-aware Routing Experiment → Demo 回归与演示
```
当前分为两条工作线：

- Track A — Platform / Demo：`metis-ai-cloud`、BytePlus ECS、Cloudflare、HTTPS、Branding、Demo 配置、Usage / Billing。
- Track B — AI Infra / Test：Singapore Local Model、网络链路、Provider 接入、Serving Benchmark、Cost-aware Routing。
- 汇合点：`metis-ai-cloud → Singapore Local Model` 的真实调用链路。

## 4. 基础设施状态

| 项目 | 当前状态 | 说明 |
|---|---|---|
| 本地仓库 | ✅ | 部署资产已合入并推送 `main` 与 `develop`；本轮首次自动部署使用 `main` |
| BytePlus ECS | ✅ | app、PostgreSQL、Redis 均为 healthy；应用仅监听 `127.0.0.1:3000` |
| Cloudflare DNS | ✅ | `many-models.metisdata.ai` 已通过 Tunnel Published application route 生效 |
| HTTPS | ✅ | Universal SSL Active；公网首页与 `/api/status` 均返回 HTTP 200，TLS 校验通过 |
| GitHub Actions 发布 | ✅ | Deploy Run `32558545994`、真实 Rollback Run `32559285305` 与再次部署恢复 Run `32559331290` 均成功 |
| Singapore Local Model | ✅ 基础接口已验证 | LM Studio 提供 OpenAI-compatible API；模型产品定价与平台 Billing 仍待闭环 |
| ECS → Singapore 网络 | ✅ | Tailscale 固定私网链路已验证；不使用 exit node 或 subnet route，Tailscale 不接管 ECS DNS |
| 公网 Demo | 原版 baseline 已建立 | 管理员已初始化为对外营业模式；基础设施已就绪，Provider 产品闭环仍在下一阶段 |

## 5. Singapore Local Model

- 当前验证模型：`google/gemma-4-31b`
- 推理框架：LM Studio
- API Base URL：保存在 ECS 的 Provider / Channel 配置中；本文不记录凭据
- OpenAI-compatible：已验证
- Streaming：原始模型 API 已验证分块、`[DONE]` 与 Usage
- Usage 返回：原始模型 API 已验证；平台计费闭环仍待完成
- GPU：待确认
- ECS 网络可达性：已通过 Tailscale 固定私网地址验证

## 6. Demo Deployment

- ECS Provider：BytePlus
- ECS 主机：通过 SSH alias `ECS-RI4m` 管理；本文不记录凭据
- Domain：`many-models.metisdata.ai`
- DNS / HTTPS：Cloudflare Tunnel `byteplus-hk-RI4m`；route 指向 `http://127.0.0.1:3000`
- Deployment：应用 commit `b740f5f52f8c14290b62d5b4351cf64ce0ab97db`，使用 GHCR 固定 digest 的 `linux/amd64` 镜像；release 目录为 `/data/metis-ai-cloud/releases/<full-sha>`，`current` 已指向该 release
- Runtime：app、PostgreSQL、Redis 均通过健康检查；PostgreSQL / Redis 未发布宿主端口
- Persistence：容器重启与 app、PostgreSQL、Redis 分别重建后，管理员数据及非敏感 Redis 探针均通过恢复验证；探针已删除
- 初始化：管理员初始化完成，运行模式为对外营业模式
- Authentication：用户已通过公网 HTTPS 完成管理员登录、刷新保持会话与退出验证
- Release Automation：`byteplus-demo` Environment、独立 ECS Self-hosted Runner、受限 root wrapper 与默认分支 Workflow 已启用；首次 Deploy Run `32558545994`、真实 Rollback Run `32559285305` 与再次部署恢复 Run `32559331290` 均成功
- 共存回归：`xy-stock` systemd 服务、loopback HTTP 与既有公网入口保持可用；Cloudflare Tunnel 进程 active，验收时重启计数为 0
- 回滚边界：本次由用户明确接受不创建 BytePlus 系统盘或数据盘快照；应用可通过历史完整 release 回滚，但 shared 数据无云盘级部署前快照保护

## 7. 当前风险与 Blockers

1. Local Model 已配置基础 Channel，但模型定价、平台 API、Usage / Billing 仍需完成真实闭环验收。
2. ECS 当前使用公共递归 DNS 规避 BytePlus DHCP DNS 与 Tailscale 地址段冲突；后续如有企业 DNS 或合规要求，应更换为 ECS 可达且不位于 `100.64.0.0/10` 的递归 DNS。
3. New API Branding / License / Attribution 边界需要在品牌二开前进一步确认。
4. 尚无真实 Serving Benchmark 数据，容量、延迟、吞吐和瓶颈均未知。
5. Cost-aware Routing 仍是实验方向，尚无质量、成本或性能结论。
6. 本次部署未创建 BytePlus 云盘快照，shared 数据发生破坏时无法依赖部署前云盘快照恢复。
7. Self-hosted Runner 依赖 ECS 出站网络与 DNS；该依赖需要持续监控，但不应扩大 Runner 的系统权限。

## 8. 当前 Scope

### 当前必须完成

- Singapore Local Model Provider 接入
- API / Streaming 与 Usage / Billing 闭环
- Serving Benchmark
- Cost-aware Routing / Model Cascading 实验
- Demo 回归与演示

### 基础设施线路已完成

- BytePlus ECS 可访问部署与原版 baseline 验证
- Cloudflare DNS + HTTPS
- PostgreSQL / Redis 持久化与容器重建恢复
- GitHub Actions 固定镜像发布、真实回滚与再次部署恢复
- ECS → Singapore Local Model Tailscale 网络连通性验证

### 当前明确不做

- Kubernetes、自动扩缩容和 Production HA
- 完整支付、发票、退款与企业 RBAC
- 大规模 GPU Cluster 与完整 GPU Scheduler
- New API 大规模重构或从零重写 Gateway
- 最终 Production 架构设计

## 9. 下一步行动

1. 完成当前 Local Model 的 PoC 定价与平台模型配置。
2. 通过平台 API 验证非流式、Streaming、Token Usage、Quota 与 Billing 记录。
3. 验证管理员侧调用日志、费用和错误可追溯性。
4. 在上述闭环稳定后再开展轻量 Branding、Serving Benchmark 与 Cost-aware Routing 实验。

完成上述事项后，覆盖更新本节与对应状态，不在文件末尾追加旧任务。

## 10. 上下文导航

- 长期 Agent 规则：[`../AGENTS.md`](../AGENTS.md)
- 长期项目背景：[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)
- 基础设施与部署运行手册：[`../deploy/byteplus/README.md`](../deploy/byteplus/README.md)
- 重要决策：[`DECISIONS.md`](DECISIONS.md)
- 历史执行记录：[`../WORKLOG.md`](../WORKLOG.md)
