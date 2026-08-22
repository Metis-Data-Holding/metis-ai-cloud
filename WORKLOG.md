# Metis AI Cloud 工作日志

本文档按日期记录项目已完成的关键工作。保持简洁，不记录完整执行过程、测试报告、Git 状态、当前 TODO 或 Secret。当前状态见 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)，重要决策见 `docs/DECISIONS.md`。

## 2026-08-21

### Step 0 — 建立 AI 开发协作与上下文基础设施

- 建立根目录 `AGENTS.md`。
- 建立 `docs/PROJECT_CONTEXT.md`。
- 建立 `docs/CURRENT_STATE.md`。
- 建立根目录 `WORKLOG.md`。
- 建立 `docs/DECISIONS.md`。
- 完成 `.env.example`、`.gitignore` 与 Secrets 基础检查。

**备注**

- Step 0 基础设施已完成。
- 当前代码尚未经过本轮构建、部署和运行态验证，因此可运行 Deployment Baseline 仍待建立。

## 2026-08-22

### BytePlus ECS 原版部署 baseline

- 在任务分支建立 BytePlus 专用 Compose 与无 Secret 配置模板，应用、PostgreSQL、Redis 使用独立 project、目录和持久化路径。
- 以 commit `b3ef3d4fe815b984160faa865c22df21fe272c62` 的精确源码在 ECS 原生构建 `linux/amd64` 镜像，并校验镜像架构、OCI revision 与源码归档 SHA-256。
- 在 `/data/metis-ai-cloud` 建立 immutable release、shared 数据目录与 `current` 链接；真实 Secret 仅在 ECS 的 `/etc/metis-ai-cloud` root-only 文件中生成和保存。
- app、PostgreSQL、Redis 启动并通过健康检查；应用仅绑定 `127.0.0.1:3000`，数据库与 Redis 不发布宿主端口。
- 管理员初始化完成，选择对外营业模式。
- 完成三服务重启，以及 app、PostgreSQL、Redis 分别删除重建后的运行态与持久化验证；非敏感 Redis 探针验证后已删除。
- 用户明确接受本次不创建 BytePlus 系统盘或数据盘快照；回滚可使用历史完整 release，但 shared 数据无部署前云盘快照保护。

### Cloudflare 公网入口

- 复用并改名为 `byteplus-hk-RI4m` 的健康 Tunnel，保留既有 `xy-stock.metisdata.ai -> http://127.0.0.1:8787` route。
- 新增 `many-models.metisdata.ai -> http://127.0.0.1:3000` Published application route，无需开放 ECS 入站 3000、80 或 443。
- 验证 DNS 经 Cloudflare 生效、Universal SSL Active、首页与 `/api/status` 返回 HTTP 200，API 返回 `success:true` 且已完成初始化，Cloudflare 响应为动态不缓存。
- 浏览器确认中文首页、导航和登录入口正常渲染，未发现 console warning/error；用户随后通过公网 HTTPS 确认管理员登录、刷新保持会话与退出均正常。
- 验证既有 `xy-stock` systemd 服务、loopback HTTP 与公网入口仍可达；Tunnel 进程 active，验收时重启计数为 0。

**未完成**

- ECS → Singapore Local Model 网络链路、Provider 接入、真实 Streaming、Usage / Billing、Branding、Serving Benchmark 与 Cost-aware Routing 尚未验证。

### GitHub Actions 发布与回滚基线

- 采用 GitHub-hosted Runner 验证并构建 GHCR `linux/amd64` 镜像、ECS Self-hosted Runner 仅执行受限部署与回滚的两段式方案。
- 复用 ECS Linux 账户 `github-runner`，但为本仓库设计独立 Runner 实例、工作目录、labels 和 `/usr/local/sbin/metis-ai-cloud-release` sudo 入口；不修改 xy-stock Runner。
- 建立人工部署与回滚 Workflow、root-owned 发布入口、sudoers 和安装脚本；GHCR token 只经 stdin 传入临时 Docker 配置，应用 Secret 不进入 GitHub。
- 发布入口隔离测试覆盖无效参数、固定 digest 部署、健康失败恢复和已有 release 回滚；`bash -n`、ShellCheck 与 actionlint 已通过。

### GitHub Actions 首次远程发布

- 将 Deploy 与 Rollback Workflow 合入并推送 `main`、`develop`，建立 `byteplus-demo` Environment。
- 在复用的 `github-runner` Linux 账户下注册独立 Runner `byteplus-hk-metis-ai-cloud-01`，使用独立目录、systemd service 与 `byteplus-hk`、`metis-ai-cloud`、`deploy` labels；既有 xy-stock Runner 保持 active。
- 安装 root-owned 发布入口、Compose 模板和受限 sudoers；`github-runner` 未加入 Docker group，应用 Secret 继续只存在于 ECS。
- 首次 Deploy Workflow Run `32558545994` 使用 `main`，完成后端与前端验证、GHCR 固定 digest `linux/amd64` 镜像构建和推送、ECS 受限激活及公网 HTTPS 检查。
- 独立验收确认 `current` 指向 commit `9cc0479894985681e4c11b3476df02ce4f8e5cd8`，镜像架构与 OCI revision 匹配，app、PostgreSQL、Redis healthy；PostgreSQL 与 Redis 沿用部署前容器且重启计数为 0。

### GitHub Actions 真实回滚与恢复

- Rollback Workflow Run `32559285305` 成功将 `current` 切换至历史 release `b3ef3d4fe815b984160faa865c22df21fe272c62`；应用健康，PostgreSQL 与 Redis 容器未重建。
- 随后的 Deploy Workflow Run `32559331290` 在 ECS Runner 网络恢复后自动继续并成功完成，将 `current` 恢复至 `b740f5f52f8c14290b62d5b4351cf64ce0ab97db`。
- 独立验收确认 ECS Runner Online，GitHub、Actions Token 与 GHCR 域名解析正常；app、PostgreSQL、Redis healthy，PostgreSQL 与 Redis 容器 ID 与回滚前一致，持久化挂载未变。
- `many-models.metisdata.ai` 与 `xy-stock.metisdata.ai` 公网访问均通过；此次网络故障与恢复由 Tailscale 接入任务负责处理，本部署任务未继续修改 ECS 网络。

### BytePlus 基础设施线路收尾

- 将已验证的当前拓扑、ECS 目录、Cloudflare Tunnel、GitHub Actions 日常发布 / 回滚、只读巡检、Tailscale 与 DNS 共存边界、Secret 与无云盘快照风险统一整理到基础设施文档。
- BytePlus 部署线路完成固定 Commit 发布、持久化、HTTPS、登录会话、容器重建恢复、真实回滚与再次部署恢复闭环；后续工作转入 Local Model Provider、Usage / Billing、Branding 与 Benchmark。
