# GitHub Actions BytePlus 部署与回滚设计

## 目标

为 `metis-ai-cloud` 建立人工触发、可审计且不把 ECS SSH Key 或应用 Secret 放入 GitHub 的部署与回滚流程。

## 已确认架构

```text
GitHub-hosted Runner
  ├─ 后端 / 前端验证
  └─ 构建 linux/amd64 镜像并推送 GHCR
                  ↓ image digest
ECS Self-hosted Runner
  └─ sudo 调用 root-owned 发布入口
       ├─ 拉取固定 digest
       ├─ 创建 immutable release
       ├─ Docker Compose 重建与健康检查
       ├─ 原子切换 current
       └─ 回滚到已有 release
```

ECS 继续复用 Linux 账户 `github-runner`，但为本仓库注册独立 Runner 实例、工作目录、systemd service 与 labels。现有 xy-stock Runner、`xy-stock-release` 和 sudo 权限不修改。

## 权限与 Secret 边界

- GitHub-hosted Runner 使用 job 级短期 `GITHUB_TOKEN` 向本仓库关联的 GHCR package 推送镜像。
- ECS Runner 不持有 SSH Private Key，也不加入 `docker` 组。
- ECS Runner 只能通过 sudo 调用 `/usr/local/sbin/metis-ai-cloud-release`。
- GHCR token 仅通过 stdin 进入发布入口；发布入口使用临时 `DOCKER_CONFIG`，结束时清理，不把 token 写入 release 或日志。
- 数据库、Redis、Session 与 Provider Secret 继续只存在于 `/etc/metis-ai-cloud/`，Workflow 不读取这些文件。
- root-owned Compose 模板安装到 `/usr/local/lib/metis-ai-cloud/compose.yml`，Runner checkout 不能直接替换生产 Compose。

## Workflow

### Deploy BytePlus ECS

人工输入要部署的 Git ref。GitHub-hosted job checkout 并解析完整 commit，执行项目验证，构建 `linux/amd64` 镜像并推送：

```text
ghcr.io/metis-data-holding/metis-ai-cloud:<full-commit>
```

部署 job 只把完整 commit、GHCR digest、GitHub actor 和 stdin token 传给受限发布入口。发布入口校验仓库、digest、OCI revision 和架构，健康后才切换 `current`。

### Rollback BytePlus ECS

人工输入已有完整 commit，并输入 `ROLLBACK` 二次确认。发布入口只允许激活 `/data/metis-ai-cloud/releases/<commit>` 中已经存在且结构有效的 release；不回滚或删除 shared PostgreSQL、Redis、app-data。

## 失败与回滚

- 新版本健康检查失败时，`current` 不切换，并使用旧 release Compose 恢复旧容器。
- 公网 HTTPS 检查在发布入口完成本机健康检查后由 Workflow 执行；Cloudflare 短暂异常只使 Workflow 失败，不删除 release 或 shared 数据。
- 数据库 migration 仍需在未来发布前单独备份和评估降级兼容；本设计不假设代码回滚能够回滚 schema。

## 非目标

- 不自动部署普通 Push 或 Pull Request。
- 不管理 Cloudflare route、安全组或应用 Secret。
- 不把现有 upstream DockerHub Workflow 改造成项目部署入口。
- 不创建 Kubernetes、远程 SSH Action 或通用 root shell。

## 验收

- 发布入口的本地隔离测试覆盖参数校验、成功部署、失败恢复与已有 release 回滚。
- `bash -n`、`shellcheck` 与 `actionlint` 通过。
- Compose 展开验证通过。
- 变更中无真实 Secret、Private Key、镜像归档或运行日志。
- 外部启用前仍需：在 GitHub 注册独立 ECS Runner、创建 `byteplus-demo` Environment、在 ECS 安装 root-owned 资产，并把 Workflow 合入默认分支。
