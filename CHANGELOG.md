# Changelog

## 0.5.0 — 2026-08-18

0.5 排期兑现：服务代码对 legacy `COZE_*` / `DEPLOY_RUN_PORT` 的**裸读清零** + 适配层**正名收口**。集群暂无外部用户，「移除」修订为「永久适配」：平台注入变量名不可改名，`deploymentAliases` / `normalizeDeployEnv` 为永久机制，不再承诺移除版本。

- **适配层正名**：删除全部「过渡至 v0.5 移除」表述（`deploy.ts` 注释、README、`.env.example`），统一为「平台注入适配别名（永久机制，读取时回退，禁止裸读）」
- **消费端裸读清零**（`process.env.COZE_*` 服务代码直读全量迁移，零残留）：
  - WanyanAI：`stations/openai-forward`、`stations/coze`、`app/api/v1/admin/verify/route.ts`、`storage/database/supabase-client.ts`、`config-store/file-store.ts`
  - yunzone_redirect_gateway：新建统一 `lib/env-schema.ts`；`src/config.ts`、`src/app/layout.tsx`、`storage/database/supabase-client.ts`、`scripts/sync-mappings-to-db.ts`
  - yunzone_user_center：新建统一 `lib/env-schema.ts`（Supabase / S3 / 验证码私有层显式声明）；`lib/supabase/admin.ts`、`lib/storage/providers/coze-s3.ts`、`lib/captcha/providers/coze.ts`、`lib/verification/providers/supabase.ts`、`lib/admin-auth.ts`、`app/layout.tsx`、`app/api/admin/oauth-clients/route.ts`
- **私有层读取合规化**：`COZE_SUPABASE_*`、`COZE_BUCKET_*`、`COZE_CAPTCHA_*`、`COZE_WORKLOAD_API_TOKEN` 等平台注入私有组经消费端 schema 显式声明后由 `loadEnv` 读取（裸读禁令的合法例外）
- **消费端 zod 版本对齐（4.4.3）**：yunzone_redirect_gateway / yunzone_user_center 由 4.3.6 对齐至与 kit 构建（4.4.3）一致的 zod，消除 zod 4.x 类型内部 `_zod.version.minor` 字面量（'3' vs '4'）跨副本不兼容导致的 `loadEnv`/`composeFacets` 类型炸弹
- 配套：`tests/deploy.test.ts` 测试描述同步正名（断言不变）；TICKET-001 排期表 0.5 行标记完成

## 0.4.0 — 2026-08-18

配置键命名中立化（TICKET-001，机制层 + 中立键切换合并实施，不跳版本）。平台注入变量名不变，`DEPLOY_PROVIDER` 缺省回退 coze，**现有部署行为零变化**。

- `/config` 新增**部署适配层**（`normalizeDeployEnv` / `deploymentAliases`）：按 `DEPLOY_PROVIDER`（默认 `coze`，缺省一次性警告；`self` 直读；未知值显式报错）分派，把平台注入旧名（`COZE_PROJECT_ENV` / `COZE_PROJECT_DOMAIN_DEFAULT` / `COZE_WORKSPACE_PATH` / `DEPLOY_RUN_PORT`）**读取时**回退映射到中立键，不写 `process.env`
- `deploymentFacet` 中立键化：`DEPLOY_ENV` / `PROJECT_DOMAIN_DEFAULT` / `PUBLIC_BASE_URL`（新增，解析链最高优先级）/ `DEPLOY_PROVIDER`（新增）/ `HOSTNAME` / `PORT` / `WORKSPACE_PATH`
- `resolveBaseUrl` 解析链：`PUBLIC_BASE_URL` → `BETTER_AUTH_URL`（历史遗留兼容键）→（DEV 回退）→ `PROJECT_DOMAIN_DEFAULT` → fallback；`resolveListenAddress` 端口统一读 `PORT`（旧名经适配层回退）
- `/ops` 报告 `deployment.env` 改读中立键 `DEPLOY_ENV`
- 兑现 0.2 声明的 v0.3 移除承诺：legacy 别名 `AUTH_SERVER_*` 正式移除（`aliases` 机制本身保留，供部署面过渡复用）
- 规范落库：README「配置键命名规范」小节（三层命名空间模型 + 裸读禁令）+ `specs.ts` 头部注释；`.env.example` 同步中立键化并标注 legacy 键与移除版本（v0.5）
- 消费端迁移：WanyanAI（env-schema 调用点传 `deploymentAliases`、server.ts 裸读点改读 `DEPLOY_ENV`）、yunzone_redirect_gateway（server.ts 裸读点）、yunzone_user_center（移除 `AUTH_SERVER_*` aliases）
- 配套：vitest 单测更新与新增（适配层、aliases 优先级、解析链、报告中立键）

## 0.3.0 — 2026-08-18

- `/config` 新增本地 `.env` 文件加载：`parseDotEnv`（纯函数解析：引号值/注释/export 前缀，`strict: false` 宽容跳过）与 `loadDotEnv`（默认不覆盖平台注入变量，`override`/`required` 可选）；`loadEnv` 支持 `{ dotenv: true }` 一键先加载 `.env` 再校验；`EnvFileError` 只报行号不回显变量值

## 0.2.0 — 2026-08-18

环境变量分面规范与运维数据接口。

- `/config` 新增 **Env Facets 分面规范**：`deploymentFacet` / `authCenterFacet` / `userCenterFacet` / `adminFacet`，配套 `composeFacets`（重复 key 抛错）、`requiredFacet`（模块级必填，output 类型同步收紧）、`facetKeys`
- `loadEnv` 支持 `aliases` 过渡兼容（`AUTH_SERVER_*` → `AUTH_CENTER_*`，文档标注 v0.3 移除）；抽公共 `envSnapshot`（set/unset 指纹，不回显值）
- `resolveListenAddress`：统一监听地址解析（`HOSTNAME` + `DEPLOY_RUN_PORT`/`PORT`）
- 新增 `/ops` 子模块：`createOpsReporter` 运维报告聚合（服务/部署/注册中心/环境指纹）、`resolveAdminConfig`/`verifyAdminToken`/`createAdminSession`/`validateAdminSession` 管理后台公共逻辑（常量时间比较、会话过期校验；`ADMIN_PASSWORD` 未设置 = 管理禁用）
- 消费端迁移：WanyanAI（env-schema 分面化、admin 路由/guard 库化、server.ts）、yunzone_user_center（`AUTH_SERVER_*` → `AUTH_CENTER_*`）、yunzone_redirect_gateway（移除默认管理密码回退）
- 配套：vitest 单测新增 29 用例（共 54）

## 0.1.0 — 2026-08-18

初始版本：从 `yunzone_user_center/packages/service-kit` 抽离为独立项目。

- `/registry`：泛型 `ProviderRegistry<T, P>`（注册/优先级/健康检查降级/状态快照/describeProvider 扩展）
- `/config`：`defineEnv`/`loadEnv`/`EnvConfigError`（防泄漏诊断快照）、`resolveDatabaseUrl`（postgres/coze）、`resolveBaseUrl`
- 配套：vitest 单元测试（25 用例）、tsup 构建（ESM+CJS+DTS）、CI 与发布工作流
