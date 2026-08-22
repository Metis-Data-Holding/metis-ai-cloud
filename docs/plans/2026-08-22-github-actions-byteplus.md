# GitHub Actions BytePlus Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立由 GitHub-hosted Runner 构建 GHCR 镜像、ECS Self-hosted Runner 通过受限 sudo 发布入口部署和回滚的自动化基线。

**Architecture:** GitHub-hosted job 执行验证并推送固定 commit 的 `linux/amd64` 镜像；ECS job 不 checkout 或执行目标 ref 的代码，只把经过校验的 commit 与 digest 交给 root-owned wrapper。应用 Secret 与 shared 数据继续只留在 ECS。

**Tech Stack:** GitHub Actions、GHCR、Docker Buildx、Docker Compose、Bash、actionlint、shellcheck、BytePlus ECS。

---

### Task 1: 发布入口失败测试

**Files:**
- Create: `deploy/byteplus/test-metis-ai-cloud-release.sh`

1. 写隔离临时目录和 fake Docker/Curl 命令。
2. 写无效 commit、成功 deploy、健康失败恢复和 rollback 测试。
3. 运行测试并确认因发布入口不存在而失败。

### Task 2: 受限发布入口与安装资产

**Files:**
- Create: `deploy/byteplus/metis-ai-cloud-release`
- Create: `deploy/byteplus/metis-ai-cloud-deploy.sudoers`
- Create: `deploy/byteplus/install-actions-deploy.sh`

1. 实现完整 commit、GHCR digest、OCI revision 和 release 结构校验。
2. 实现临时 GHCR 登录、镜像拉取、immutable release、Compose 健康检查和原子 `current` 切换。
3. 实现失败恢复与已有 release 回滚，不删除 shared 数据。
4. 安装脚本仅安装 root-owned wrapper、Compose 模板和 sudoers，不注册 Runner、不修改 Secret。
5. 运行 Task 1 测试并确认通过。

### Task 3: 部署与回滚 Workflow

**Files:**
- Create: `.github/workflows/deploy-byteplus.yml`
- Create: `.github/workflows/rollback-byteplus.yml`
- Create: `.github/actionlint.yaml`

1. Deploy Workflow 使用 `workflow_dispatch` 输入 Git ref。
2. GitHub-hosted job 执行后端与前端验证、构建并推送固定 `linux/amd64` GHCR digest。
3. ECS job 使用专用 labels 与 `byteplus-demo` Environment，通过 stdin 传递短期 token 并调用受限 wrapper。
4. Rollback Workflow 校验完整 commit 与 `ROLLBACK` 二次确认，只激活已有 release。

### Task 4: 文档与状态

**Files:**
- Modify: `deploy/byteplus/README.md`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `WORKLOG.md`
- Modify: `docs/DECISIONS.md`

1. 记录 Runner 注册、ECS 安装、GitHub Environment 和首次启用步骤。
2. 明确 Workflow 已构建不等于已合入默认分支、Runner 已注册或远程部署已执行。
3. 记录复用 `github-runner` 账户但隔离 Runner 实例和 sudo 入口的决定。

### Task 5: 验证与提交

1. 运行发布入口隔离测试、`bash -n`、`shellcheck`、`actionlint`。
2. 运行 ECS Compose 展开验证和高置信 Secret 扫描。
3. 运行 `git diff --check`，核对变更清单。
4. 分别提交实现和文档；不 Push、Merge 或注册外部资源。
