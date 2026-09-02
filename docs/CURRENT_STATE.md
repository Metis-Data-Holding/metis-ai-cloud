# Metis AI Cloud 当前状态

> 最后更新：2026-09-02
> 当前 Milestone：Seedance 视频能力产品化
> 当前目标：完善 Playground 参考生成与首尾帧视频生成能力

本文档是项目当前状态的单一快照，采用覆盖式维护。长期背景见 [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)，执行历史与重要决策分别见 [`../WORKLOG.md`](../WORKLOG.md) 和 [`DECISIONS.md`](DECISIONS.md)。

## 1. 当前摘要

- 项目：`metis-ai-cloud`，来源于 New API fork。
- Step 0：已完成 AI 开发协作与上下文基础设施。
- 当前阶段：BytePlus ECS 公网部署、Cloudflare HTTPS、持久化、自动发布 / 回滚、Singapore Local Model Provider 和 Usage / Billing 闭环均已完成真实验收。
- Git 基线：部署资产已合入并推送 `main` 与 `develop`；当前 ECS release 为 `b740f5f52f8c14290b62d5b4351cf64ce0ab97db`。
- Local Model Provider、普通用户 API、Streaming、Usage / Billing 与 Serving Benchmark 均已形成真实验证证据。
- 当前容量结论：老板现场建议并发 1～2；并发 4 已通过 30 分钟稳定性验证。将 LM Studio 预测槽位放宽至 6 只获得约 9.9% 吞吐增益，同时 TTFT P50 增加约 72.9%。
- 加权路由 baseline：同一 `google/gemma-4-31b` 入口已验证按权重选择本地 Gemma 或映射到 DeepSeek；20 个短请求实际分布 13 / 7，30 个混合 Streaming 请求零错误。
- Seedance 视频能力：Dreamina Seedance 2.0 / 2.0 Fast 的动态任务计费、Playground 文生视频、异步轮询、预览与下载已合入并完成公网生成验收；参考生成与首尾帧输入已在功能分支实现，尚未合并、部署或做真实 Provider 验收。
- 网关容量 baseline：固定延迟 Mock 短时闭环中，非流式 100 VU、Streaming 25 VU 通过，下一档分别在 200 / 50 VU 触发延迟停止线。
- 网关稳定性：Streaming 20 VU 运行 30 分钟，完成 42779 请求，其中 6 次 HTTP 503，错误率 0.014%；容器无重启、OOM 或内存持续增长。
- 下一主 Milestone：完善老板 Demo 交付，归因网关稳定性轮次中的 6 次 HTTP 503，并设计开放到达率与真实服务器复测。
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

公网 Demo、真实 API / 模型调用、Streaming、Usage / Billing 与 Serving Benchmark 数据已经具备；Cost-aware Routing / Model Cascading 仍为后续实验方向。

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
| Singapore Local Model | ✅ Gemma 闭环已验证 | LM Studio 提供 OpenAI-compatible API；平台非流式、Streaming、Usage、Billing、权限边界和停服恢复均已验证 |
| ECS → Singapore 网络 | ✅ | Tailscale 固定私网链路已验证；不使用 exit node 或 subnet route，Tailscale 不接管 ECS DNS |
| 公网 Demo | ✅ 核心闭环已建立 | 管理员已初始化为对外营业模式；Playground 与限模型 API Token 均已完成真实模型调用 |

## 5. Singapore Local Model

- 当前完整验收模型：`google/gemma-4-31b`，GGUF `Q4_K_M`，模型文件约 19.89 GB
- 推理框架：LM Studio `0.4.21`
- Provider / Channel：OpenAI 类型，`default` 分组；API Base URL 和 Credential 保存在 ECS 平台配置中，本文不记录凭据
- OpenAI-compatible：`/v1/models` 与 Chat Completions 已验证
- Streaming：平台公网 SSE 已验证 `text/event-stream`、分块事件、`[DONE]` 和最终 Usage
- Usage / Billing：prompt、completion、total、reasoning token 已返回；Token、用户余额与调用日志扣费一致
- 权限边界：限模型 Token 访问未授权模型返回 HTTP 403，且不产生计费
- 故障恢复：LM Studio 停服时平台返回上游错误并记录零 quota 失败日志；服务恢复后 Channel 无需修改即可继续调用
- GPU：NVIDIA GeForce RTX 4090，24564 MiB；Gemma 4 31B 加载后显存约 23.9 GB
- Serving Benchmark：并发 4 已完成 30 分钟稳定性验证；预测槽位 6 的并发 4/5/6 短时实验已完成
- ECS 网络可达性：已通过 Tailscale 固定私网地址验证，单次 peer 延迟约 40–52 ms；该数据不等同于 Serving Benchmark
- 验证边界：本轮只对 Gemma 完成闭环与容量验收；其他模型不得据此描述为已验证

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

1. `Max Concurrent Predictions = 6` 仅通过短时参数实验，不能替代并发 4 的 30 分钟稳定性证据。
2. ECS 当前使用公共递归 DNS 规避 BytePlus DHCP DNS 与 Tailscale 地址段冲突；后续如有企业 DNS 或合规要求，应更换为 ECS 可达且不位于 `100.64.0.0/10` 的递归 DNS。
3. New API Branding / License / Attribution 边界需要在品牌二开前进一步确认。
4. Serving Benchmark 已找到当前交互容量边界，但尚未验证长上下文、多轮、多模型并载、故障恢复或 Production SLA。
5. 加权路由核心功能已验证，但尚未形成质量评估、统一成本模型、用户知情机制或 Production 路由策略。
6. 本次部署未创建 BytePlus 云盘快照，shared 数据发生破坏时无法依赖部署前云盘快照恢复。
7. Self-hosted Runner 依赖 ECS 出站网络与 DNS；该依赖需要持续监控，但不应扩大 Runner 的系统权限。
8. 网关 Mock 测试只是固定 VU 闭环容量，不代表实际用户数、开放到达率、Production SLA 或真实模型容量；30 分钟轮次的 6 次 HTTP 503 尚待日志级归因。

## 8. 当前 Scope

### 当前必须完成

- Singapore Local Model Provider 接入（已完成）
- API / Streaming 与 Usage / Billing 闭环（已完成）
- Serving Benchmark（已完成基础容量、稳定性与参数实验）
- Cost-aware Routing / Model Cascading 实验
- 轻量 Branding
- 最终 Demo 回归与演示材料

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

1. 合并并部署 Playground 参考生成与首尾帧功能后，分别使用参考图片、参考视频 URL、仅首帧、首帧加尾帧完成真实 Provider 验收，并核对任务日志与实际扣费。
2. 完善老板汇报稿、架构图、HTML/PDF/PPT 交付与现场 Demo 脚本。
3. 对网关 Streaming 30 分钟轮次中的 6 次 HTTP 503 做 many-models、Cloudflare 和 Mock 日志交叉归因。
4. 使用开放到达率模型和多轮重复运行，形成可用于容量规划的区间，不把固定 VU 换算为用户数。
5. 在真实服务器与候选工业显卡上复测模型容量，并补充长上下文、多轮、多模型并载、质量/成本与故障恢复。
6. 开展轻量 Branding；修改前先确认 License / Attribution 边界。

完成上述事项后，覆盖更新本节与对应状态，不在文件末尾追加旧任务。

## 10. 上下文导航

- 长期 Agent 规则：[`../AGENTS.md`](../AGENTS.md)
- 长期项目背景：[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)
- 基础设施与部署运行手册：[`../deploy/byteplus/README.md`](../deploy/byteplus/README.md)
- 重要决策：[`DECISIONS.md`](DECISIONS.md)
- 历史执行记录：[`../WORKLOG.md`](../WORKLOG.md)
