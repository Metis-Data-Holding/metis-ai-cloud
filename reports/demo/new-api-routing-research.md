# New API“掺水”路由研究

> 研究日期：2026-08-24
> 研究范围：New API 官方文档、`QuantumNous/new-api` 官方仓库，以及当前项目 fork 的对应实现。
> 目标：客户端请求公开模型 `google/gemma-4-31b`，其中一部分请求仍由本地 Gemma 处理，另一部分在网关层改投其他合法授权模型（本轮拟使用 `deepseek-v4-flash`）。

## 结论先行

这个功能可以通过现有配置完成，不需要修改 New API 源码：

```text
客户端请求 google/gemma-4-31b
             |
             v
New API 在同一 Group、同一 Priority 的候选渠道中按 Weight 选择
       /                                             \
      v                                               v
本地 Gemma 渠道                                      DeepSeek 渠道
模型名：google/gemma-4-31b                            Model Mapping：
                                                     {"google/gemma-4-31b":"deepseek-v4-flash"}
```

推荐的 Demo 配置：

| 渠道 | `Models` 中的公开模型 | `Group` | `Priority` | `Weight` | `Model Mapping` |
|---|---|---|---:|---:|---|
| 本地 Gemma | `google/gemma-4-31b` | `default` | 10 | 70 | 留空 |
| DeepSeek 备用 | `google/gemma-4-31b` | `default` | 10 | 30 | `{"google/gemma-4-31b":"deepseek-v4-flash"}` |

这表示“目标流量大致按 70:30 分配”，不是每 10 个请求严格 7 个和 3 个。权重是随机分流参数，样本越少，实际比例波动越大。

## 官方语义

### Priority：先决定哪一层渠道有资格接请求

官方 FAQ 的定义是：数字越大，优先级越高；高优先级渠道会优先使用。只有当前优先级没有可用渠道，或请求进入重试路径时，才会尝试较低优先级的渠道。

因此：

- 想做正常的“掺水”分流，两条渠道应使用相同 `Priority`。
- 如果把本地 Gemma 设为 `Priority=10`、DeepSeek 设为 `Priority=1`，通常不是 70:30 分流，而是优先全部走 Gemma，只有失败/重试时才可能走 DeepSeek。
- `Priority` 更适合做主备或故障降级；`Weight` 更适合做同层流量拆分。

官方依据：[New API FAQ：权重和优先级](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/support/faq.mdx#L232-L249)、[官方渠道管理文档](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/en/guide/feature-guide/admin/channel.mdx#L215-L234)。

### Weight：同一优先级内的加权随机

官方 FAQ 明确说明：同一优先级的渠道按权重比例分配请求，并以 `2:1` 为例。官方项目也将多渠道负载均衡描述为支持“加权随机分发”。

例如同组同优先级下：

```text
本地 Gemma：Weight=70
DeepSeek：Weight=30
```

长期样本的期望比例约为 70% / 30%，但单次请求无法预知会落到哪条渠道。

官方依据：[New API FAQ](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/support/faq.mdx#L232-L249)、[官方项目介绍：智能路由与加权随机](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/guide/wiki/basic-concepts/project-introduction.mdx)。

### Group：先筛选用户/令牌能访问的渠道池

`Group` 不是第三条随机分流参数，而是渠道可见范围和访问隔离边界：令牌的分组、用户分组和渠道分组需要匹配，渠道才会进入候选池。

本轮测试应让两条渠道使用同一个 `Group`（例如 `default`），并确保测试令牌使用该组。不要把两条渠道放进不同 Group 后再期待它们按 70:30 混合；不同 Group 的选择属于分组选择或 `auto` 分组容灾逻辑，不是同一候选池内的权重分流。

官方依据：[New API 分组管理文档](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/guide/feature-guide/admin/group.mdx)、[官方 FAQ 对用户分组、渠道分组和模型设置的排查顺序](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/support/faq.mdx#L244-L249)。

## Model Mapping：把公开模型名改成渠道实际调用名

`Model Mapping` 的方向是：

```text
左侧 / JSON key：用户请求的模型名
右侧 / JSON value：该渠道实际发送给上游的模型名
```

本轮备用渠道应配置：

```json
{
  "google/gemma-4-31b": "deepseek-v4-flash"
}
```

重要边界：

1. `google/gemma-4-31b` 必须出现在备用渠道的 `Models` 列表中，否则该渠道不会因为这个公开模型名进入候选池。
2. `deepseek-v4-flash` 是映射目标，通常不必放进该渠道的 `Models` 列表；当前 fork 的页面校验还会提示：映射源模型必须在 `Models` 列表中，而把目标模型也放进公开模型列表会污染 `/v1/models` 展示。
3. 映射发生在“渠道已经选中”之后。因此 Model Mapping 本身不会把一个只支持 Gemma 的渠道变成 DeepSeek 渠道；它必须与第二条实际连接 DeepSeek 的渠道配合使用。
4. 当前 fork 支持链式映射，并会检测循环。例如 `A -> B -> C` 最终使用 `C`，循环映射会返回错误。

官方依据：[官方渠道文档的 Model Mapping 字段说明](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/en/guide/feature-guide/admin/channel.mdx#L225-L234)、[官方渠道管理文档中的 Mapping 说明和 `original_model` / `upstream_model` 变量](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/guide/console/channel-management.mdx#L510-L516)。

当前 fork 证据：[模型映射实现](https://github.com/QuantumNous/new-api/blob/main/relay/helper/model_mapped.go)、[渠道能力表按 `Models` 和 `Group` 建立候选关系](https://github.com/QuantumNous/new-api/blob/main/model/ability.go)、[当前 fork 页面校验](../../web/src/features/channels/lib/model-mapping-validation.ts)。

## 是否支持按权重随机分流？

支持，但本项目需要注意实现路径差异。

当前 fork 的内存缓存路径 `model/channel_cache.go` 会：

1. 找到指定 `Group` 和公开模型的启用渠道；
2. 按 `Priority` 从高到低分层；
3. 只在当前优先级层内按 `Weight` 随机；
4. 失败重试时再尝试下一优先级层。

当前 fork 的非内存缓存数据库路径 `model/ability.go` 使用了 `Weight + 10` 的平滑公式，而内存缓存路径使用原始 `Weight`（全为 0 时才做等量随机）。官方仓库的公开 issue 已记录这一差异，因此不能在报告中把 70/30 写成严格保证，尤其不能用很小的权重值解读为精确比例。

官方源码：[内存缓存渠道选择](https://github.com/QuantumNous/new-api/blob/main/model/channel_cache.go)、[数据库渠道选择](https://github.com/QuantumNous/new-api/blob/main/model/ability.go)；官方 issue：[缓存和非缓存路径的权重比例差异 #6510](https://github.com/QuantumNous/new-api/issues/6510)。

本轮实验建议：记录实际部署是否启用了内存缓存/Redis；固定同一配置，发送足够多的请求，按后台日志中“渠道”字段统计，而不是只根据客户端响应推断比例。

## 页面配置步骤

以下步骤需要管理员在页面上手动完成；本研究不代替线上配置，也不会读取或记录 API Key。

1. 使用管理员账号进入「渠道」页面，官方文档对应路径为 `/console/channel`。
2. 编辑本地 LM Studio / Gemma 渠道：
   - `Models`：保留 `google/gemma-4-31b`；
   - `Group`：`default`；
   - `Priority`：`10`；
   - `Weight`：`70`；
   - `Model Mapping`：留空；
   - 确认渠道状态为启用。
3. 新建或编辑 DeepSeek 渠道：
   - 渠道类型、Base URL、API Key 使用已经验证过的 DeepSeek 官方渠道配置；
   - `Models`：加入 `google/gemma-4-31b`，不要只填写 `deepseek-v4-flash`；
   - `Group`：`default`；
   - `Priority`：`10`；
   - `Weight`：`30`；
   - 展开高级配置中的 `Model Mapping`，填写：

     ```json
     {"google/gemma-4-31b":"deepseek-v4-flash"}
     ```

   - 保存并确认渠道状态为启用。
4. 确认测试 API Key 所属令牌可以使用 `default` 分组，并且模型限制没有排除 `google/gemma-4-31b`。
5. 保存后等待渠道缓存刷新，再用公开模型名请求：

   ```json
   {
     "model": "google/gemma-4-31b",
     "messages": [{"role": "user", "content": "请用一句话说明今天的天气测试。"}],
     "stream": false,
     "max_tokens": 32
   }
   ```

请求方始终只填写 `google/gemma-4-31b`，不在客户端请求中填写 `deepseek-v4-flash`。

## 如何验证实际路由

### 后台日志是主证据

在管理员「日志 / 通用日志」中筛选本次测试时间、测试用户或测试令牌，逐条观察：

- `Model`：通常应显示用户请求的公开模型 `google/gemma-4-31b`，用于确认用户看到的统一模型名；
- `Channel`：应在本地 Gemma 渠道和 DeepSeek 渠道之间出现；这是判断实际渠道的关键字段；
- `Tokens`、耗时、流式状态：用于核对调用是否完整成功；
- `Request ID` / `Upstream Request ID`：用于把 New API 日志与上游控制台记录关联起来。

官方日志数据结构同时记录 `ModelName`、`ChannelId`、`ChannelName`、Token 数和请求 ID：[官方 `model/log.go`](https://github.com/QuantumNous/new-api/blob/main/model/log.go)。官方文档也将使用记录定义为包含每次 API 调用的模型、Token 消耗和配额扣减：[功能指南概述](https://github.com/QuantumNous/new-api-docs-v1/blob/main/content/docs/zh/guide/feature-guide/index.mdx)。

### DeepSeek 官方后台是交叉证据

只有实际落到 DeepSeek 渠道的请求才会出现在 DeepSeek 官方控制台。将 DeepSeek 控制台在相同时间窗口的请求数、Token 数与 New API 日志中 DeepSeek 渠道的行数/Token 数对比，可以确认 Model Mapping 确实穿透到了 DeepSeek 上游。

本地 LM Studio 日志则用于确认另一部分请求是否真正到达本地 Gemma。两边都应使用同一个时间窗口，并排除管理员单渠道测试、模型列表探测和失败重试等非业务请求。

### 不要只依赖客户端返回的 `model`

Model Mapping 后，上游响应中的 `model` 字段可能显示 `deepseek-v4-flash`，也可能被客户端或适配器改写；当前官方仓库已有 issue 记录映射后响应体 `model` 字段与用户原始模型名不一致的情况。它不能单独作为计费或路由的最终证据。

官方 issue：[Model Mapping 后响应体 `model` 字段未改写回 OriginModelName #5868](https://github.com/QuantumNous/new-api/issues/5868)。

## 建议的本轮功能测试

### A. 单请求映射冒烟

先发 1 次非流式、1 次流式请求，客户端都使用 `google/gemma-4-31b`。验收：

- 两次请求都能成功返回；
- New API 日志中的公开模型名正确；
- 至少有一次请求落到 DeepSeek 渠道；
- DeepSeek 官方后台出现对应调用；
- 本地 LM Studio 日志仍能看到另一条 Gemma 调用（若随机结果未命中，增加样本，不要以单次未命中判定失败）。

### B. 统计分流比例

建议发送 100 次固定输入、固定 `max_tokens` 的短请求，全部使用公开模型名。统计：

- 本地 Gemma 渠道请求数；
- DeepSeek 渠道请求数；
- 成功/失败/超时；
- New API 总耗时和 Token；
- DeepSeek 官方实际请求数和 Token；
- 本地 GPU/显存变化。

70/30 只是期望比例。100 个样本下出现大约 60:40 或 80:20 仍可能是随机波动，建议把“是否发生双渠道分流”作为功能验收，把比例接近程度作为观察指标。若要更稳定地估计比例，可增加到 300～500 个短请求。

### C. 计费核对

对同一时间窗口核对：

1. New API 日志以哪个公开模型名计费；
2. DeepSeek 官方产生了多少真实上游费用；
3. 本地 Gemma 请求是否按预期价格计费；
4. 映射到不同能力模型后，用户是否仍被展示为同一个 Gemma 模型。

当前 fork 的价格 helper 以 `OriginModelName` 计算模型价格，消费日志也记录原始模型名；因此“请求显示 Gemma、实际由 DeepSeek 响应”可能仍按 Gemma 的本地计费配置结算，不能默认等于上游实际成本。正式商业化前必须明确这是统一产品价、成本转嫁还是内部测试价。

## 风险和汇报口径

### 技术风险

- **能力差异**：Gemma 和 DeepSeek 的推理、工具调用、上下文长度、格式遵循能力可能不同；同一公开模型名会让客户端误以为行为完全一致。
- **流式协议差异**：两条渠道的 `stream`、usage chunk、reasoning 字段和停止原因可能不同；必须同时做非流和流式验证。
- **响应模型名差异**：映射后的上游模型名可能泄露到响应或客户端统计中；不要把客户端展示字段当成路由证据。
- **缓存/权重差异**：内存缓存和数据库路径的权重实现存在差异，测试报告需要记录运行模式。
- **失败重试污染统计**：一次用户请求可能产生多次上游尝试；统计时区分“用户请求数”和“上游尝试数”。

### 商业和合规风险

- **用户知情**：如果对外宣称提供 Gemma，却在后台静默发送到 DeepSeek，建议至少在产品说明、服务条款或管理后台明确“模型可能由兼容上游模型提供”。
- **数据边界**：原本应留在本地的请求可能被发送到外部 DeepSeek，必须确认用户数据、日志、跨境传输和上游服务条款允许这样做。
- **计费透明**：同一公开模型名背后有不同成本和能力时，应采用统一产品价或显式模型别名，避免用户和运营人员误解。
- **授权范围**：官方文档要求上游渠道必须是部署方合法拥有或已获授权的账号、API Key、模型服务或企业合约；本测试只使用已经授权的测试渠道。

## 对老板的简短解释

> 我们可以让用户只看到一个统一的 Gemma4 模型入口，网关根据配置把请求按比例分给本地 Gemma 和其他已授权模型。它证明了平台具备“统一模型名、后台多渠道路由、统一计费和用量记录”的能力，但不同模型的效果、成本和数据边界不完全相同，所以正式商业化前需要把路由规则、计费口径和用户知情机制产品化。

## 2026-08-24 实测结果

- 两条渠道最终配置为同一 `Group=default`、同一 `Priority=10`，Gemma / DeepSeek
  `Weight=70 / 30`。
- 20 个非流式短请求全部成功；响应模型字段观察到 Gemma 13 次、DeepSeek 7 次，即
  65% / 35%。
- 30 个并发 1 的 Streaming 请求全部成功、0 错误；TTFT P50 / P95 为
  0.943s / 1.335s，端到端延迟 P50 / P95 为 2.30s / 3.10s。
- 核心能力“统一公开模型名、后台加权选择、DeepSeek 模型映射、两渠道 Streaming
  兼容”判定通过。
- Streaming 批次逐渠道命中数仍需 New API 后台日志交叉确认；GuideLLM 的混合流式
  输出 Token 统计高于配置上限，暂不作为计费依据。
