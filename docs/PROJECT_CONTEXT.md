# Metis AI Cloud 项目背景

本文档回答 `metis-ai-cloud` 是什么、为什么存在、要解决什么问题，以及当前产品方向和总体技术路线。它记录长期背景与阶段边界，不承载当前任务、Sprint 日程、临时状态或具体测试结果。

> 最后审阅：2026-08-23
> 更新原则：仅在项目定位、长期架构、产品边界或长期事实变化时更新

## 1. 项目简介

`metis-ai-cloud` 是一个面向开发者和企业客户的 AI Inference API Platform 项目，当前仓库基于 GitHub 开源项目 New API fork。

项目希望把模型推理能力封装为统一、可管理、可计量的 API 服务。核心产品关系是：

```text
API
+
模型服务
+
Token Usage
+
Billing
+
Provider 管理
```
Web Playground 主要服务于模型测试、API 调试和产品演示，不是项目的核心产品形态；本项目也不定位为普通 ChatGPT 聊天网站。

当前阶段首先完成一个内部可演示的 Demo / PoC，用真实链路验证产品闭环和模型服务能力。New API 是当前 Demo 的技术基础，但是否作为长期 Production 底座尚未最终确定。

## 2. 商业背景

公司老板位于新加坡，团队正在探索在新加坡或马来西亚采购或租赁服务器与 GPU，部署 DeepSeek、Kimi、GLM 等领先开放权重大模型，并以 API / Token 形式向开发者或企业客户提供推理服务。

当前方向聚焦于：

- 亚太区域的模型推理服务能力；
- Singapore / Malaysia 基础设施；
- 中国领先开放权重模型；
- 自建 GPU 与多 Provider 供给；
- 面向开发者和企业客户的 API、Usage、Billing 与管理能力。

以上是待验证的商业方向和产品假设，不代表已经形成竞争优势，也不代表相关基础设施、模型集群或商业能力已经建成。

## 3. 产品定位

产品的初步演进路线是：

```text
Serverless / Pay-as-you-go API
        ↓
Dedicated GPU / Reserved Capacity
        ↓
Private Deployment / Enterprise Service
```

第一阶段重点验证：

- 统一 API 与 OpenAI-compatible API 调用体验；
- 多模型与 Provider / Channel 管理；
- API Token 创建、鉴权与使用；
- Streaming 响应；
- Token Usage 记录；
- Billing / Quota；
- Admin 管理与调用信息查看。

长期潜在价值包括多 Provider Routing / Fallback、区域与容量调度、成本优化、Dedicated GPU 和企业私有部署。这些能力是否进入正式产品，以及采用何种实现，仍需根据 Demo、Benchmark、客户需求与合规评估决定。

## 4. 为什么选择 New API

Demo / PoC 阶段选择 New API，主要是为了：

- 快速建立可运行的 AI API Platform 原型；
- 复用用户、API Token、Channel、模型、Usage、Billing、Admin 等基础能力；
- 避免在业务链路尚未验证前从零开发完整平台；
- 优先验证公网入口、Gateway、自有模型服务与 GPU 推理的端到端链路。

这是 Demo 技术选择，不等于长期 Production 架构决策。二次开发应保持最小修改、优先配置和 upstream compatibility，避免为短期演示进行大规模源码重构。

当前仓库保留 New API 的 Go module、前后端结构、Provider relay、数据库兼容和容器化构建方式。详细工程规则以 [`../AGENTS.md`](../AGENTS.md) 为准。

## 5. 当前 Demo / PoC 目标

当前目标是建立一个真实可运行的闭环系统：

```text
用户 / API Client
        ↓
Cloudflare
        ↓
BytePlus ECS
        ↓
metis-ai-cloud
(New API based)
        ↓
Singapore Local Model API
        ↓
GPU / Model
```

Demo 需要能够展示：

```text
用户访问平台
        ↓
创建 / 使用 API Token
        ↓
选择模型并发起调用
        ↓
Streaming 返回结果
        ↓
记录 Token Usage
        ↓
产生 Billing / Quota
        ↓
Admin 查看调用信息
```

该闭环的意义是验证“公网 AI API Platform → 公司自有模型推理服务”，而不仅是展示一个前端页面或单次模型响应。

### 基础设施关系

- 公网节点：BytePlus ECS 承载当前 Demo，应用仅绑定宿主回环地址。
- DNS / HTTPS：`many-models.metisdata.ai` 由 Cloudflare Tunnel 发布并由 Universal SSL 提供 HTTPS；不直接开放应用端口到公网。
- 数据与缓存：Demo 使用独立 PostgreSQL 与 Redis，持久数据保存在 ECS 的 `/data/metis-ai-cloud/shared/`。
- 模型网络：ECS 通过 Tailscale 固定私网地址访问新加坡 LM Studio；Tailscale 只承担模型私网传输，不作为 ECS 系统 DNS。
- 发布：GitHub-hosted Runner 完成验证与镜像构建，ECS Self-hosted Runner 通过受限 root 入口执行发布和回滚。

当前基础设施的可执行细节、目录、Secret 边界和验证方式见 [`../deploy/byteplus/README.md`](../deploy/byteplus/README.md)。GPU 型号、实际性能、容量和成本数据仍需后续 Benchmark 确认。

## 6. 总体系统关系

平台位于用户与实际推理服务之间，负责把外部 API 请求转化为可鉴权、可路由、可计量和可管理的模型调用。

```text
Developer / Enterprise Client
              ↓
      API Token / Unified API
              ↓
        metis-ai-cloud
   ┌──────────┼──────────┐
   │          │          │
Auth      Routing     Usage/Billing
   │          │          │
   └──────────┼──────────┘
              ↓
      Provider / Channel
              ↓
     Model Serving Endpoint
              ↓
            GPU
```

Cloudflare、BytePlus ECS 与 Tailscale 私网模型链路已经形成当前 Demo 的基础设施 baseline。首条 Singapore Gemma Provider 的产品配置、标准 API、Streaming、Usage 与 Billing 已完成运行态验收；Benchmark 与自动路由仍需独立验证，不能由单模型功能闭环替代。

## 7. Provider / Model 理念

用户面向的是逻辑 `Model`，实际推理由 `Provider / Channel` 完成。逻辑模型与具体推理供给解耦，使同一个模型未来可以对应不同来源：

```text
Logical Model
   ├─ Official API
   ├─ Singapore Self-hosted Provider
   ├─ Malaysia Self-hosted Provider
   └─ Third-party Provider
```

未来平台可能依据以下因素选择 Provider：

- 优先级；
- 健康状态；
- 成本；
- 容量；
- 区域。

复杂自动路由属于后续能力。Demo 阶段重点是先打通逻辑模型到明确 Provider 的真实调用、Streaming、Usage 和 Billing 链路，不把自动成本优化或区域调度描述为已实现。

## 8. 性能与成本实验方向

### Serving Benchmark / Capacity Test

PoC 除功能闭环外，还计划验证模型服务与 Gateway 的容量和性能。关注方向包括：

- 稳定并发能力与 Request Throughput；
- Output Tokens/s；
- 首 Token 延迟（TTFT）；
- 每 Token 延迟（TPOT / ITL）；
- P50 / P95 Latency；
- Success Rate；
- GPU Utilization 与 VRAM Usage；
- 模型、GPU、网络和 Gateway 的潜在瓶颈。

这些是计划采集的指标，不代表已经存在实测数据。具体测试结果应记录在当前状态或工作记录中，而不是写入本长期背景文件。

### Cost-aware Routing / Model Cascading

项目计划探索 Cost-aware Routing 与 Model Cascading：研究能否让适合的请求由成本更低的小模型处理，从而改善推理成本和整体吞吐。

实验需要同时比较：

- 成本；
- 吞吐；
- 延迟；
- 回答质量。

这是实验性方向，不是已确定的正式产品能力。若未来产品采用智能路由，应通过类似 `metis-auto` 的逻辑模型保持透明；当用户明确指定具体模型时，不应暗中替换模型。

## 9. 当前 Non-goals

当前 Demo / PoC 阶段暂不解决：

- 大规模 Production GPU Cluster；
- Kubernetes 与自动扩缩容；
- 完整 High Availability；
- 完整支付、发票和退款系统；
- 完整企业组织与 RBAC；
- 大规模内容安全与 DDoS 防护体系；
- 完整 GPU Scheduler；
- 正式部署 DeepSeek / Kimi 超大模型集群；
- 大规模重构 New API；
- 从零重写 AI Gateway；
- 最终 Production 技术选型。

这些 Non-goals 用于约束当前 Scope，不代表相关能力永久不需要。进入 Production 规划前，应基于业务验证、负载数据、安全要求和合规要求重新评估。

## 10. 开发原则摘要

```text
Demo first
最小修改
优先配置
保持 upstream compatibility
先打通真实链路
再进行外观和性能优化
```
开发、测试、Git、Secrets、Multi-Agent 和协作规则以 [`../AGENTS.md`](../AGENTS.md) 为唯一详细入口，本文不重复展开。

## 11. License 与合规提醒

- 本项目是 New API fork，必须遵守当前适用的 License / Attribution 要求。
- 品牌二开不代表可以删除 upstream attribution；Branding 边界需要单独确认。
- 每个拟商业提供的模型都需要在正式上线前确认其 Model License 与 MaaS 权利。
- 面向中国大陆公众提供服务、跨境数据处理、AI 内容安全等事项属于 Production 商业上线前必须处理的 Compliance Track。

以上仅用于标记合规工作范围，不构成法律结论。正式商业上线应由具备相应职责和专业能力的人员逐项确认。

## 12. 项目知识导航

- Agent 长期工作规则：[`../AGENTS.md`](../AGENTS.md)
- 当前项目状态：[`CURRENT_STATE.md`](CURRENT_STATE.md)
- 基础设施与部署运行手册：[`../deploy/byteplus/README.md`](../deploy/byteplus/README.md)
- 重要决策：[`DECISIONS.md`](DECISIONS.md)
- 历史工作：[`../WORKLOG.md`](../WORKLOG.md)

本文件只维护长期项目背景。阶段目标、当前进展和阻塞进入 `CURRENT_STATE.md`；执行记录进入 `WORKLOG.md`；重要架构、产品或技术取舍进入 `DECISIONS.md`。
