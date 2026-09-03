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

## 2026-08-23

### Singapore Local Model Provider 与 Billing 闭环

- 通过 Tailscale 将 ECS 与 Windows LM Studio `0.4.21` 连接，完成 `google/gemma-4-31b` OpenAI-compatible Channel 配置；Provider Credential 仅保存在平台中。
- 保持 `tailscaled` active，关闭 Tailscale DNS 接管，并以 netplan 配置可达递归 DNS，恢复 GitHub、Actions Token、GHCR 与 Self-hosted Runner，同时保留模型私网链路和 eth0 默认路由。
- 用户通过 Playground 完成真实对话；公网标准 API 的非流式、Streaming、`[DONE]`、Usage 与 reasoning token 均验证通过。
- 使用限模型测试 Token 验证权限边界、Token / 用户余额 / 日志 Billing 一致性；未授权模型被拒绝且不计费。
- 完成 LM Studio 停服与恢复回归：停服返回上游错误并记录零 quota 失败日志，恢复后原 Channel 无需修改即可继续调用。
- 运行态复核确认 app、PostgreSQL、Redis、Tailscale、Self-hosted Runner、GitHub/GHCR DNS 和公网状态正常。

## 2026-08-24

### Demo 业务闭环与 Serving Benchmark

- 完成普通用户注册登录、Playground、API Key、模型权限、Streaming、Usage 与计费的公网闭环验证。
- 完成 Gemma 4 31B 的短时容量阶梯与并发 4、30 分钟稳定性测试；稳定性测试记录 1308 个成功请求、0 个请求错误。
- 完成 Gemma 与 DeepSeek V4 Flash 的并发 1 体验参考，并核对 many-models 与 DeepSeek 官方 Token 聚合结果。
- 将 LM Studio 并行预测槽位从 4 调至 6 后完成并发 4、5、6 参数实验；72 个请求全部成功。槽位放宽提高约 9.9% 总吞吐，但 TTFT P50 增加约 72.9%，不改变交互业务优先使用并发 4 的建议。
- 使用 GuideLLM、Windows `nvidia-smi`、LM Studio 日志及平台调用记录形成 Markdown 与 Lieflat HTML 测试报告；原始结果和 GPU CSV 仅保存在未跟踪本地目录。
- 完成 New API 同优先级加权路由与 Model Mapping 功能测试：20 个非流式请求中 Gemma / DeepSeek 实际观察为 13 / 7，30 个混合 Streaming 请求全部成功；后台逐渠道日志与流式输出上限口径仍待补证。

## 2026-08-26

### 固定延迟 Mock 网关容量测试

- 在 ECS 应用内网部署无宿主端口的临时 Mock Provider，从 macOS 使用 k6 经 Cloudflare 和 many-models 发起真实公网请求，隔离排除真实模型与 GPU 影响。
- 完成非流式与 Streaming 固定 VU 阶梯：非流式 100 VU、Streaming 25 VU 为短时最后通过档；200 / 50 VU 分别触发 P95 延迟停止线。
- 完成 Streaming 20 VU、30 分钟稳定性测试：42779 个请求中 42773 个 2xx、6 个 HTTP 503，错误率 0.014%；核心容器全程 healthy、重启数为 0、无 OOM 或内存持续增长。
- 修正 10 秒小样本延迟误触发：错误与协议停止线保持 10 秒，延迟停止线改为 30 秒观察窗口；正式汇总增加 P99 供后续运行采集。
- 更新 Markdown 与 Lieflat HTML 报告，明确区分真实模型并发、网关 VU、用户数与 Production SLA。

## 2026-09-01

### BytePlus Dreamina Seedance 任务计费适配

- 基于同步后的 upstream 任务插件与用量表达式计费体系，为 Doubao Video 插件补充 Dreamina Seedance 2.0 与 2.0 Fast 模型声明。
- BytePlus 请求包含参考视频时，提交阶段按官方输入视频总时长上限 15 秒保守预扣；完成阶段继续以 `usage.completion_tokens` 为实际用量进行差额结算。
- 增加模型路由、预扣估算、完成 usage 和失败终态回归测试；相关定向测试与仓库 `make test` 通过。
- 当前仅完成本地功能分支开发，尚未合并、部署或执行真实 BytePlus Provider 计费对账；模型价格矩阵仍需管理员在部署后配置。

### Playground Seedance 文生视频入口

- 在 Playground 增加聊天 / 视频生成模式切换，并提供模型与分组、提示词、时长、分辨率和画面比例配置；Seedance 2.0 Fast 仅展示已支持的 480p / 720p。
- 新增登录态专用 `/pg/videos` 代理链，复用既有视频任务插件的提交、状态查询和制品下载能力，不向浏览器暴露用户 API Key。
- 前端以异步任务方式轮询状态，成功后通过带登录态的 Blob 请求完成页面预览和本地下载；首版只支持文生视频，不包含素材上传、取消与历史任务管理。
- 增加视频模型协议筛选、Playground 鉴权与路由、表单约束、轮询和模式切换测试，并补齐 7 种前端语言。
- 本轮为本地功能分支实现；尚未合并、部署或使用真实 BytePlus Provider 验收。
## 2026-09-02

### GitHub Actions 重复部署修复

- 定位同一 commit 重跑时镜像 manifest digest 变化与不可变 release 绑定冲突，导致部署阶段拒绝覆盖既有镜像。
- 部署 Workflow 优先复用同 commit 的已有 release，并保持对 ECS 当前受限发布命令的兼容；发布脚本同步支持直接重复部署复用首个已验证镜像。
- 增加同 commit、不同 digest 的回归测试；发布脚本测试、Bash 语法、ShellCheck、actionlint 与 diff 检查通过。

### Playground Seedance 参考生成与首尾帧输入

- 在既有视频 Playground 中增加“参考生成 / 首尾帧”分段模式，并根据模式切换参考图片、参考视频 URL、首帧和可选尾帧输入。
- 参考图片与首尾帧使用 BytePlus 支持的 Base64 内容；最多 3 个参考视频使用公网 URL 或 `asset://` 素材 ID，避免提交上游不支持的本地视频 Base64。
- 按官方边界限制图片格式、单图大小、图片总大小和参考图数量；模式切换会清理隐藏素材，首尾帧模式要求首帧且允许省略尾帧与提示词。
- 补充前端请求、交互和边界回归测试，以及 Doubao 任务插件透传 `first_frame` / `last_frame` 角色的集成测试；合并后仍待部署和真实 Provider 验收。

### Playground 本地参考视频上传

- 为参考生成模式增加本地 MP4 / MOV 上传，单文件上限 80 MiB；浏览器校验单段 2～15 秒以及已知本地视频合计不超过 15 秒。
- 后端将文件暂存到 `/data/video-reference-uploads`，返回 50 小时有效的 HMAC 签名公网读取地址；读取接口支持 `GET`、`HEAD` 与 Range，上传接口仅接受 Dashboard 登录会话。
- 系统任务每小时清理超过 50 小时的正式文件及超过 1 小时的未完成上传文件；现有 ECS `/data` 持久化挂载可直接覆盖该目录，无需新增数据库字段或部署挂载。
- 后端全量测试、前端 449 项测试、TypeScript、前端生产构建及独立 `relaykit` 构建通过；尚未合并、部署或执行 BytePlus 拉取本地上传视频的真实验收。

### Playground 参考内容入口与首尾帧交互收敛

- 参考生成模式将参考图片和本地参考视频收敛到一个“添加参考内容”入口，支持图片与 MP4 / MOV 混合多选；前端移除参考视频 URL 输入和添加按钮，后端 URL / `asset://` 协议保持不变。
- 首尾帧区域标题统一为“首尾帧”，两个帧槽之间增加可访问的双向交换按钮；仅在两帧齐全时允许交换，不重新读取或上传文件。
- 新增混合多文件选择、URL 控件隐藏、首尾帧交换及提交参数回归测试；前端 450 项测试、TypeScript、受影响文件 lint、格式检查和生产构建通过。全仓库 lint 仍存在本轮改动之外的既有错误。

## 2026-09-03

### Playground 视频组合输入框

- 将提示词、参考内容、生成模式、参数摘要、模型选择和提交操作收敛为统一组合输入框；空状态居中展示，首次提交后任务结果置于上方、输入框固定在内容区底部。
- 生成模式改为下拉选择，视频参数通过桌面 Popover / 移动端 Sheet 配置画面比例、分辨率、5～15 秒时长、输出声音和 1～4 条生成数量；右上角支持将输入区域扩展为默认高度的三倍。
- 生成数量按独立异步任务顺序提交；后续任务提交失败时保留此前成功任务，并沿用每个任务独立轮询、预览和下载链路。
- 补齐 7 种前端语言并增加组合输入框、批量提交和部分失败回归测试；前端 65 个测试文件共 457 项测试、TypeScript、受影响文件 lint / format 及生产构建通过。
