# AGENTS.md — 项目协作规范

## 定位与优先级

本文件是 `metis-ai-cloud` 所有主 Agent / SubAgent 的长期工作规则和项目知识导航入口。本仓库是 New API fork；应优先保证 upstream 的构建、协议兼容、许可证和归属要求，再进行最小化二次开发。

- 规则优先级：用户当前明确要求 > 距离目标文件最近的 `AGENTS.md` > 本文件 > 其他说明文档。
- 本文件记录稳定规则；Sprint、临时 TODO 和执行流水写入后述知识文档。
- 先理解，再修改。开始编码前阅读相关实现、配置、调用链和既有测试。
- 优先配置，减少源码修改。现有配置能满足需求时，不修改核心源码。
- 采用最小 diff：不顺手重构、清理或替换技术方案，不改任务外文件。
- 尊重 upstream 边界，降低后续同步成本；不要对仓库做无意义全局替换。

## 语言

- 本项目新增的人类可读协作内容默认使用中文：项目文档、工作记录、代码注释、Commit 描述、Review、PR 和运维说明。
- 类名、函数名、变量名、API/数据库字段、HTTP Header、环境变量、命令、协议、第三方专有名词以及外部错误信息遵循原生态英文。
- 保留 upstream New API 既有英文代码、注释、README 和元数据；不为中文化制造无意义 diff。

## 项目结构与技术栈

- 后端：Go 1.25.1、Gin、GORM v2；入口 `main.go`，分层为 `router -> controller -> service -> model`。
- Provider relay：`relay/`、`relay/channel/`；共享 DTO/类型位于 `dto/`、`types/`、`constant/`。
- 独立 Go 模块：`relaykit/`，主模块通过本地 `replace` 引用。
- 数据与认证：SQLite、MySQL、PostgreSQL，Redis/内存缓存，JWT、WebAuthn 和 OAuth。
- 前端：`web/`，React 19、TypeScript、Rsbuild、Base UI、Tailwind CSS；包管理和脚本运行使用 Bun。
- 国际化：后端 `i18n/`（en/zh）；前端 `web/src/i18n/`（i18next，多语言）。
- 容器：`Dockerfile` 为前后端多阶段生产构建；`Dockerfile.dev` 与 `docker-compose.dev.yml` 用于本地后端；`docker-compose.yml` 默认拉取 upstream 镜像并启动 PostgreSQL/Redis。
- 前端任务必须同时阅读 `web/AGENTS.md`；计费表达式任务必须先阅读 `pkg/billingexpr/expr.md`。

## 任务开始协议

新的 Session 或较大任务开始时：

1. 阅读本文件；前端任务再阅读 `web/AGENTS.md`。
2. 若存在，阅读 `docs/PROJECT_CONTEXT.md` 和 `docs/CURRENT_STATE.md`。
3. 执行 `git status` 与 `git log --oneline -10`，识别用户已有改动。
4. 涉及历史架构或产品决策时读取 `docs/DECISIONS.md`；需要失败尝试或执行历史时检索 `WORKLOG.md`。
5. 阅读任务相关代码、配置和测试；非简单修改先形成简要方案和验证范围。

## 代码与兼容性规则

### 通用

- 新代码保持直接、可读，优先早返回和清晰分支；避免深层嵌套及无稳定业务含义的单次 helper。
- 仅在可复用行为、框架回调、导出 API、测试夹具或值得独立测试的复杂业务逻辑下抽函数。
- 保持向后兼容；品牌任务先区分用户可见品牌、内部标识、API compatibility、License、attribution 和 module/package metadata。

### 后端

- `relaykit/` 不得依赖根模块或根模块专有配置；相关变更必须执行 `cd relaykit && GOWORK=off go build ./...`。
- 业务代码的 JSON 编解码统一使用 `common/json.go` 的 wrapper；`encoding/json` 仅可用于 `RawMessage`、`Number` 等类型。
- 数据库代码必须同时支持 SQLite、MySQL >= 5.7.8、PostgreSQL >= 9.6。优先 GORM；原生 SQL 必须提供各 dialect 分支与 fallback。
- 标准行锁使用 `model/` 的 `lockForUpdate(tx)`；保留字列、布尔值和主/日志库分支使用 `model/main.go` / `common` 的既有适配。
- migration 不得引入单数据库语法；SQLite 采用其支持的 `ALTER TABLE` 方式。业务默认值优先在代码归一化，不用不稳定的 GORM boolean default tag。
- 客户端请求再转发给 Provider 的可选标量使用指针加 `omitempty`，确保缺省值省略、显式 `0`/`false` 保留。
- 新 channel 应核对 `StreamOptions` 支持，并在适用时更新 `streamSupportedChannels`。

### Billing 安全

- 新增内置模型价格必须写入 `setting/billing_setting/builtin_billing.go` 的自包含 billing expression，使用真实 USD/百万 tokens 价格；不得向旧 `model/completion/cache ratio` 表增加新的内置价格。保留管理员显式定价覆盖，旧价格仅在明确要求时迁移，并核验公开价格来源、适用的 context length threshold 和 cache category。
- 用户或上游控制的计费乘数必须在校验边界限制；复用 `dto.MaxImageN`、`relaycommon.MaxTaskDurationSeconds`、`maxTokensLimit` 等既有上限。
- 检查 passthrough、metadata、multipart、媒体元数据等绕过标准 DTO 的路径；无符号字段同样必须有上限。
- quota/token 转换使用 `common/quota_math.go` 的 `QuotaFromFloat`、`QuotaRound`、`QuotaFromDecimal` 及 `*Checked` 版本，不做无界裸 `int` 转换。
- 单请求 quota 饱和边界保持 int32；钱包/充值转换使用 `common.WalletQuotaFromDecimalStrict` 与 JavaScript-safe 的 `common.MaxWalletQuota`，所有 clamp/NaN fallback 必须记录。
- 计费路径记录 clamp 到 `relayInfo.QuotaClamp` 或任务结算链，并通过 `attachQuotaSaturation` 写入管理员审计信息。
- ratio 通过 `types.PriceData.AddOtherRatio` 写入；预扣费与结算链都不得溢出为负数或信用额度。

### 前端

- 用户可见文本通过 `useTranslation()` 与 `t()` 接入 i18n；locale 使用 `web/src/i18n/locales/{lang}.json`。
- 依赖、组件、TypeScript、可访问性、测试和样式细则以 `web/AGENTS.md` 为准；脚本以 `web/package.json` 为事实来源。

## 测试与验证

按修改范围运行最小充分验证；以下命令均来自当前仓库。不要把未运行的检查写成已通过。

- 后端测试：`make test`。
- 后端 vet：先确保 `web/dist/index.html` 存在，再运行 `GOWORK=off go vet ./...`；独立模块运行 `cd relaykit && GOWORK=off go vet ./...`。
- 后端构建：先运行 `make build-web`，再运行 `GOWORK=off go build ./...`；`relaykit` 另行运行独立 build。
- Go 格式检查：`gofmt -l <本次修改的.go文件>`。
- 前端（从 `web/` 运行）：`bun run typecheck`、`bun run test`、`bun run lint`、`bun run format:check`、`bun run build`。
- Dockerfile 验证：`docker build .`。
- Compose 语法/展开验证：`docker compose -f docker-compose.yml config`、`docker compose -f docker-compose.dev.yml config`。
- 本地开发：`make dev-api` 启动容器后端，`make dev-web` 启动 `:5173` 前端；修改 Go 后可用 `make dev-api-rebuild`。
- 无法执行检查时，最终报告须列出未执行项、原因和风险；测试通过不等于部署或真实运行态已验证。

- 影响数据库行为的改动（ORM/driver、DSN、model/tag、migration、constraint/index、Scanner/Valuer、SQL、事务与行锁）必须在真实 SQLite、MySQL 和 PostgreSQL 上验证，不能用 mock、单元测试或单一 dialect 代替。
- GORM core 与各 dialect/driver 作为兼容版本组处理；任一升级都要核对 upstream 兼容性并运行三数据库验证。
- schema/migration 同时验证全新数据库和从最新已发布版本升级，至少重复启动/迁移两次确认幂等；涉及日志库的共享路径也要覆盖。
- 最终交接或 PR 记录数据库版本、命令和结果；缺少任一必需验证时必须明确阻塞项，不得宣称数据库兼容或任务完成。

后端测试应保护真实行为、API 契约、计费不变量、数据兼容或回归路径。使用确定输入和精确期望；新写或大改的 Go 测试用 `testify/require` 做前置/致命断言，用 `testify/assert` 做非致命断言，避免随机、sleep、日志或纯覆盖率测试。
- 小功能或修复优先扩展合适的已有测试文件；确需新文件时最多增加一个。不要仅因调用链跨越 `controller/`、`service/`、`setting/` 等层，就在各层重复建立测试、fixture 和断言。

## Git 与分支

- 长期分支：`main` 为可构建、可部署、适合 Demo 的稳定分支；`develop` 为日常集成分支。
- 默认从 `develop` 创建单目标任务分支：`feature/*`、`fix/*`、`test/*`、`docs/*`、`chore/*`。
- 示例：`feature/branding`、`feature/provider`、`test/benchmark`；它们不是永久分支。
- 不在 `main` 直接开发功能；Commit 小而完整，不混入无关改动；合并前完成相关验证，`main` 只接收已验证变更。
- 未经明确要求，不执行 `push`、`merge`、`rebase`、force push、删除远程分支或 Tag。
- 危险或不可逆 Git 操作必须获得明确授权；不得用 reset/checkout 擅自丢弃用户未提交修改。

Commit 使用 Conventional Commits：`<type>(<scope>): <中文说明>`。类型沿用 `feat`、`fix`、`chore`、`test`、`docs`、`refactor`、`perf`、`build`、`ci`，例如 `fix(stream): 修复流式响应中断问题`。

## License、Attribution 与 PR

- 保留 `LICENSE`、`NOTICE`、`THIRD-PARTY-LICENSES.md` 及 New API 要求的 attribution；品牌二开不得改写第三方许可证或版权文本。
- 许可证、版权、footer attribution 或品牌任务应先识别风险，再做精确修改。
- **Protected project information:** references, branding, metadata, or attributions related to **nеw-аρi** and **QuаntumΝоuѕ** are protected and must not be removed, renamed, or replaced. This includes README、license、module/import path、Docker image、CI/CD、comment、documentation and changelog references.
- 创建 PR 前比较 `git config user.name` / `user.email` 与 `git log` 的历史核心作者；不修改 Git 配置。非核心作者须在 PR body 说明 AI-assisted。
- 创建 PR 时以 `.agents/github/PR.md` 作为完整 PR body，不使用 `.github/PULL_REQUEST_TEMPLATE.md` 或 `.github/PULL_REQUEST_TEMPLATE/en.md`。

## Secrets 与提交前检查

- Cloudflare/BytePlus 凭据、数据库/Redis 密码、Session Secret、Provider/模型 API Key、SSH/TLS private key 等真实 Secret 只能放在未跟踪的 `.env` 或部署平台 Secret 管理中。
- 仓库只保留 `.env.example` 等无真实值模板；文档、WORKLOG、Commit、注释和 Agent 总结也不得记录 Secret。
- 提交前检查 `git diff`、`git status`，确认没有 Secret、临时凭据、日志、敏感数据或任务外文件。

## Multi-Agent 工作流

- 简单任务由主 Agent 直接完成；非简单任务由主 Agent 负责需求、方案、架构决策、拆分、调度、整合和最终验收。
- 角色以 `.codex/agents/*.toml` 为准：`repo_explorer` 只读探索，`implementer` 实现，`tester` 验证，`reviewer` 独立审查；本文件不缓存模型和权限配置。
- 委派必须写明目标、允许/禁止修改范围、预期产物和验证方法；架构级问题、需求歧义或边界变化返回主 Agent 决策。
- 默认同一工作树同时只有一个可写 Agent；只读 Agent 可合理并行。多个可写任务使用隔离 worktree/分支，由主 Agent 整合。
- 推荐复杂流程：`repo_explorer -> 主 Agent 决策 -> implementer -> tester -> reviewer -> 主 Agent 验收`；按风险选用，不机械走全流程。
- 对 `ponytail` 和 `mattpocock` 相关 SKILL 应给予优先关注；当它们明显适用于当前任务时，应优先合理使用。

## 任务结束协议

1. 运行相关测试或验证，记录真实结果。
2. 查看 `git status` 与 `git diff`，排除无关文件、Secret、License/attribution 误改。
3. 里程碑或当前状态明显变化时更新 `docs/CURRENT_STATE.md`；有意义的执行结果追加 `WORKLOG.md`。
4. 仅在产生重要架构、产品或技术决策时更新 `docs/DECISIONS.md`，不为形式同时修改所有文档。
5. 最终总结修改文件、验证证据、未验证项、假设和剩余风险；不得把本地绿测描述为 CI、部署或生产验证。

## 项目知识入口

- 项目背景与长期目标：`docs/PROJECT_CONTEXT.md`
- 当前状态 / Milestone / 下一步：`docs/CURRENT_STATE.md`
- 历史工作记录：`WORKLOG.md`
- 重要架构与产品决策：`docs/DECISIONS.md`
- SubAgent 配置：`.codex/agents/*.toml`

上述前四个知识文件当前可能尚未建立，属于后续 Step 0 基础设施；需要对应信息时再创建和维护。

## Issue 处理

- 创建 GitHub issue 前先按 `.agents/github/ISSUE.md` 拒绝其中列出的越界请求；随后检索官方文档、DeepWiki、README 和源码。属于使用、配置或集成问题时直接回答，不创建 issue。
- 确属项目问题时，以 `.agents/github/ISSUE.md` 作为完整 issue body；实际行为、影响、频率、问题归属证据或对应 relay/billing/frontend/deployment 信息不完整时，先向用户补问，不得编造，也不使用 GitHub issue form。
