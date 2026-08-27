# Serving Benchmark

本目录使用 GuideLLM 0.7.2 测试 OpenAI-compatible 模型服务，不实现自有压测框架。

## 安全边界

- endpoint、model 和 API Key 只放在未跟踪的 `.env.local`；
- API Key 不写入命令参数；
- `sample_size: 0` 禁止保存 Prompt、完整回答和请求参数；
- GuideLLM 原始 JSON / CSV 仍包含 target URL，只能保存在已忽略的 `artifacts/benchmarks/`；
- 测试结果对外使用前必须再次脱敏；
- 正式运行前必须设置请求数、时长、并发和输出 Token 上限。

## 本地配置

在 `benchmark/serving/.env.local` 写入以下变量，值由用户在本机填写：

```dotenv
GUIDELLM__SPEC__BACKEND__TARGET=
GUIDELLM__SPEC__BACKEND__MODEL=
GUIDELLM__SPEC__BACKEND__API_KEY=
```

macOS / Linux 执行：

```bash
chmod 600 benchmark/serving/.env.local
benchmark/serving/run-guidellm.sh run \
  --config benchmark/serving/guidellm.example.yaml
```

启动脚本在 macOS 自动使用 multiprocessing `spawn`。GuideLLM 0.7.2 默认 `fork` 已在当前 macOS 环境稳定复现 worker `signal 11`，不能用于正式测试。

## Windows GPU 监控

在安装 LM Studio 和 NVIDIA GPU 的 Windows 主机上，从仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File benchmark/serving/monitor/windows-nvidia-monitor.ps1
```

脚本每秒显示并保存 GPU 利用率、显存、温度和功耗，结果写入已忽略的
`artifacts/benchmarks/gpu-<时间>.csv`。开始压测前运行，压测结束后按
`Ctrl+C` 停止；脚本不采集 Prompt、API Key 或模型回答。

## 负载顺序

1. 使用示例配置执行 1 个 Streaming 请求；
2. 确认成功、Usage、TTFT、ITL / TPOT 和结果脱敏；
3. 再以 `concurrent` profile 分别运行并发 1、2、4、8、16；
4. 每档检查错误、GPU / VRAM 和服务健康后再上探。

DeepSeek 只运行小样本参考，不测试官方容量上限。需要关闭 thinking 时，将其放在 backend 的顶层额外请求 body 中：

```yaml
extras:
  body:
    thinking:
      type: disabled
```

## 加权路由功能测试

`guidellm.routing.yaml` 用 30 个并发 1、32 Token 上限的 Streaming 请求验证：客户端始终请求
`google/gemma-4-31b`，New API 是否能在同组、同优先级的 Gemma 与 DeepSeek
渠道间按权重选择。DeepSeek 渠道必须先在管理页面配置模型映射，并在渠道侧关闭
thinking，避免将 DeepSeek 的额外推理成本带入本次功能测试。

```bash
benchmark/serving/run-guidellm.sh run \
  --config benchmark/serving/guidellm.routing.yaml
```

GuideLLM 只能确认客户端请求是否成功，不能单独证明真实路由。最终比例以 New API
管理日志中的 `Channel` 字段为主证据，并与 DeepSeek 官方后台、LM Studio 日志的同一
时间窗口交叉核对。30 个请求只用于证明双渠道分流，不用于声称权重比例已经统计收敛。

## 输出口径

- 少于 100 个有效样本的 P95 仅标为探索性；
- 没有约 300 个零失败样本，不声称成功率达到 99%；
- `sample_size: 0` 后，原始请求参数和模型完整输出应为 `null`；
- closed-loop 并发表示持续在途请求数，不等于注册用户数或峰值 RPS。
