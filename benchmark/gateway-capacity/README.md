# Gateway Capacity Test

这是一套“网关容量测试”工具：把真正的模型推理替换成固定延迟的 Mock Provider，只测用户请求从 MacBook 经公网到 many-models，再到 ECS 内网服务的承载能力。

## 1. 目标与边界

目标：

- 验证真实公网入口、Cloudflare/Tunnel、many-models 鉴权、计量和路由链路在并发请求下是否稳定。
- 分离网关、容器、连接池、CPU、内存、网络等瓶颈，避免把模型/GPU速度误认为网关容量。
- 得到稳定固定 VU 闭环负载档位、请求吞吐、错误率和尾延迟；实际在途请求数需要结合成功请求、延迟和服务端连接观测判断。

非目标：

- 不测 Gemma、DeepSeek 或任何真实模型的质量、GPU 算力、TTFT、ITL 或生产 SLA。
- 不把 VU 数量直接说成用户数。VU 是测试脚本中的虚拟执行者；固定 VU 闭环会等待上一个请求结束后再发下一个请求，不能代表开放流量模型。
- 不改 Go/React 核心代码，不修改正式 Compose，不向公网暴露 Mock 端口。

本测试所得系统容量仍是：`min(网关容量，模型容量)`。本方案只隔离并测出网关这一侧。

## 2. 架构与测试分工

```text
MacBook / k6
    │ HTTPS 公网请求
    ▼
many-models（ECS，仅监听 loopback:3000）
    │ Compose 内部网络：metis-ai-cloud_internal
    ▼
mock-provider:8080（仅内部网络，无 host port）
    │ 固定 sleep / SSE chunk
    ▼
固定可预测的 Mock 响应
```

MacBook 才是“发起测试请求的位置”，更接近真实用户；Mock Provider 必须放在 ECS 的实际应用内网，否则会把网络和服务端路径测偏。

职责分工：

- Agent：维护测试脚本、Mock 镜像、只读监控脚本、结果目录和报告口径。
- 用户：在 ECS 控制台观察实例资源；在 many-models 管理页创建临时 Mock 渠道、生成普通用户测试 Token；在正式压测前再次明确确认。
- 双方：Smoke 通过后再做正式阶梯压测；发现停止线立即停止并保留证据。

## 3. 目录与安全

```text
benchmark/gateway-capacity/
├── .env.example                 # 无真实值模板
├── .env.local                   # 本机未跟踪，权限 600
├── run-k6.sh                    # Docker 方式运行 k6
├── k6/                          # smoke、non-stream、streaming 脚本
├── mock-provider/               # Node.js 内置 HTTP Mock Provider
├── monitor/ecs-snapshot.sh      # ECS 只读快照
└── tests/                       # 本地行为/安全测试

artifacts/benchmarks/gateway-capacity/<run-id>/
└── metadata.txt、summary.json   # 本地未跟踪结果
```

`run-k6.sh` 从 `.env.local` 读取 `GATEWAY_CAPACITY_API_KEY`，只按环境变量名传给 k6，不把 Key 放在命令行、URL、metadata 或报告中。不要把 Key、密码、Cookie、请求头、Prompt 或官方 Provider 日志复制到仓库。

先在 MacBook 创建本地配置：

```bash
cd benchmark/gateway-capacity
cp .env.example .env.local
chmod 600 .env.local
```

只填写你本地保管的值：

```text
GATEWAY_CAPACITY_TARGET=<many-models公网BaseURL>
GATEWAY_CAPACITY_MODEL=mock-sleep-1s
GATEWAY_CAPACITY_API_KEY=<普通测试用户的临时Token>
```

四个 Mock 参数必须和 ECS 容器保持一致：`MOCK_DELAY_MS`、`MOCK_TTFT_MS`、`MOCK_CHUNK_INTERVAL_MS`、`MOCK_CHUNK_COUNT`。默认值分别是 `1000`、`100`、`100`、`4`；配置变更后要在 `metadata.txt` 中核对。

## 4. 本地验证与镜像交付

本地只验证 Mock 协议，不连接正式模型：

```bash
node --test mock-provider/server.test.mjs
bash tests/ecs-snapshot.test.sh
bash tests/run-k6.test.sh
node --test tests/*.test.mjs
bash -n run-k6.sh monitor/ecs-snapshot.sh tests/*.sh
```

镜像应从 MacBook 的 arm 环境构建为 ECS 可运行的 amd64 镜像。示例镜像名仅用于本次临时测试：

```bash
docker build --platform linux/amd64 -t metis-ai-cloud/gateway-capacity-mock:20260826 benchmark/gateway-capacity/mock-provider
docker image inspect metis-ai-cloud/gateway-capacity-mock:20260826 --format '{{.Id}} {{json .RepoDigests}}'
docker save metis-ai-cloud/gateway-capacity-mock:20260826 | ssh ECS-RI4m 'docker load'
ssh ECS-RI4m 'docker image inspect metis-ai-cloud/gateway-capacity-mock:20260826 --format "{{.Id}} {{json .RepoDigests}}"'
```

`docker save | ssh load` 只传镜像，不传 `.env.local`。本地和 ECS 都记录 `Id` 与 `RepoDigests`；临时 tag 本身不是内容不可变证据，报告必须记录实际 image ID，若没有 RepoDigest 就明确写“RepoDigest 未提供”。构建结果到 ECS 后先做只读检查，再创建临时容器。

## 5. ECS 只读 preflight

在创建容器前，由用户在 ECS 控制台确认实例 CPU、内存、网络监控可见；不要修改安全组、告警或正式服务配置。Agent 或用户可在 ECS 执行以下只读核对：

```bash
ssh ECS-RI4m 'docker network ls'
ssh ECS-RI4m 'docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
ssh ECS-RI4m 'docker network inspect metis-ai-cloud_internal --format "{{.Name}} {{range .Containers}}{{.Name}} {{end}}"'
ssh ECS-RI4m 'docker stats --no-stream'
```

必须以实际现场输出确认：

- many-models 应用、PostgreSQL、Redis 均在 `metis-ai-cloud_internal`；网络名和应用容器名不得靠猜测。
- 应用仍只通过 loopback/Tunnel 对外提供服务。
- Mock 使用与正式服务相同的 Compose 内部网络，但不修改正式 Compose 文件。

## 6. 创建临时 Mock 容器

在已经确认 `metis-ai-cloud_internal` 后，在 ECS 执行类似命令。容器不发布 host port，通过网络别名 `mock-provider` 被应用访问；参数可按当天测试记录调整，但四个 `MOCK_*` 必须和本机 `.env.local` 一致。

```bash
ssh ECS-RI4m 'docker rm -f metis-ai-cloud-mock-provider 2>/dev/null || true'
ssh ECS-RI4m 'docker run -d --name metis-ai-cloud-mock-provider --network metis-ai-cloud_internal --network-alias mock-provider --restart=no --cpus=1 --memory=512m --pids-limit=128 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop=ALL --security-opt=no-new-privileges --user 1000:1000 -e MOCK_LOG_REQUESTS=true -e MOCK_DELAY_MS=1000 -e MOCK_TTFT_MS=100 -e MOCK_CHUNK_INTERVAL_MS=100 -e MOCK_CHUNK_COUNT=4 metis-ai-cloud/gateway-capacity-mock:20260826'
```

约束说明：

- `--network metis-ai-cloud_internal`、`--network-alias mock-provider` 是必需项；没有 `-p`，不允许公网访问。
- `--read-only`、非 root、`--cap-drop=ALL`、`pids`/CPU/内存上限用于避免测试工具影响宿主机。
- Smoke 阶段可以保留 `MOCK_LOG_REQUESTS=true` 以取得哨兵证据；正式阶梯压测前停止并重建为 `MOCK_LOG_REQUESTS=false`，避免高并发日志本身成为瓶颈。
- Mock 仅记录时间、路由、状态、stream 标志、固定参数和请求 ID，不记录 API Key、请求头或 Prompt。

容器状态核对（仍然只读）：

```bash
ssh ECS-RI4m 'docker ps --format "{{.Names}} {{.Status}}" metis-ai-cloud-mock-provider'
ssh ECS-RI4m 'docker inspect --format "{{.Name}} restart={{.RestartCount}} oom={{.State.OOMKilled}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} status={{.State.Status}}" metis-ai-cloud-mock-provider'
ssh ECS-RI4m 'docker logs --tail 20 metis-ai-cloud-mock-provider'
```

## 7. many-models 页面配置

由有管理权限的用户在“渠道”页面新建临时渠道，精确填写：

| 字段 | 值 |
| --- | --- |
| 类型 | OpenAI / OpenAI-compatible |
| 名称 | `Gateway Capacity Mock` |
| BaseURL / API 地址 | `http://mock-provider:8080`，不要填 `/v1`；many-models 源码会在 BaseURL 后拼接 `/v1/models` 和 `/v1/chat/completions` |
| 上游 API Key | 任意临时 placeholder；不得使用 DeepSeek、Gemma 或其他有外部权限的真实 Key |
| 模型 | `mock-sleep-1s` |
| 分组 | `default` |
| 映射 | 不映射；模型名保持唯一，避免与正式渠道竞争 |
| 自动禁用 | 关闭 |

用一个普通测试用户生成的 Token 做测试，权限只允许 `mock-sleep-1s`。如果页面启用了“接受未定价模型”开关，在该测试用户的个人设置/通知中临时打开；测试结束后关闭。不要让正式 Gemma/DeepSeek 渠道参与这个用户的请求。

这里的 placeholder 只用于满足渠道表单，不会被 Mock 使用；不要把真实 Key 写进命令、截图或文档。

## 8. Smoke 与证据隔离

先从 MacBook 运行 Smoke。Smoke 使用同一个 VU，顺序执行 1 次非流式请求和 1 次流式请求，不是只测其中一种：

```bash
cd benchmark/gateway-capacity
GATEWAY_CAPACITY_ENV_FILE="$PWD/.env.local" bash ./run-k6.sh smoke
```

默认参数下，非流式约等待 1000ms，流式约等待 `100ms + 3×100ms`，因此整个顺序 Smoke 约 1.4 秒（另含公网和网关开销）。两次都必须 HTTP 200、JSON/SSE 协议正确、返回模型是 `mock-sleep-1s`、响应耗时与固定 sleep 基本一致、many-models 日志显示临时渠道、Mock 容器收到请求。

建议保留三类哨兵证据，三者缺一不可：

1. 网关侧：many-models 日志/用量页显示测试用户、`mock-sleep-1s` 和临时渠道。
2. 上游侧：Mock 日志中的请求 ID、时间、route 和 `stream` 与 Smoke 数量对应。
3. 隔离侧：正式 Gemma/DeepSeek 渠道没有被该测试用户选中，也没有新增官方 Provider 调用记录。

Smoke 不通过时不做阶梯压测。Smoke 通过后，正式阶梯前将容器重建为 `MOCK_LOG_REQUESTS=false`，再次做一条单请求健康核对。

## 9. 阶梯、流式和 30 分钟稳定性

所有正式负载命令都要求显式设置以下确认值；这不是“默认打开”的测试。

```bash
export GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD
```

固定 VU 非流式建议从 `10、25、50、100、200、400` 开始，每档 2 分钟；流式因连接驻留时间更长，建议从 `5、10、25、50、100` 开始。每档之间等待资源回落并保存结果目录。每个 VU 会在上一次请求完成后再发下一次请求，因此这里判断的是“稳定固定 VU 闭环负载档位”，不是实际用户数，也不是开放模型的在途请求上限。

示例（正式执行前必须由用户再次明确确认）：

```bash
GATEWAY_CAPACITY_VUS=10 GATEWAY_CAPACITY_DURATION=2m bash ./run-k6.sh non-stream
GATEWAY_CAPACITY_VUS=25 GATEWAY_CAPACITY_DURATION=2m bash ./run-k6.sh non-stream
GATEWAY_CAPACITY_VUS=10 GATEWAY_CAPACITY_DURATION=2m bash ./run-k6.sh streaming
```

找到稳定上限后，再以约 70%～80% 的稳定 VU 做 30 分钟 soak：

```bash
GATEWAY_CAPACITY_VUS=<已确认稳定值> GATEWAY_CAPACITY_DURATION=30m bash ./run-k6.sh non-stream
```

结果应报告稳定固定 VU 闭环负载档位、成功请求数、RPS、p50/p95/p99 端到端延迟、HTTP 错误率、429/502/503/504、连接错误和 ECS 资源曲线。若要估算实际在途请求，必须同时引用成功请求、延迟和服务端连接观测；不要把它写成“可支持 X 个用户”。

## 10. ECS 监控与停止线

测试前、每档结束后和停止时各采集一次快照。输出到 stdout：

```bash
ssh ECS-RI4m 'bash -s -- --stdout --container metis-ai-cloud-app-1 --container postgres-1 --container redis-1 --container metis-ai-cloud-mock-provider' < benchmark/gateway-capacity/monitor/ecs-snapshot.sh
```

输出到 ECS 临时目录：

```bash
ssh ECS-RI4m 'bash -s -- --output-dir /tmp/gateway-capacity-snapshots --container metis-ai-cloud-app-1 --container postgres-1 --container redis-1 --container metis-ai-cloud-mock-provider' < benchmark/gateway-capacity/monitor/ecs-snapshot.sh
```

快照只读采集 UTC 时间、主机 CPU/内存/磁盘/load、`docker ps`、`docker stats`、显式目标容器 restart/OOM/health、`vmstat`、`ss -s` 和默认路由网卡 `ip -s link`。命令中的 `metis-ai-cloud-app-1`、`postgres-1`、`redis-1`、`metis-ai-cloud-mock-provider` 是 2026-08-26 Preflight 的现场示例值；如果容器编排名称发生变化，必须先重跑 Preflight，再把现场发现的合法名称传给重复的 `--container` 参数。脚本允许的名称格式为 `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`，不需要为合法新名称修改脚本。未传 `--container` 会明确拒绝运行，不会把“没有匹配容器”当作健康结果。可用 `timeout` 时，Docker/vmstat/ss/ip 单次采集使用 5 秒短超时；没有 `timeout` 时会标记降级并继续采集。

立即停止当前档位或整场测试的条件：

- 错误率超过 1%，或 429/502/503/504 持续出现；
- 非流式 `gateway_overhead_duration_ms` 的 p95 超过 1 秒，或流式 `gateway_http_ttfb` 的 p95 超过 1 秒；k6 会在连续评估 10 秒后自动中止对应负载。流式指标是 HTTP 首字节近似值，不是模型 Token TTFT；
- ECS CPU 持续超过 85% 两分钟，内存超过 80% 或持续增长；
- 文件描述符、连接池、网络连接耗尽，容器 OOM/restart/health 失败；
- many-models、Mock 或公网入口无法恢复健康。

ECS 资源、容器 restart/OOM/health 和网络异常仍由人工观察并决定停止；自动停止线不能替代人工监控。宿主机上不要执行包含完整环境变量、请求头或 Prompt 的 `docker inspect`、应用日志导出或调试命令。

## 11. 结果与清理

每次 `run-k6.sh` 会在 `artifacts/benchmarks/gateway-capacity/<run-id>/` 写入 `metadata.txt` 和 k6 `summary.json`。结果至少附：配置参数、镜像 digest、起止 UTC 时间、每档 VU/时长、停止原因、快照文件和三方 Mock 哨兵证据。原始结果仅保留在本地未跟踪目录。

测试结束按以下顺序回收：

```bash
# 先停止 MacBook 上仍在运行的 k6，再在页面禁用/删除临时渠道。
ssh ECS-RI4m 'docker stop metis-ai-cloud-mock-provider 2>/dev/null || true'
ssh ECS-RI4m 'docker rm metis-ai-cloud-mock-provider 2>/dev/null || true'
ssh ECS-RI4m 'docker image rm metis-ai-cloud/gateway-capacity-mock:20260826 2>/dev/null || true'
```

清理后复核 `/api/status`、正式 Gemma/DeepSeek 单请求、数据库/Redis、Tunnel 和正式渠道启用状态。不要因为临时 Mock 测试失败而回滚正式应用；正式发布回滚也不会自动清理渠道和临时容器。

正式阶梯压测、30 分钟 soak、删除渠道和删除镜像都必须在对应阶段获得用户确认；Smoke 通过不等于已授权整场公网压测。
