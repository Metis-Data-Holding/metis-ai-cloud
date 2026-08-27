# BytePlus ECS 部署基线

本目录用于把当前 fork 的固定 Commit 镜像部署到 BytePlus ECS。目标是 Demo / PoC 运行基线，不替代 Production 高可用设计。

> 运行态最后验收：2026-08-23
>
> 当前公网入口：`https://many-models.metisdata.ai`
>
> 当前 release：`b740f5f52f8c14290b62d5b4351cf64ce0ab97db`

## 当前拓扑

```text
Internet / API Client
        ↓ HTTPS
Cloudflare Universal SSL + Tunnel byteplus-hk-RI4m
        ↓ http://127.0.0.1:3000
BytePlus ECS
  ├─ metis-ai-cloud app
  ├─ PostgreSQL 15
  ├─ Redis 7
  ├─ GitHub Actions Self-hosted Runner（仅发布 / 回滚）
  └─ Tailscale ──→ Singapore LM Studio
```

- ECS 安全组不需要开放 `3000`、`5432` 或 `6379`；Cloudflare Tunnel 从 ECS 内部访问回环端口。
- `xy-stock.metisdata.ai` 共用同一个 Tunnel，但使用独立 route、端口、服务和数据目录。
- Tailscale 只承载 ECS 到新加坡模型的私网通信，不接管 ECS 系统 DNS，不启用 exit node 或 subnet route。

## 边界

- Compose project 固定为 `metis-ai-cloud`，不复用现有项目的容器、网络或目录。
- 应用仅发布 `127.0.0.1:3000`；PostgreSQL 与 Redis 不发布宿主端口。
- 持久数据只写入 `/data/metis-ai-cloud/shared/`。
- Secret 只存在于 ECS 的 `/etc/metis-ai-cloud/`，该目录必须为 root-only。
- `.release.env` 只保存非敏感的固定镜像引用，随对应 release 保存。
- 不使用仓库根目录 Compose 中的 upstream `latest` 镜像或示例凭据。

## ECS 目录

```text
/data/metis-ai-cloud/
├── current -> releases/<full-commit>
├── releases/
│   └── <full-commit>/
│       ├── compose.yml
│       ├── .release.env
│       └── image.sha256
└── shared/
    ├── app-data/
    ├── logs/
    ├── postgres/
    └── redis/

/etc/metis-ai-cloud/
├── app.env
├── postgres.env
└── redis.conf

/data/github-runner/
└── metis-ai-cloud-actions-runner/

/usr/local/lib/metis-ai-cloud/
└── compose.yml

/usr/local/sbin/
└── metis-ai-cloud-release

/etc/sudoers.d/
└── metis-ai-cloud-deploy
```

## Secret 文件要求

真实值必须在 ECS 上直接生成，不得通过 Git、聊天或文档传递。部署前应保证：

```text
/etc/metis-ai-cloud              root:root 0700
/etc/metis-ai-cloud/app.env      root:root 0600
/etc/metis-ai-cloud/postgres.env root:root 0600
/etc/metis-ai-cloud/redis.conf   999:1000   0400
```

`redis.conf` 的数值 owner 对应官方 `redis:7-alpine` 镜像内的 `redis` 用户；宿主的 root-only 父目录仍阻止普通宿主用户遍历，容器内 Redis 则可只读挂载该文件。更新 Redis 镜像前必须重新核对 UID/GID。

`app.env` 中的 PostgreSQL 和 Redis 密码必须分别与 `postgres.env`、`redis.conf` 保持一致。`TRUSTED_PROXIES` 应填写该 Compose project 实际创建的 bridge network CIDR，不能照抄示例。

## 首次手工建立顺序

1. 构建固定 Commit 的 `linux/amd64` 镜像，导出归档并计算 SHA-256。
2. 在 ECS 创建隔离目录和 root-only Secret，再上传并校验 release。
3. 加载镜像，以 release 内 `.release.env` 指定完整镜像标签。
4. 运行 `docker compose --env-file .release.env -f compose.yml up -d`。
5. 先在 ECS 验证 `http://127.0.0.1:3000/api/status`，再通过 SSH port forwarding 完成人工管理员初始化。
6. 验证容器重启和 PostgreSQL 持久化后，才在既有 Cloudflare Tunnel 新增 `many-models.metisdata.ai -> http://127.0.0.1:3000`。

不得把命令已执行等同于部署成功；运行态以健康接口、容器状态、持久化探针和公网 HTTPS 的实际结果为准。

该流程用于首次建立基线或灾难恢复，不是日常发布方式。日常上线应从 GitHub Actions 人工触发 Deploy Workflow。

## GitHub Actions 部署与回滚

自动化采用两段式执行：

```text
GitHub-hosted Runner
  ├─ 后端 / 前端验证
  └─ 构建 linux/amd64 镜像并推送 GHCR
                  ↓ 固定 digest
ECS Self-hosted Runner
  └─ sudo /usr/local/sbin/metis-ai-cloud-release
       ├─ deploy
       └─ rollback
```

相关文件：

- `.github/workflows/deploy-byteplus.yml`：人工选择 Git ref，验证、构建、推送并部署。
- `.github/workflows/rollback-byteplus.yml`：人工输入已有完整 Commit，并以 `ROLLBACK` 二次确认。
- `metis-ai-cloud-release`：root-owned 受限发布入口。
- `metis-ai-cloud-deploy.sudoers`：仅允许 `github-runner` 调用该入口。
- `install-actions-deploy.sh`：安装发布入口、root-owned Compose 模板和 sudoers；不注册 Runner、不修改 Secret。

### ECS Runner 边界

- 复用现有 Linux 账户 `github-runner`，但不复用或修改 xy-stock Runner 实例。
- 为本仓库使用独立目录、Runner service 和 labels：`byteplus-hk`、`metis-ai-cloud`、`deploy`。
- `github-runner` 不加入 `docker` 组，不获得通用 sudo、shell 或任意文件写权限。
- Self-hosted job 不 checkout 被部署 ref；目标代码只在 GitHub-hosted Runner 构建。
- 应用 Secret 继续只存在于 `/etc/metis-ai-cloud/`。

### 首次启用

1. 在 GitHub 仓库的 **Settings → Actions → Runners** 创建 repository-level Linux x64 Runner。
2. 在 ECS 以 `github-runner` 账户使用 GitHub 页面给出的短期注册命令，安装到独立目录，例如 `/data/github-runner/metis-ai-cloud-actions-runner`。Runner 名称可用 `byteplus-hk-metis-ai-cloud-01`，并配置上述三个自定义 labels。不得把注册 token 粘贴到聊天、仓库或日志。
3. 按 GitHub 页面说明把该 Runner 安装为独立 systemd service；确认现有 xy-stock Runner 仍为 active。
4. 从可信的本仓库 checkout 执行：

   ```bash
   sudo deploy/byteplus/install-actions-deploy.sh
   sudo visudo -cf /etc/sudoers.d/metis-ai-cloud-deploy
   sudo -u github-runner sudo -n /usr/local/sbin/metis-ai-cloud-release status
   ```

5. 在 GitHub 创建 Environment `byteplus-demo`。在套餐支持时配置 required reviewer 和 deployment branch policy。
6. 确认仓库 Actions 对本仓库关联 GHCR package 具有读写权限。Workflow 使用短期 `GITHUB_TOKEN`，不需要保存 ECS SSH Key 或长期 GHCR PAT。
7. 将 Workflow 合入默认分支；`workflow_dispatch` 文件只有位于默认分支后才能从 Actions 页面可靠触发。

### 使用

部署：打开 **Actions → Deploy BytePlus ECS → Run workflow**，输入要部署的 branch、tag 或完整 Commit。`main` 是 Demo 稳定分支，`develop` 是日常集成分支；正式 Demo 发布默认选择 `main`，只有明确需要验收集成状态时才直接部署 `develop`。Workflow 只有在 GitHub-hosted 验证、镜像构建、ECS 本机健康检查和公网 HTTPS 检查全部完成后才标记成功。

回滚：打开 **Actions → Roll back BytePlus ECS → Run workflow**，输入 `/data/metis-ai-cloud/releases/` 中已有的完整 Commit，并在 confirmation 输入 `ROLLBACK`。

回滚只切换应用 release，保留 shared PostgreSQL、Redis 和 app-data。涉及数据库 migration 的版本仍必须先备份数据库并单独评估降级兼容；当前没有 BytePlus 云盘快照。

已完成的真实闭环：

- 首次发布：Deploy Run `32558545994`；
- 历史 release 回滚：Rollback Run `32559285305`；
- 再次部署恢复：Deploy Run `32559331290`。

三次运行均已成功；再次部署后 PostgreSQL 与 Redis 容器未重建，持久化挂载保持不变。

## 日常只读检查

以下命令不读取 Secret 内容：

```bash
ssh ECS-RI4m
sudo -u github-runner sudo -n /usr/local/sbin/metis-ai-cloud-release status
readlink -f /data/metis-ai-cloud/current
docker ps --filter name=metis-ai-cloud \
  --format '{{.Names}} | {{.Status}}'
curl -fsS --max-time 10 http://127.0.0.1:3000/api/status
curl -fsS --max-time 15 https://many-models.metisdata.ai/api/status
```

GitHub 侧检查：

```bash
gh run list --workflow deploy-byteplus.yml --limit 5
gh run list --workflow rollback-byteplus.yml --limit 5
```

验收至少包括：目标 Commit、Workflow 终态、`current` 指针、三个容器健康、PostgreSQL / Redis 持久化未被替换，以及公网 HTTPS。Push 成功、镜像构建成功或容器 `Up` 均不能单独代表部署成功。

## Singapore Local Model 运行边界

当前已完成闭环验收的自有模型是 LM Studio `0.4.21` 提供的 `google/gemma-4-31b`。平台使用 OpenAI 类型 Channel，经 Tailscale 固定私网地址访问 LM Studio；Channel Credential 只保存在平台数据库中，不进入本文、Git 或运维输出。

已验证的最小业务闭环包括：

- Playground 实际对话；
- 公网 `/v1/chat/completions` 非流式与 Streaming；
- prompt、completion、total 与 reasoning token Usage；
- Token、用户余额与日志三方 Billing 一致；
- 限模型 Token 拒绝未授权模型且不计费；
- LM Studio 停服时返回上游错误、记录零 quota 失败日志，恢复后无需修改 Channel。

日常只读网络检查不需要读取 Provider Secret：

```bash
systemctl is-active tailscaled
tailscale ping --timeout=5s -c 1 100.85.112.45
timeout 5 bash -c '</dev/tcp/100.85.112.45/1234'
ip route show default
tailscale debug prefs
```

预期 `tailscaled` 为 active、peer 可达、1234 端口开放、默认路由仍为 eth0，且 `CorpDNS=false`、`RouteAll=false`、无 exit node。端口或模型调用失败时，先区分 Windows LM Studio、Tailscale peer、平台 Channel 和公网入口；不得通过停用 Tailscale、修改默认路由或输出 Credential 进行诊断。

当前 Channel 还列出 `qwen/qwen3.6-35b-a3b`，但该模型未在本轮完成标准 API、Streaming、Usage / Billing 与故障恢复验收。文档和演示不得把“Channel 中已配置”描述为“模型已验证”。40–52 ms 的 peer 延迟仅是连通性快照，不是 Serving Benchmark 结论。

## Tailscale 与 DNS 共存边界

BytePlus DHCP 下发的 DNS 位于 `100.64.0.0/10`，与 Tailscale anti-spoof 规则发生地址段冲突。当前已验证的共存配置是：

- `tailscaled` 保持 active；
- `tailscale set --accept-dns=false`；
- `/etc/netplan/90-metis-tailscale-dns.yaml` 禁用 eth0 DHCP DNS，并配置不位于 `100.64.0.0/10` 的递归 DNS；
- `/etc/resolv.conf` 由 `systemd-resolved` 管理；
- 默认路由仍通过 eth0，不启用 Tailscale exit node 或 subnet route。

该配置由 Singapore Local Model 网络任务负责维护。部署任务不得为了恢复 Runner 而停用 Tailscale、修改默认路由或直接套用旧的 `/etc/resolv.conf` 备份。Runner 离线时先只读检查：

```bash
getent ahostsv4 github.com
getent ahostsv4 tokenghub.actions.githubusercontent.com
getent ahostsv4 ghcr.io
systemctl is-active tailscaled
systemctl --type=service --state=running | grep actions.runner
```

当前 DNS 使用公共递归解析器。若后续有企业 DNS 或合规要求，应替换为 ECS 可达且不位于 `100.64.0.0/10` 的公司递归 DNS，并同时回归 GitHub Runner 与新加坡模型链路。

## Secret、备份与回滚边界

- PostgreSQL、Redis、Session、Provider / Model 凭据只存在于 ECS root-only Secret 文件或应用数据库中；不得通过 GitHub Environment、Workflow 参数、文档、日志或聊天传递。
- GitHub `GITHUB_TOKEN` 仅用于当次 GHCR 登录，经 stdin 进入受限发布入口，并使用临时 Docker config。
- 当前没有 BytePlus 系统盘或数据盘快照，这是 Demo 阶段明确接受的成本取舍。
- release 回滚只覆盖应用镜像和 Compose release，不回滚 `/data/metis-ai-cloud/shared/` 数据。
- 涉及数据库 migration、数据破坏或跨版本不兼容时，历史 release 不能替代数据库备份；必须先制定单独的数据恢复方案。

## 线路完成标准

截至 2026-08-23，本部署线路已完成：固定 Commit 镜像、隔离运行目录、root-only Secret、PostgreSQL / Redis 持久化、Cloudflare HTTPS、登录会话、容器重建恢复、受限 Self-hosted Runner、自动发布、真实回滚和再次部署恢复。Singapore Gemma Provider、标准 API、Usage / Billing 与停服恢复也已完成跨线路验收；后续 Branding、Benchmark、Routing 和其他模型验收不属于本基础设施线路的未完成项。
