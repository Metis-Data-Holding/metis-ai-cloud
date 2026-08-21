# Metis AI Cloud 决策记录

本文档记录已经明确形成、会影响后续产品或技术工作的关键决策。

- 当前状态：[`CURRENT_STATE.md`](CURRENT_STATE.md)
- 长期背景：[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)
- 工作历史：[`../WORKLOG.md`](../WORKLOG.md)
- Agent 规则：[`../AGENTS.md`](../AGENTS.md)

> 只记录已经决定的事项；尚未拍板的问题不进入本文档。决策被替代时保留原记录，并标记 `Superseded by DEC-xxx`。

## DEC-001 — Demo / PoC 基于 New API

- 日期：2026-08-21
- 状态：Accepted

**决定**

当前 Demo / PoC 使用 New API fork `metis-ai-cloud` 作为平台基础。

**原因**

- New API 已具备用户、API Token、Channel、模型、Usage、Billing、Admin 等基础能力。
- 当前重点是验证真实业务与模型服务链路，而不是从零开发平台。

**影响**

- 当前优先复用和配置 New API，避免无必要的大规模源码重构。
- New API 是否作为长期 Production 底座尚未决定。

## DEC-002 — Demo-first，优先真实闭环

- 日期：2026-08-21
- 状态：Accepted

**决定**

当前阶段优先打通 `Client → BytePlus ECS → metis-ai-cloud → Singapore Local Model` 的真实闭环，而不是先建设完整 Production 产品。

**原因**

- Demo 首先需要证明平台可运行、自有模型可通过公网平台调用。
- API、Streaming、Usage 与 Billing 的端到端闭环比外围完备度更关键。

**影响**

- 当前不优先投入 Kubernetes、Production HA、完整支付、大规模 GPU Cluster 或 Gateway 重写。

## DEC-003 — 先部署与验证链路，再进行 Branding

- 日期：2026-08-21
- 状态：Accepted

**决定**

当前执行顺序优先完成 ECS Deployment、Cloudflare / HTTPS 和 Singapore 网络验证，再进行轻量 Branding。

**原因**

- 基础设施与 Singapore 模型网络链路风险更高，应尽早暴露阻塞。
- Branding 风险较低，后置不会妨碍核心技术验证。

**影响**

- Branding 不应阻塞真实链路和可运行 baseline 的建立。

## DEC-004 — BytePlus ECS 作为 Demo 公网节点

- 日期：2026-08-21
- 状态：Accepted

**决定**

当前 Demo 使用现有 BytePlus ECS 部署 `metis-ai-cloud`，作为公网平台节点。

**原因**

- 团队已有可使用的 ECS，可以快速建立公网入口。
- 该方案足以支撑当前 Demo / PoC 的验证范围。

**影响**

- 这是 Demo 基础设施选择，不代表未来 Production 必须继续使用 BytePlus。

## DEC-005 — 使用 Cloudflare 管理 Demo DNS

- 日期：2026-08-21
- 状态：Accepted

**决定**

基于现有 `metisdata.ai` 域名，通过 Cloudflare 管理 Demo 子域名并连接 BytePlus ECS。

**原因**

- 公司域名 DNS 已由 Cloudflare 管理，复用现有体系是最短路径。

**影响**

- 最终子域名属于部署配置事实，确认前不在决策中写死。

## DEC-006 — Singapore Local Model 作为首条自有推理链路

- 日期：2026-08-21
- 状态：Accepted

**决定**

当前 PoC 优先把新加坡公司本地已经运行的小模型接入 `metis-ai-cloud`。

**原因**

- 目标是验证“公网 AI API Platform → 自有模型推理服务”的技术和业务闭环。
- 现有本地模型服务能支持这条链路的首轮验证。

**影响**

- 模型名称、GPU、推理框架和网络方案等未确认信息不属于本决策。
