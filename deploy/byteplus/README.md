# BytePlus ECS 部署基线

本目录用于把当前 fork 的固定 Commit 镜像部署到 BytePlus ECS。目标是 Demo / PoC 运行基线，不替代 Production 高可用设计。

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

## 启动与验证顺序

1. 构建固定 Commit 的 `linux/amd64` 镜像，导出归档并计算 SHA-256。
2. 在 ECS 创建隔离目录和 root-only Secret，再上传并校验 release。
3. 加载镜像，以 release 内 `.release.env` 指定完整镜像标签。
4. 运行 `docker compose --env-file .release.env -f compose.yml up -d`。
5. 先在 ECS 验证 `http://127.0.0.1:3000/api/status`，再通过 SSH port forwarding 完成人工管理员初始化。
6. 验证容器重启和 PostgreSQL 持久化后，才在既有 Cloudflare Tunnel 新增 `many-models.metisdata.ai -> http://127.0.0.1:3000`。

不得把命令已执行等同于部署成功；运行态以健康接口、容器状态、持久化探针和公网 HTTPS 的实际结果为准。

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

部署：打开 **Actions → Deploy BytePlus ECS → Run workflow**，输入要部署的 branch、tag 或完整 Commit。Workflow 只有在 GitHub-hosted 验证、镜像构建、ECS 本机健康检查和公网 HTTPS 检查全部完成后才标记成功。

回滚：打开 **Actions → Roll back BytePlus ECS → Run workflow**，输入 `/data/metis-ai-cloud/releases/` 中已有的完整 Commit，并在 confirmation 输入 `ROLLBACK`。

回滚只切换应用 release，保留 shared PostgreSQL、Redis 和 app-data。涉及数据库 migration 的版本仍必须先备份数据库并单独评估降级兼容；当前没有 BytePlus 云盘快照。
