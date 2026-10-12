# Metis AI Cloud 工作日志

本文档按日期记录项目已完成的关键工作。保持简洁，不记录完整执行过程、测试报告、Git 状态、当前 TODO 或 Secret。当前状态见 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)，重要决策见 `docs/DECISIONS.md`。

## 2026-10-11

### 将 main 同步到 develop 并完成部署验收

- 同步前 `main=f6fb620c8bcadbf02dbe47a4ca0cb10ee0e4cca4`、`develop=bde5e68c7834cbd386953fcb61aecbccb368dab3`，双方独有提交为 10 / 19。按 main 到 develop 的方向合并，保留 develop 的 H3、Wan、内部超分和 task plugin 定制。
- 两个冲突按语义合并：`docs/CURRENT_STATE.md` 保留 develop 历史状态并纳入本轮上游记录；`relay/channel/task/jsplugin/adaptor.go` 同时保留 Wan 源文件获取、轮询配置快照、重定向与超时限制，以及上游调用上下文、受限 `utils.fetch`、允许域名和 channel 级 TLS 配置。独立审查确认未丢失任一侧功能，未修改 License / attribution、部署配置或实际 Secret。
- 合并提交 `6d03c58d88a5ec2a694a0b075ad006aeecf24a81` 已推送 origin/develop。`make test`、三个 Go 模块 build / vet、`make build-web` 与前端五项检查通过；前端 193 文件 / 2312 项测试通过，lint 保留 21 个既有 warning。SQLite 3.50.4、MySQL 8.0.46、PostgreSQL 15.19 均完成真实性能指标、新建、生产版本升级和重复迁移验证，探针数据保留。
- 部署前为生产 PostgreSQL 保留 root-only、mode 0600 的 custom-format 备份 `/data/metis-ai-cloud/backups/pre-deploy-6d03c58d88a5ec2a694a0b075ad006aeecf24a81-20261011T1310+0800.dump`，并用 `pg_restore --list` 验证可读。应用 release 可独立回滚；数据库仅在事故决策后先恢复到独立数据库验证，再计划停机切换，应用回滚不等于数据库回滚。
- 使用固定 develop SHA 触发 Deploy Run `38113885477`，首次执行成功。独立 SSH 确认 ECS current 与镜像 OCI revision 均为目标 SHA，镜像 digest 为 `sha256:67f052750a14cafac8b7bdd5993c1be4ce0219e536ca734406e6d2d6d0195cf0`；app/PostgreSQL/Redis healthy、restart=0、OOM=false，持久目录 inode 未变，迁移失败日志为 0，本机与公网 HTTPS `/api/status` 均成功。
- 未执行真实 Provider 付费请求、支付、认证、计费结算或退款端到端验收；本部署结果记录后续仅更新文档，运行代码与已部署 SHA 保持一致。

### 保留 fork 视频能力并同步任务插件与性能指标上游变更

- 同步目标 `upstream/main@0f38a14a5` 的 9 个提交，合入任务插件受限 `utils.fetch`、Hailuo 签名文件获取、xAI 按输出分辨率结算、channel 级 TLS 跳过开关、近期性能指标历史、上传允许域名显示及主题修复。
- 4 个冲突按调用链语义合并：任务测试保留 fork 的视频超分私有交付回归并补入 Hailuo 获取测试；视频代理仅对可信同源任务插件请求保留例外，同时采用 channel 配置感知的 HTTP client；JavaScript 工具同时保留 Volc 签名导出与上游调用上下文；Doubao 保留 Dreamina 模型、2K 边界和参考视频 15 秒预扣，并接入 `duration=-1` 自动时长及最长时长预扣。
- 独立审查确认未丢失任一侧功能，未混入未跟踪文件，未修改 License / attribution、GitHub Actions、部署配置或实际 Secret。`make test`、前端五项、三个 Go 模块的独立 build / vet 均通过；前端全量复跑为 193 文件 / 2296 项通过，lint 保留 21 个既有 warning。
- 性能指标查询在 SQLite 3.50.4、MySQL 8.0.46、PostgreSQL 15.19 上通过真实数据库回归；三个数据库均完成新建、从生产 release 二进制升级及候选二进制重复启动的迁移幂等验证，探针数据保留。前端首次全量测试在未改动的焦点断言上出现 1 项偶发失败，单文件及全量新进程复跑均通过；单独运行的既有 service 测试因未初始化 `OptionMap` 在合并前后同样 panic，不影响全量 `make test`。
- 该上游同步随后已完成 develop 合并、部署和生产运行态核验；真实 Provider / 支付 / 认证 / 计费端到端仍未执行。

## 2026-10-10

### 将 main 同步到 develop 并完成部署验收

- 同步前 `main=4b3f1e52277f67a288dd7fbdf2efa4cedba1e67c`、`develop=451756f7b8439f2196eac54b0d72487f19d3a908`，双方独有提交为 4 / 17。按稳定分支到集成分支的方向将 main 合入 develop，不反向改动 main；保留 develop 的 H3、Wan、内部超分和 task plugin 定制。
- 唯一内容冲突为 `docs/CURRENT_STATE.md`，保留 develop 的历史部署与视频能力记录，并加入 main 的最新 upstream 同步状态。15 个自动合并文件经独立三方语义审查，确认结构化消息、Responses 转换、渠道凭据、multipart、CAS、结算退款及认证边界未丢失；未修改 License / attribution、部署配置或实际 Secret。
- 合并提交 `3f8ea27df6e3efeb432dc1ea28153d3e17c0f471` 已推送 origin/develop。`make test`、三个 Go 模块独立 build / vet、`make build-web` 及前端 typecheck/test/lint/format:check/build 通过；前端 193 文件 / 2301 项测试通过，lint 保留 21 个既有 warning。未改变数据库 schema、ORM / driver 或 migration，不触发三数据库矩阵。
- 使用 develop 工作流定义和上述完整 SHA 触发 Deploy Run `38018944811`；首次执行成功，总耗时 14m44s，云端后端/前端验证、linux/amd64 镜像发布、ECS 激活与公网 HTTPS 检查全部通过。
- 独立 SSH 核验 ECS current 与镜像 OCI revision 均为目标 SHA，镜像 digest 为 `sha256:e9b402c8aa2d3846e6f15e81454bee61c6bf5d75d06c6f7cd64eb4595149272a`；app/PostgreSQL/Redis healthy、restart=0、OOM=false，本机 `/api/status` 成功。公网 HTTPS 返回 HTTP 200、TLS 校验成功且 `success=true`。未执行真实 Provider、付费计费、退款、登录或视频生成端到端验收；本验收记录仅更新文档，运行代码与已部署 SHA 一致。

### 保留 fork 定制并同步结构化国际化上游变更

- 同步目标 `upstream/main@1d4328e97` 的 3 个提交，合入 Responses 转换尾部 assistant 文本修复、前后端结构化国际化消息和 relaykit README 更新。
- 13 个冲突按调用链和三方内容语义合并：保留 fork 的加固 options 主键迁移、视频超分轮询与清理、task plugin 多阶段 multipart 准备；七种前端语言保留双方独有 key，并接入统一服务端消息解析。
- 独立审查确认未丢失任一侧功能，未混入未跟踪文件，未修改 License / attribution、GitHub Actions、部署配置或实际 Secret。加固迁移文件与同步前 `main` 完全一致，其他 migration 差异只包装日志文本，不改变数据库行为，因此未执行三数据库矩阵。
- `make test`、主模块与 relaykit 独立构建、前端五项检查均通过；前端 193 文件 / 2285 项测试通过，lint 保留 21 个既有 warning。未验证远端 CI、部署、生产运行态或真实 Provider / 支付 / 认证端到端。

## 2026-10-09

### 语义合并任务插件冲突并同步上游

- 同步目标 `upstream/main@7aa3531ef` 的 8 个提交，合入任务插件 JSON 顺序保持、Gemini Grounding 计费、参数覆盖正则条件和 moejs PGO 更新。
- `relay/channel/task/jsplugin` 冲突按调用链语义合并：保留 fork 的单个/多个准备请求与 multipart 文件复用，并为准备请求递归保留 `json-order@1`；各请求使用自身重建后的 multipart boundary，避免复用客户端旧 boundary。
- 独立审查确认未丢失任一侧功能，未修改 License / attribution、数据库 schema / migration 或未跟踪文件。`make test`、主模块与 relaykit 独立构建、前端五项检查均通过；前端 191 文件 / 2277 项测试通过，lint 仍有 21 个既有 warning。
- 未涉及数据库行为，未执行三数据库矩阵；未验证远端 CI、跨平台 PGO 发布、部署或真实 Provider / 计费 / 退款。

### 将 main 同步到 develop

- 以 `develop@37fdce032` 为基线合入 `main@46576af00`，保留 develop 的 H3 参考音频、Wan / OpenRouter、内部超分与多阶段 task plugin 请求，并吸收 main 的最新 upstream 更新。
- 唯一文本冲突为当前状态文档，按快照语义保留 develop 的部署和 Wan 状态并采用 main 的最新 upstream 状态；task plugin 自动合并经独立三方审查，确认双方功能和 multipart boundary 语义完整。
- 本地 `make test`、三 Go 模块 build / vet、前端五项检查（191 文件 / 2293 项测试）与生产 Docker 构建通过。未改变数据库 schema、ORM / driver 或 migration，不触发三数据库矩阵。
- 合并提交 `e5a117a081e23334efefc842f32ac2bf1b42a56d` 已推送 origin/develop，并以 develop 的固定完整 SHA 触发 Deploy Run `37878193057`。首次执行成功，云端后端/前端验证、linux/amd64 镜像发布、ECS 激活和公网 HTTPS 检查全部通过。
- 独立 SSH 核验 ECS current 和镜像 OCI revision 均为目标 SHA，镜像 digest 为 `sha256:c1ed9817de49eb4299b713233ab39508c91f6ab456b154dcc710391ae169253f`；app/PostgreSQL/Redis healthy、restart=0、OOM=false，公网 `/api/status` 返回 HTTP 200 且 `success=true`。未执行真实 Provider、付费计费、退款或登录端到端验收；本验收记录仅更新文档，运行代码与已部署 SHA 一致。

## 2026-10-08

### 修复插件清单漏合并并同步上游

- 同步目标 `upstream/main@45094bdf4`，保留 fork 的 MiniMax H3 接入并合入上游 xAI、tokenkit 和兼容修复。仅在局部插件测试清单补入 `xai`，保留 H3 的 `openai_video` 特例与严格集合断言；定向测试从原有失败转为通过。
- `AGENTS.md` 冲突按语义合并：保留中文协作与安全规则，补齐 Go 1.26、tokenkit 职责边界和独立模块验证要求；未采用整文件 ours/theirs。
- 独立审查补齐两个新转换器标签的静态 i18n 键登记；七语言既有译文完整，在临时副本执行同步脚本后内容一致，未触碰仓库内未跟踪的旧报告。
- 本地必需验证通过：`make test`、前端五项（190 文件 / 2269 项测试）、三 Go 模块独立构建/vet、`make build-web` 与生产 Docker 构建。未改数据库行为；未进行部署或真实 Provider/计费/退款验收。额外插件 lint 通过，但全量插件格式检查报告既存 doubao 和上游 xai 格式问题，本次未做无关重排。

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

### Playground 参考素材堆叠与提示词引用

- 参考生成素材改为正方形堆叠预览：最后上传素材位于顶层，素材卡片显示“图片 N / 视频 N”，悬浮或键盘聚焦时展开为“参考内容入口 + 按上传顺序排列的素材”托盘。
- 图片与视频不再按类型重排，界面编号、提示词 `@图片N / @视频N` 与提交给 BytePlus 的 `metadata.content` 使用同一顺序；提示词输入 `@` 后可直接选择当前素材引用。
- 根据 BytePlus 官方限制保留分辨率条件：Seedance 2.0 仅参考视频时仍支持 1080p，加入参考图片后隐藏 1080p；Fast 模型继续限制为 480p / 720p。
- 前端 65 个测试文件共 460 项测试、TypeScript、受影响文件 lint / format、7 语言 i18n 同步及生产构建通过；本地浏览器因未登录只到达登录页，真实部署页面视觉仍需在发布后核对。

## 2026-09-04

### 同步 upstream/main 至 3a9f41ee8

- 合并 upstream/main 新增的 14 个提交，覆盖 Relay / RelayKit 转换完整性、任务插件与轮询、日志元数据权限隔离、会话鉴权缓存、ETag 和 Release 标签版本等变更。
- 冲突处理保留本仓库协作规范与视频能力，合并 `.gitignore` 规则；Doubao 任务插件版本递增至 `1.1.1`，同时保留本地 BytePlus / Dreamina 适配与 upstream 的未知任务状态处理；用量日志保留本地任务计费字段并采用 upstream 的 `admin_info.reject_reason` 安全边界。
- Go 全量测试、主模块与 `relaykit` 的 vet / build、前端 66 个测试文件共 464 项测试、TypeScript、受影响文件 lint / format、前端生产构建及 GitHub Actions 静态检查通过。
- MySQL / PostgreSQL 真实数据库回归未执行：upstream 新增的系统任务状态修复虽包含 SQLite 测试，但注释引用的 configured-databases 测试函数实际不存在；本次按同步边界不额外夹带本地补丁。
- 全仓前端 lint 与 format 仍存在同步前已有存量问题；本次变更文件没有新增 lint / format 违规。

## 2026-09-05

### MiniMax H3 文生视频代码接入

- 新增 `minimax-h3` Task Plugin，将 OpenAI Video 请求转换为新加坡 5090 上已验证的最小 ComfyUI H3 Base 工作流；支持提交、轮询、失败状态、视频制品代理及用量事实提取。
- 首阶段仅开放 `minimax-h3-fl2va` 纯文生视频，不接受参考素材；支持 768p、16:9 / 9:16 / 1:1 / 4:3 / 3:4、5～15 秒及原生同步音频开关。
- Playground 可识别 H3 视频模型，切换到 H3 时隐藏并清理参考素材与生成模式，提示词区使用纯文生视频文案，分辨率只显示 768p；Seedance 现有行为保持不变。
- 前端 TypeScript、72 个测试文件共 481 项测试、受影响文件 lint、格式检查及生产构建通过；全仓 lint 仍被本任务外的既有错误阻断。
- 当前只完成任务分支代码和本地自动化验证，尚未执行 5090 真实生成、管理员定价配置、部署或公网验收；渠道启用前还需确认 Tailscale / Windows Firewall 边界及模型许可证条件。

## 2026-09-06

### MiniMax H3 首帧图生视频接入

- 扩展 Task Plugin 请求描述符，允许插件声明一次受控的提交前请求；沿用渠道代理、超时和响应边界，不引入通用工作流管线。
- H3 插件接收一个 JPEG / PNG / WebP 首帧，先上传至 ComfyUI 临时输入目录，再在既有 H3 工作流中接入 `LoadImage`；纯文生视频请求保持原路径不变。
- Playground 复用现有视频关键帧卡片和生成模式选择；H3 首帧模式只展示首帧输入，要求提示词，并以 multipart 提交图片与参数。
- 插件与请求适配测试、前端 73 个测试文件共 484 项测试、TypeScript、受影响文件 lint / format 及生产构建通过；真实平台尚未部署，本记录不将 ComfyUI 直接生成等同于平台端到端验收。
- 用户已在 `develop` 公网环境完成 H3 首帧图生视频生成验收；本轮没有单独复核任务日志制品、实际计费或失败退款，因此这些边界继续保留为待验证。
- 修复首帧模式仍占用双关键帧宽度及窄窗口任务状态被长任务 ID 挤出的问题；首帧参考区按单卡收窄，任务卡允许收缩并在卡内换行任务 ID，保持现有组件和视觉风格不变。

### MiniMax H3 首尾帧图生视频接入

- 核对用户导出的 ComfyUI API Format JSON：两个 `LoadImage` 节点分别连接 `MiniMaxH3ImageToVideo` 的 `first_frame` 与 `last_frame`，确认当前 H3 工作流具备首尾帧输入契约。
- Playground 复用现有首尾帧双卡片、交换按钮和文件校验；H3 以 multipart 提交 `input_reference` 与可选 `input_last_frame`，继续要求首帧和提示词，纯文生及仅首帧请求保持兼容。
- Task Plugin 请求描述符在保留单个 `prepareRequest` 兼容性的基础上，支持最多两个顺序执行的 `prepareRequests`；任一图片预上传失败即终止主任务提交，两个临时文件分别接入 H3 工作流的首帧与尾帧节点。
- 生成模式菜单在选择文生视频或首尾帧后立即收起；未新增页面、依赖或说明性文案。
- H3 插件与 Task Plugin 适配测试通过；前端 73 个测试文件共 487 项测试、TypeScript、受影响文件 lint / format 及生产构建通过。
- 用户仅完成了 ComfyUI 直接首尾帧生成；平台代码仍待部署及真实端到端验收，不将本地自动化验证等同于公网生成、制品或计费验收。

### MiniMax H3 首尾帧生成公网验收

- Deploy Run `34038331884` 将 `develop` 的 `634659a5d320228849c460801662d7ce142084f0` 发布至 BytePlus ECS；现场复核确认该 release 正在运行，app、PostgreSQL 与 Redis 均为 healthy，公网 `/api/status` 返回成功。
- 用户通过公网 Playground 完成真实首尾帧视频任务，确认任务成功完成且生成结果可正常播放和下载。
- 本次没有核对有声生成、实际扣费对账或失败退款，因此不将这些能力记录为已验收。

## 2026-09-09

### MiniMax H3 参考内容生视频接入

- 根据远端 ComfyUI Ref2VA API Format 工作流扩展 `minimax-h3` Task Plugin：参考模式自动切换 Ref2VA checkpoint，支持最多 2 张 JPEG / PNG / WebP 参考图和 1 个不超过 64 MiB 的 MP4 / MOV 参考视频。
- 参考图片上传到 ComfyUI 临时输入目录，参考视频上传到输入目录，并分别接入 `MiniMaxH3ReferenceToVideo` 的 `ref_images` 与 `ref_videos`；纯文生、首帧和首尾帧路径保持不变。
- Playground 复用既有参考素材上传、堆叠预览和 `@` 引用交互；H3 参考视频从平台签名制品地址由浏览器取回，再随任务 multipart 请求提交，未新增服务端任意 URL 拉取。
- 增加参考素材解码、工作流映射、三次预处理请求上限、仅参考视频路径及前端提交回归测试；参考视频按 24 fps、最多 360 帧加载，避免绕过前端时无界解码，并补齐 7 种前端语言的动态数量提示。
- 本轮只完成代码和本地自动化验证；尚未部署或执行真实 Ref2VA 平台生成，参考视频原始音频当前不作为模型参考输入。

## 2026-09-10

### MiniMax H3 参考内容生成公网验收与计费对账

- Deploy Run `34429230406` 将 `develop` 的 `de6d2992eb6115f477b0c71e3efc11652aa6b3f3` 发布至 BytePlus ECS；现场复核确认该 release 正在运行，核心容器 healthy，公网 `/api/status` 返回 HTTP 200。
- 用户通过公网 Playground 分别完成参考图、参考视频及二者混合的真实生成，任务均成功完成，视频制品可正常播放和下载。
- 数据库只读汇总确认近 14 天 H3 成功任务均存在对应消费日志，任务结算额度与消费日志额度一致；最近 3 个参考内容任务各记录 `50,000 quota`，与 5 秒有声任务的管理员计费表达式一致。
- 参考视频原始音频仍不作为模型参考输入，失败退款与远端 ComfyUI 参考视频 TTL 清理尚待单独验证；不将本次成功任务对账扩大描述为失败路径已验收。

## 2026-09-13

### Seedance 2.0 内部视频超分

- 按模型新增后台开关，开启后可选择 480P / 720P 原始生成分辨率及是否保留原片；1080P / 4K 请求在同一任务中完成低分辨率生成、BytePlus VOD Fast 工作流、成片下载与交付。复用既有任务轮询、Option 存储、签名及 MP4 探测库，未增加依赖、数据库表或独立计费入口。
- 原片、VOD 标识和内部失败详情仅保存在私有任务状态；公开接口只返回最终视频。原片下载要求后台管理员会话，普通用户和 PAT 均不能访问。后台日志展示阶段、清理状态、输出参数及 Fast 处理成本估算；该估算不含存储、CDN 和失败重试费用，客户计费规则未调整。
- 上传调用前事务认领；不确定上传不自动重放。工作流启动使用固定 ClientToken，依赖 BytePlus 官方 StartWorkflow 幂等契约。阶段与清理状态采用 CAS，成片交付与 VOD 删除确认分开处理；无有效成片时整单失败并沿用一次性退款。
- 使用 ponytail 简化范围、Matt Pocock codebase-design / tdd 做边界和行为测试；SubAgent 分别完成契约核对、隔离前端实现、数据库/权限测试及独立审查。
- 验证通过：`make test`；根模块及 `relaykit` 的 `GOWORK=off go vet ./...` / `go build ./...`；`make build-web`；前端 `bun run typecheck`、`lint`（既有 warning）、`format:check`、`test`（146 文件 / 1569 项）。补充 4K 与权限断言后 `go test ./service ./controller -run SuperResolution -count=1` 通过，`go test -race ./service -run SuperResolution -count=1` 通过。
- 模型层在真实 SQLite、MySQL 8.0.46、PostgreSQL 15.19 上运行 `go test ./model -run SuperResolution -count=1 -v`：5 组 / 15 子测试、0 skip；覆盖私有 JSON 往返、重复迁移无新增 DDL、并发认领、清理调度与陈旧阶段拒绝。此次复用现有字段，无新 schema migration；这不是完整业务的三库端到端验收。
- 本地模拟覆盖 1080P / 4K MP4 真实探测、保留/不保留原片、清理确认、上传恢复失败退款及权限边界。尚未部署、未调用付费 BytePlus 接口、未完成真实账户账单对账。启用前按 `.env.example` 配置 VOD AK/SK、Johor 空间、Fast H.264 MP4 工作流、HTTPS 播放域名和持久存储；不在仓库记录凭据。
- 外部契约来源：BytePlus 官方 Go SDK 的 VOD 请求配置，以及 https://docs.byteplus.com/en/docs/byteplus-vod/reference-startworkflow 。

## 2026-09-14

### 修复 develop 部署的插件错误态可见性测试

- 部署 Run `34792742531` 在前端验证阶段失败：`channel-configuration.test.tsx` 通过 `findByText` 找到错误提示后立即断言可见，抽屉过渡尚未完成时发生失败。后端验证已通过，未进入服务器发布，旧 release 保持 healthy。
- 两处同类断言改为 `waitFor` 等待最终可见；保留原有可见性与重试行为断言，不跳过测试、不扩大全局超时、不修改运行时代码。
- 独立审查通过；本地对应测试文件 59 项、全量前端 146 文件 / 1569 项、TypeScript、受影响文件 lint 和格式检查通过。服务器配置内容与付费视频任务不属于此次测试修复范围。
- 修复提交 `cf6f2e2c1eb2f5a9489fa2ff3e8660edfea32816` 已合入并推送 `develop`。重试部署 Run `34793567949` 全部成功，现场复核 ECS current 为该提交，app / PostgreSQL / Redis healthy，公网 `/api/status` 返回成功。超分环境变量均非空，`/data/video-sr` 已挂载且可写；未调用付费视频任务，未验证 VOD 凭据权限、工作流内容或真实超分成片，2K 仍未接入代码。

### 超分成片交付失败诊断与播放域名准备

- 用户提交的真实任务在私有 `play_info` 阶段失败；只读查询确认 VOD 工作流记录存在 3840×2160、约 5 秒的增强输出，空间未配置播放域名。原始 API 错误已被旧代码泛化，不能复原当时准确错误码；任务退款日志确认预扣 quota 全额退回，VOD 清理已确认。
- 提交低清生成前增加只读 `ListDomain` 默认播放域名检查，检查失败对客户返回通用错误。VOD action、HTTP 状态与安全错误码只用于后台诊断，不保存响应体、凭据或签名 URL；终态清理保留已有诊断，公共失败投影包含固定错误提示。该预检不代表 DNS 或 HTTPS 已可用。
- 按用户确认创建专用 BytePlus 播放域名，并在 Cloudflare 添加 DNS only CNAME，公网解析已确认；HTTPS 证书与默认域名启用尚待完成，未再次提交付费生成任务。
- 修复经独立审查通过；`go test ./service ./controller ./relay/...` 通过，最终调整后 `go test ./service ./controller ./relay/channel/task/jsplugin` 与 SR 数据库持久化回归通过，根模块 `go vet ./...` / `go build ./...` 通过。所有 VOD 调用测试为模拟响应，未将其描述为真实成片验收。
- 当前修复提交 `f166e170a` 补验模型层：带临时 DSN 运行 `GOWORK=off go test ./model -run SuperResolution -count=1 -v`，SQLite、MySQL 8.0.46、PostgreSQL 15.19 共 15 个子测试全部通过、0 skip，覆盖私有 JSON 与阶段 CAS；隔离测试容器已清理。
- 修复已合入并推送 `develop`。首次 Run `34797921400` 因传入短 SHA 被 checkout 当作分支名而失败，未发布；改用完整 SHA 后 Run `34798127592` 成功。现场确认 ECS current 为 `f166e170adc9c787b5585d75ef4cb89b977bfb48`，app / PostgreSQL / Redis healthy，公网 `/api/status` 成功。BytePlus 证书申请仍需用户完成联系人资料和条款确认；DNS 生效不等于 HTTPS 或完整交付链路已可用。

### 播放域名 HTTPS 与实际成片访问验证

- 用户完成免费证书申请，并明确接受 `ServiceRoleForVod` 标准跨服务角色授权范围后，完成授权及 `video-play.metisdata.ai` 证书绑定。控制台显示 Authorized、Certificate running fine；证书到期日为 2027-03-31，未下载或记录私钥。
- Cloudflare DNS only CNAME 与证书 DNS 验证生效；通过 `AddDomainToScheduler` 启用 VOD 调度，`UpdateDomainPlayRule` 设置默认域名。`ListDomain` 与控制台均确认默认域名、调度和配置启用。
- 配置刚提交时历史素材 `GetPlayInfo` 暂仍返回 `ResourceNotFound.NoAvailableDomain`；随后复核成功。使用与生产代码一致的 `Definition=oe`、MP4、H.264、SSL 参数，现有历史增强素材返回 3844×2160 HTTPS 视频；ECS 正常证书校验下范围下载返回 HTTP 206、video/mp4，读取 1024 字节确认 MP4 文件头。未记录签名地址，未重新生成或超分视频。
- 本次为云端配置及已有素材访问验证，无应用代码变更，无需重新部署；完整的新任务生成、超分、持久化交付及最终计费仍待端到端验收。

### 超分按目标档位配置与官方分辨率边界

- 标准 Seedance 2.0 的 1080P、4K 可独立选择 480P / 720P 源视频；沿用原有 Option JSON，新增 `source_resolutions`，旧 `source_resolution` 继续作为兼容回退。运行时将当前目标对应源档位写入任务快照，在途任务保持原快照。
- 官方 ModelArk 价格/能力表：https://docs.byteplus.com/docs/ModelArk/1099320 。标准版支持 480P / 720P / 1080P / 4K，Fast 仅支持 480P / 720P，两者均未列出 2K。前端与后台仅提供官方档位，Fast 超分显示不可开启，旧 Fast 开关有效状态归一为关闭；API 在提交生成前拒绝未支持档位。保留标准模型参考图场景的既有 1080P 限制。
- 2K 内部链路读取 `BYTEPLUS_VOD_SR_WORKFLOW_2K`，校验短边至少 1440 像素，独立持久化、原片保留与清理复用既有流程；Fast 2K 估算采用官方每分钟 USD 0.4132（不超过 30fps），来源：https://docs.byteplus.com/en/docs/byteplus-vod/docs-pay-as-you-go-pricing 。未新增客户独立超分收费，未开放模型 2K 参数。
- 使用 ponytail / Matt Pocock TDD；只读探索、隔离前端实现、独立审查并行。审查后补充非法尺寸拒绝、旧 Fast 配置关闭和按目标工作流快照断言；修复 `/v1/videos` 顶层 `size` 在转发时丢失的问题，用真实插件 JSON / multipart 解码、构造请求到超分能力校验的 12 个场景验证。2K 使用纳入版本控制的真实小型 MP4 fixture，VOD HTTP 响应均为模拟。
- 验证：`GOWORK=off go test ./service ./controller ./relay/channel/task/jsplugin ./plugins -count=1`、根模块 `go vet ./...` / `go build ./...`、前端 `bun run typecheck` / `bun run build` / `bun run format:check`、全量 146 文件 / 1570 项测试通过，`bun run lint` 通过（保留既有 warning）；未改数据库 schema 或模型持久化结构。本次未部署、未发起付费 Provider 请求，不将本地测试视为真实超分验收。

### 发布按档位超分版本

- 按用户明确授权，以远端 develop 完整提交 `eca1ceca4798cc5b443104e2d4d36aa1a622f9c1` 触发 Deploy BytePlus ECS。Run `34817181833` 后端验证、前端验证、固定镜像构建与推送、服务器激活及公网 HTTPS 检查全部成功。
- 独立 SSH 复核 ECS current 为上述提交；app healthy，PostgreSQL / Redis 持续运行约三周且 healthy。本机与公网 `/api/status` 均返回 success=true。此次未读取 Secret、未提交付费视频任务，部署健康不代表新配置的真实生成回归已完成。

### 将原视频预览与下载统一到制品弹层

- 任务详情移除原片下载按钮。管理员超分任务制品顶部增加“原视频 / 超分视频”标签，默认显示超分成片，共享下载按钮始终对应当前选中视频；未保留原片时禁用原视频标签。
- 复用现有管理员原片接口和公共制品接口，不改后端契约。仅选中原片时加载 Blob，切换/关闭释放临时 URL；超分失败但原片存在时保留制品入口，不请求失败任务公共制品。普通用户和普通任务保持原有制品展示。
- 使用 ponytail 最小实现与项目 Tabs / Dialog 组件，委派前端实现并独立审查；既有后端原片管理员会话权限、公开制品仅成片、任务投影隐私回归通过。此次按用户要求仅合入并推送 develop，不部署、不发起付费生成。
- 验证通过：前端 `typecheck`、`lint`（既有 warning）、`format:check`、生产构建；全量前端 147 文件 / 1574 项通过，随后补强播放器 src 往返切换、普通用户成功任务和延迟响应关闭清理，定向制品组件 5 项通过。独立审查无 P1/P2。未进行部署后的浏览器或真实视频回归。

### Wan 系列复用后台 1080P 超分

- 官方核对（2026-09-17）：OpenRouter 的 https://openrouter.ai/alibaba/wan-3.0 和 https://openrouter.ai/alibaba/wan-3.0-prime 列出 480P / 720P / 1080P。两个模型的后台超分目标仅开放 1080P，源档位可选 480P / 720P；复用已有动态配置面板，不新增前端业务组件。
- Wan 成片接口返回需要渠道认证的视频流，服务端按当前轮询渠道的地址、凭据和代理拉取，拒绝重定向并限制下载时间和大小；沿用已有参考视频存储及短期签名 URL 交给 VOD，不向 BytePlus 传递 Provider 密钥。原始计费请求、最终公开成片和管理员原片访问规则保持不变。
- 复用现有私有阶段状态及 CAS，不改数据库 schema 或持久化字段；Wan 中转文件在终态清理，CAS 输家立即清理，数据库写入结果不确定时按任务主键复核，无法确认则交给现有 TTL。任务提交前检查暂存目录可写和公共媒体地址配置，但不将该检查视为公网可达验收。
- 使用 ponytail 最小复用、Matt Pocock 行为测试思路及探索/实现/独立审查 SubAgent；补充两模型配置与请求改写、流式鉴权及重定向拒绝、完整模拟超分交付、保留/不保留原片、CAS 输家清理和前端仅显示 1080P 的测试。
- 本地验证：受影响的 service/controller/jsplugin/plugins Go 包测试、根模块 vet/build；前端模型配置 12 项测试、typecheck、lint（既有 warning）。本次不部署，不发起付费 Provider/VOD 任务；真实公网拉取、生成、超分和成本仍待部署后验收。

### 修复渠道模型未保存元数据时超分入口隐藏

- 2026-09-17 只读核对 ECS current 为 `b0f02a4d7d0301609d4a6c1a7aa9acc872e3e445`，GitHub 提交比较确认包含 Wan 超分提交 `9dc7b7f97`，应用 healthy。数据库确认两个 Wan 模型存在于渠道，但没有模型元数据行。
- 复现：以 `id=0` 的渠道模型打开配置，超分查询被 `isEditing` 条件禁用，两个 Wan 测试均报找不到超分标签。已有测试只覆盖保存过元数据的模型，遗漏实际线上场景。
- 修复：精确模型名即可查询超分支持情况，移除元数据 ID 前提；仍由服务端返回能力决定是否显示入口，通配规则与新建空模型保持不显示。无需补写模型元数据或更改后端/API。
- 验证：模型配置 14 项回归、typecheck、lint（既有 warning）通过；本次未修改服务器、未部署或提交付费视频任务。

### 2026-10-01 同步 main 到 develop 并准备重新部署

- 实测线上 current 为 `6713d8753`，与同步前 develop 一致；远端 main 为 `9716c77f6`。两分支分叉，main 独有 104 个提交、develop 独有 10 个提交。按用户要求合并 main，保留 develop 已上线的 Wan、超分及参考音频功能，不强制覆盖分支历史。
- 解决任务插件凭据上下文、2xx 提交响应及 locale 冲突：沿用 main 的 applyUpstreamCredentials，同时保留 Wan 超分显式轮询渠道参数；独立审查无阻塞问题。
- 本地相关 Go 包、根模块 vet/build、relaykit test/build、前端 typecheck、189 文件 / 2283 项测试及生产构建通过。服务器数据库已做 root-only 本地备份；数据库兼容性与部署结果见后续验收记录。

### 2026-10-01 同步版本部署验收

- `59d0c7c34c8df6f6f68c4162715c029267e65803` 已合入并推送 develop，包含 main `9716c77f6` 全部提交，同时保留 develop 独有视频功能。Deploy Run `36820765531` 首次执行成功，无失败重试；云端后端/前端验证、镜像推送、服务器激活、公网 HTTPS 全部通过。
- 三数据库验证：以 `TEST_MYSQL_DSN` / `TEST_POSTGRES_DSN` 指向隔离本机测试库运行 `GOWORK=off go test ./model -count=1` 通过；SQLite、MySQL 8.0.46、PostgreSQL 15.19 均完成新库启动两次、旧线上版本 `6713d8753` 初始化后升级启动两次。均确认 `user_access_tokens` 表及 `LegacyAccessTokenRetireAt` 已建立；测试容器已清理。完整 `make test` 同样通过。
- 服务器部署前已在 root-only 目录保存 PostgreSQL 全库备份并校验 gzip；未下载数据。部署后独立 SSH 确认 current 为目标完整 SHA，app/PostgreSQL/Redis healthy，app restart=0、OOM=false，本机和公网 `/api/status` 成功，线上新表及退役配置存在。数据库及 Redis 保持原有持久化容器。
- 本次验证发布与迁移健康，未重跑付费模型、视频超分、登录或计费端到端业务。此记录提交仅更新文档，应用代码与已部署版本一致。

### 2026-10-08 同步 main 到 develop，部署前验证

- 同步前 main 为 `65c8ab40f123b9f9f90d4c4aa4aa42c06de67089`，develop 为 `40dd3fad84001c19a5c2bbc1d1c97e289c144d09`，双方独有提交为 11 / 13。以临时隔离工作树合入 main，不改动原工作树或用户未跟踪文件；保留 develop 的 H3 参考音频、Wan、内部超分和渠道鉴权媒体能力。
- 两处冲突：插件契约测试名单保留 H3、Wan 并加入 xAI；状态文档保留双方记录。locale 自动合并的两条删除为上游文案替换，与当前调用一致，不恢复已弃用键。
- 原 develop 工作树共享 node_modules 时图标动态导入测试出现超时；相同 SHA 使用独立 frozen-lockfile 安装后，全量基线通过，未放宽测试超时或修改业务代码。合并后 `make test`、三个 Go 模块独立 build/vet、前端 typecheck/test/lint/format:check/build（190 文件 / 2285 项）与生产 Docker build 均通过；lint 保留既有 warning。
- 本次无数据库行为改动，未执行三数据库迁移矩阵或真实付费业务验收。后端构建曾因提前执行且缺少 web/dist 失败，前端生产构建后重跑通过；部署与公网验收结果另行记录。

### 2026-10-08 develop 同步版本部署验收

- 合并提交 `1fe14039f7d2f31ad0a2a66d9a6c11dec1684cea` 已推送 origin/develop，确认 main `65c8ab40f` 为其祖先；原 develop 工作树安全快进，main 工作树不变。独立审查无集成阻塞问题，H3/Wan/超分等专属实现未丢失，License/attribution 未改。
- 使用 develop 触发 Deploy Run `37721324912`，ref 固定该完整 SHA；首次执行成功，无部署失败或重试。云端后端验证、前端类型检查及 190 文件 / 2285 项测试、linux/amd64 镜像发布、ECS 激活和公网 HTTPS 均通过。
- 2026-10-08 11:26（Asia/Shanghai）独立 SSH 核对 current 与镜像 OCI revision 均为目标 SHA；镜像 digest 为 `sha256:24057ccb4d0fd6289ca4b24fe308c866ac1d6d8e404b15e205cfcb124eb7c0b8`，平台 linux/amd64。三个容器 healthy，app restart=0、OOM=false，PostgreSQL/Redis 容器 ID 与部署前一致，本机及公网 `/api/status` success=true。
- 未执行真实付费模型、视频超分、登录、计费或退款端到端验收。审查提出 main 上游工具价格币种疑点（CNY 来源与 $/1K calls 界面/接口注释不一致，结算未见换算），未擅自改动价格，需单独核对实际配置。本验收记录仅文档变化，不再次发布同一份运行代码。


### 2026-10-11 Qwen-Image-2.1 内部 Images API 接入验收

- 用户要求：复用现有生图 API 接入 4090 Qwen-Image-2.1，仅内部评估，不做 Playground；完成真实生图、图片获取和失败处理后合并 develop 并推送。实现按 Ponytail 最小 diff 和 Matt Pocock 公共接口测试原则进行。
- 新插件 `qwen-image-21` 声明模型 `qwen-image-2.1`，使用已验收 BF16 UNet、Qwen3-VL、VAE 与 QwenImage21Cache；固定单图 1024×1024、25 步、CFG 1、Euler/simple，可指定非负安全整数 seed。支持 URL/Base64；不支持图片编辑、批量及其他尺寸，请求在提交前拒绝。
- 增加 `image-artifacts@1` 显式 capability，使异步 Images renderer 复用已有签名 task artifact URL；旧图片插件不新增网关地址配置要求，Responses 投影保持原样。复用现有轮询、失败退款、图片代理和 Base64 下载，无新存储或数据库变更。
- 真实环境：本机独立 SQLite + Linux ARM64 网关容器，仅监听 `127.0.0.1:13091`；经 SSH 本地转发访问 4090 ComfyUI。内部测试价格 `tier("internal_eval", u("image_count") * 0.001)` 仅用于验证额度，非官方价格或实际对外收费。
- URL 生图 HTTP 200、15.16 秒，PNG 1024×1024、1971315 字节；Base64 HTTP 200、6.29 秒，解码后 SHA-256 均为 `093b6792a086106876c870ce588d0550c50f63f437489ff642e5bc89b1c84b75`。同 seed 重复请求使用 ComfyUI 缓存，不可将该时延视作纯推理 benchmark。已目视确认橘猫、蓝杯和窗边光照。
- 四项非法参数（n=2、非字符串 prompt、布尔 seed、2048 尺寸）均 HTTP 400，任务数及钱包/Token 额度不变。成功图片无签名访问 HTTP 401、伪造签名 HTTP 404；合法签名正常获取。
- 通过隔离故障代理仅将输出文件名前缀改为超过文件系统限制，真实 ComfyUI `SaveImageAdvanced` 发生 `OSError`，API 返回 HTTP 400 / `image_generation_failed`；任务 FAILURE、quota=0，预扣500额度全额退回，钱包及Token前后均一致。上游不可达时 HTTP 500 / `do_request_failed`，现有异步退款完成后额度及任务数不变；图片获取返回错误。故障代理已停止，渠道恢复后原PNG再次HTTP 200。
- 隔离网关 Base64 自取图片使用现有 SSRF 策略：防护开启，私网许可同时限定 IP 白名单 `127.0.0.1/32` 和端口 `13091`，域名解析亦受IP过滤；仅适用于本次隔离实例，未修改共享/生产策略。生产配置应保证 TaskPublicAddress 同时可被客户端与网关访问；下载失败仍沿用现有 URL 回退语义。
- 已通过 `make test`（根模块、relaykit、tokenkit）、根模块 `GOWORK=off go vet ./...` / `go build ./...`、Linux ARM64 构建、聚焦插件/runtime/controller/task adaptor测试、Go格式、JS语法和JSON解析检查；独立审查无当前Qwen链路阻塞问题，已明确capability仅适用于异步任务。未安装专用JSON Schema验证器，契约约束另由插件注册测试覆盖。未修改前端，构建复用既有 web/dist，不将其描述为本次前端构建。没有数据库行为变更，未执行三数据库迁移矩阵。未部署公网服务，也未开通生产模型渠道。


### 2026-10-12 develop 部署与 Mac 测试环境清理

- 用户明确要求：停止本机服务、剔除本机经SSH访问4090的相关测试代码，后续通过develop部署线上测试，并推送部署develop。核查可部署源码不含13091/18191、host.docker.internal或Mac SSH依赖；保留通用Qwen插件。
- 已停止并删除 `qwen21-api-eval` 容器，清除本次临时脚本、测试凭据、SQLite库及后端二进制；确认本机13091、18191无监听且无相关SSH转发进程。保留生成PNG和无凭据验收报告，不删除4090模型或ComfyUI。此前本机测试命令不再适用。
- 发布固定提交 `31f1a3f75bd777d61e0219b75b0a1000ff64ce6b`，Deploy Run `38186778323` 首次成功，云端后端/前端检查、linux/amd64镜像构建、ECS激活及公网HTTPS检查均成功。镜像digest为 `sha256:71776976ce7ad65ec968aeef7f0a79be4d8f0bab8f41660dd815b27e2921869b`。
- 部署前备份保存于ECS `/data/metis-ai-cloud/backups/pre-qwen-20261012/postgres.dump`，1933720字节、权限0600，`pg_restore --list`验证通过，未下载数据库或输出凭据。部署后独立SSH确认current和OCI revision一致，三个项目容器healthy、应用restart=0/OOM=false；PostgreSQL/Redis/app-data目录inode保持5505031/5505032/5505029；迁移失败日志匹配为0，本机和公网/api/status均success=true。
- 线上访问4090仍有独立前置条件：Tailscale节点在线，但ComfyUI启动参数为 `--listen 127.0.0.1 --port 8191`，ECS到其Tailscale地址8191端口连接超时。生产TaskPublicAddress/ServerAddress已配置公网网关，Qwen渠道数量为0。没有擅自开放ComfyUI公网端口或创建对外渠道；需受限私网入口、内部渠道/分组和受限Token后再验收线上真实生图。
- 本记录仅文档更新，运行代码与已部署功能提交一致；未执行线上Qwen真实生成或计费验收，不将此前Mac隔离验收当作生产验收。


### 2026-10-12 4090 复用5090 Tailscale接入方式

- 只读确认线上5090 ComfyUI渠道使用Tailscale私网8888端口，ECS应用容器访问成功；4090已在同一tailnet，但Qwen ComfyUI仅监听Windows/WSL回环8191。
- 在4090新增持久Windows v4tov4 portproxy：Tailscale IPv4的8191转到127.0.0.1:8191；未改变ComfyUI启动参数、5090配置、其他服务或Mac本地测试环境。未开放公网监听。
- Windows已有Tailscale全端口放行规则，因此新增 `Metis-Qwen21-ECS-Allow` 和 `Metis-Qwen21-ECS-Only-Block`，仅针对该本地地址/TCP8191，允许ECS IPv4并以互补地址范围阻断其他来源。所有防火墙profile启用，两条规则均已在ActiveStore核对生效。
- 从线上实际app容器验证system_stats/queue/object_info：ComfyUI0.39.0、NVIDIA RTX4090、空队列、Qwen2.1 BF16 UNet存在。未提交生成任务，未修改渠道/价格/令牌；尚未执行其他tailnet设备的反向拒绝测试或整机重启恢复验收。
- 回滚仅需删除上述指定端口的portproxy及两条具名规则；保留原ComfyUI、Tailscale和既有规则。应用代码没有变化，无需重新构建部署。


## 2026-10-12 Playground 生图开发范围

- 用户授权：复用现有能力开发 Playground 生图，页面与聊天及视频生成保持统一；测试后合并 develop、推送并部署线上。
- 方案：在现有 Playground 增加图片页签，首期支持当前用户分组可访问的 Qwen-Image-2.1，单张 1024×1024、提示词与种子；复用异步任务提交、状态查询和图片制品，避免同步生图长连接。沿用页面模型分组选择器及 PromptInput，不新增依赖。
- 验证范围：请求与参数边界、登录会话与分组权限、任务所有者隔离、重复提交阻止、终态停止轮询、错误重试、图片预览下载及聊天/视频页签回归；部署后通过线上登录页面验收。
- 安全依据：OWASP ASVS 5.0.0、Authentication Cheat Sheet 与 Session Management Cheat Sheet。新增入口沿用现有 Authorization 登录会话，拒绝个人访问令牌；制品入口额外校验任务所有者，避免继承管理端跨用户读取权限。本次不改变登录凭据、会话生命周期或计费核心，不宣称全站 ASVS 合规。
- 已核实的前置结果：线上 Qwen Images API 已成功生成并获取图片，任务 SUCCESS、image_count=1、实际 quota=0；当前部署版本 3b99d582e52ed0b2a02b3b82beeffaa75db5c14b，三容器 healthy。
- 技能：Ponytail 最小改动；Matt Pocock codebase-design 与 tdd，按用户可见行为和 HTTP 接口测试；使用 Astra low 子 Agent 探索与实现。

- 实现结果：新增 `/pg/tasks/:key` 登录会话提交/查询和所有者限定制品读取；前端仅展示当前分组可用 Qwen，种子0保留、非法输入阻止提交、状态/内容错误重试、图片下载、切页签保留任务。没有改数据库结构、插件或计费核心。
- 最小复用说明：VideoComposer 绑定视频帧/音频/时长，无法直接用于图片；图片组件组合相同 PromptInput、ModelGroupSelector、ErrorState 与基础组件，沿用布局与主题。没有新增依赖。
- 验证：`make test`（根、relaykit、tokenkit）、根 `GOWORK=off go vet ./...`、前端 `bun run test`（200文件2352项）、typecheck、lint、format:check、build 均通过；最终小改动另重跑图片及页签17项测试通过。lint仅保留仓库既有warning。
- Astra low 独立审查发现 Enter 提交时公共输入组件原生reset导致内容丢失，已修复并补失败保留/再次提交回归；最终审查无剩余阻塞。新增认证入口遵循上述OWASP会话和授权控制，测试覆盖PAT/未登录拒绝、组权限与管理员跨所有者拒绝；未进行全站安全审计。

- 首次发布记录：Run 38210925776 因传入缩短提交号而在checkout失败，未触及线上；改用完整SHA后Run 38211107571成功部署968257241。页面实测发现模型列表为空：`mergeTaskPluginEndpointTypes` 仅补Responses/Video而漏Image协议。已补 `/v1/images/generations` 的 `image-generation` 投影一行及已有回归测试，红绿验证通过；不修改渠道/价格/模型metadata或数据库行为。修复版部署及验收结果见下。

- 最终发布：功能及修复已合并并推送 develop，完整代码提交 `ebd688376ac111695c6b8a42fc20646a499735fb`；[Deploy Run 38212953110](https://github.com/Metis-Data-Holding/metis-ai-cloud/actions/runs/38212953110) 成功。ECS current 与提交一致，三个容器 healthy、restart=0/OOM=false。云端完整前端测试200文件2353项通过，后端检查与构建部署成功。
- 线上页面验收：用户登录后在图片页签选择default分组、qwen-image-2.1，提交橘猫/蓝围巾/窗边热茶提示词，seed=202610121447、单张1024×1024。任务 `task_GeNv1vQk5tE6EEmlPWVfq84f2nn9qxLx` 状态SUCCESS、失败原因为空、quota=0；数据库提交至完成62秒（任务端到端时间，非纯GPU推理）。页面预览成功，点击下载获得PNG，sips确认1024×1024。生成期间输入和提交禁用，切换视频页签再返回保留任务与参数；非法seed=-1阻止提交。
- 验收边界：失败状态、查询/制品重试、权限隔离通过自动化测试；本次没有在线上注入4090故障，没有新增刷新后任务历史恢复能力。保持内部评估范围，未启动Mac网关或SSH中转。
