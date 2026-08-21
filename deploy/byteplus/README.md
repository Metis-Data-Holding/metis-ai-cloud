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
/etc/metis-ai-cloud/redis.conf   root:root 0600
```

`app.env` 中的 PostgreSQL 和 Redis 密码必须分别与 `postgres.env`、`redis.conf` 保持一致。`TRUSTED_PROXIES` 应填写该 Compose project 实际创建的 bridge network CIDR，不能照抄示例。

## 启动与验证顺序

1. 构建固定 Commit 的 `linux/amd64` 镜像，导出归档并计算 SHA-256。
2. 在 ECS 创建隔离目录和 root-only Secret，再上传并校验 release。
3. 加载镜像，以 release 内 `.release.env` 指定完整镜像标签。
4. 运行 `docker compose --env-file .release.env -f compose.yml up -d`。
5. 先在 ECS 验证 `http://127.0.0.1:3000/api/status`，再通过 SSH port forwarding 完成人工管理员初始化。
6. 验证容器重启和 PostgreSQL 持久化后，才在既有 Cloudflare Tunnel 新增 `many-models.metisdata.ai -> http://127.0.0.1:3000`。

不得把命令已执行等同于部署成功；运行态以健康接口、容器状态、持久化探针和公网 HTTPS 的实际结果为准。
