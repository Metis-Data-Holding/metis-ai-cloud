# Benchmark 图表选型记录

本报告按 `lieflat-charts` 的模板驱动流程生成。整页模板锁定为：

- 系统：Reports
- 报告 ID：R09
- 标题：Data Story Dashboard / 数据故事仪表盘
- 文件：`templates/reports/report-09.zh.html`
- 色板：Porcelain

## 整页模板候选

| 候选 | 判断 |
|---|---|
| R09 Data Story Dashboard | 采用。2×2 图区、KPI 侧栏和顶部结论区适合老板快速阅读。 |
| R04 Monthly Ops Report | 不采用。结构清晰，但“逐日/月度运营”语义与一次性容量测试不匹配。 |
| R01 Survey One-Pager | 不采用。解释性强，但侧栏占比过大，无法同时容纳四个核心结论。 |

## 图表候选审计

### 1. 容量退化

- 采用：Basics F6 `Paired Rungs`，原卡片标题 `This year against last, plan by plan`。
- 原因：并发 4/6/8 是三个离散档位；TTFT 与端到端延迟单位相同，可并排比较。
- 未采用：F2 `Hairline Line`，只有三个离散档位，不是真正时间序列；F12 `Dumbbell Queue` 更适合 before/after；L2 `Dot Cascade` 会弱化精确读数。

### 2. 吞吐平台

- 采用：Basics F1 `Rung Bars`，原卡片标题 `Revenue by plan, rung by rung`。
- 原因：三个并发档位为少量类目；每格代表 2 tok/s，可直接看出吞吐停留在同一平台区。
- 未采用：F2 `Hairline Line` 容易暗示连续趋势；F5 `Tick Rows` 横向空间不利于和同页其他图对齐；L2 `Dot Cascade` 不适合三个精确数值。

### 3. 模型流式体验

- 采用：Basics F5 `Tick Rows`，原卡片标题 `Six teams, shipped and counted`。
- 原因：Gemma 与 DeepSeek 是两个独立类目；每格代表 2 ms/token，DeepSeek 的输出节奏优势可以被直接计数。
- 未采用：F6 `Paired Rungs` 只有一项对比，结构过重；F12 `Dumbbell Queue` 会暗示同一对象改造前后；F1 `Rung Bars` 与上一图重复，降低页面辨识度。

### 4. DeepSeek 成本集中

- 采用：Lupi L14 `Hundred Field`，原卡片标题 `A hundred of us, four minds`。
- 原因：一次未关闭 thinking 的请求占本批费用约 85%，天然适合分解成 100 个可数单位。
- 未采用：F4 `Tick Donut` 仍是环形占比，解释“单次请求吞掉大部分预算”不如单位簇直观；L15 `Ballot Tally` 面向多选题；F7 `Stacked Rungs` 对 85/15 的二分构成显得过重。

## 口径约束

- 所有图表只使用 `benchmark-report.md` 已记录的聚合值，不从截图臆测缺失数据。
- 短时阶梯的 P95 标记为探索性；HTML 核心图优先使用 P50，避免低样本长尾被误读为 SLA。
- 并发不等于用户数；模型参考测试不等于 DeepSeek 官方容量测试。
- 图表颜色只使用 Porcelain 角色色，不新增临时色板。

## 2026-08-24 参数实验更新

- 容量退化图与吞吐图的数据切换为 `Max Concurrent Predictions = 6` 下的并发 4、5、6 对照；图型仍保持 F6 与 F1，不改变编码契约。
- TTFT、E2E、P50 与并发解释放入 F6 图顶部留白；TPS 解释放入 F1 图顶部留白；ITL 与费用占比解释分别放入 F5、L14 图内留白。
- 删除 HTML 底部重复的独立词典区，降低页面长度；完整术语表仍保留在 Markdown 报告。
- GPU 卡片使用本次 CSV 全程范围 23869～23902 MiB 和温度峰值 57°C；不把每秒 `nvidia-smi` 利用率采样单独解释为算力上限。

## 2026-08-26 网关容量更新

### 5. 网关通过档与停止档

- 采用：Basics F12 `Dumbbell Queue`，原卡片标题 `Onboarding, before and after the redesign`。
- 原模板编码：空心点与实心点表示两个离散状态，中间珠子表示可数差值。
- 本报告映射：空心点为“最后通过 VU”，实心点为“首个触发停止 VU”，每珠代表 5 VU；两行共用 0～200 VU 线性尺度。
- 原因：非流式和 Streaming 均只有一个最后通过档与首个停止档，正好是两点差值问题；通过档和停止档的精确数值放在 SVG 外的独立数据区，避免图形覆盖文字。
- 未采用：F2 `Hairline Line` 会暗示未测档位之间存在连续趋势；F1 `Rung Bars` 已用于模型吞吐，且不能同时表达通过与停止边界；F6 `Paired Rungs` 更适合同单位两个性能指标，不适合状态边界。

### 表达边界

- 网关 VU 与真实模型并发分开呈现；Hero 的“4”明确标为真实模型并发，不与网关 100 / 25 VU 混用。
- 图表不表达“可支持用户数”；固定 VU 闭环不等于开放到达率或 Production SLA。
- 30 分钟轮次没有采集 P99；只展示 P50、P95 与 Max，并明确说明 Max 不等于 P99。
